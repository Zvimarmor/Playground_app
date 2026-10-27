/*
 * In-browser face pipeline: detect (SCRFD) -> align (5 points) -> embed
 * (ArcFace). Selfies never leave the device - only the averaged embedding is
 * sent to find_my_photos(). The admin indexer runs the very same code over the
 * album, so selfie and album vectors are directly comparable.
 *
 * onnxruntime-web and the two models (~16 MB) load on first use, so pages
 * that never search pay nothing for them.
 */
import {
  DET_SIZE, FACE_SIZE, alignmentTransform, decodeScrfd, letterboxScale, nms, normalize, toPlanarRgb,
} from './faceMath'

/*
 * onnxruntime-web is pinned to 1.18: it is the last release with a
 * single-threaded wasm build. Later builds always allocate a shared
 * WebAssembly.Memory with a 4 GB ceiling, which iPhone Safari refuses, so the
 * models never load there. The files are imported by path because the
 * package's exports map hides them; Vite copies them into the build.
 */
import simdWasmUrl from '../../node_modules/onnxruntime-web/dist/ort-wasm-simd.wasm?url'
import plainWasmUrl from '../../node_modules/onnxruntime-web/dist/ort-wasm.wasm?url'

const MODELS = {
  detector: '/models/det_500m.onnx',
  recognizer: '/models/w600k_mbf.onnx',
}

/** The face models could not be loaded or run in this browser. `cause` has the original error. */
export class FaceModelError extends Error {
  constructor(cause) {
    super(cause?.message || String(cause))
    this.name = 'FaceModelError'
    this.cause = cause
  }
}

let runtimePromise = null

/**
 * Loads onnxruntime and both models once. A failed load is not cached, so the
 * caller can simply try again. Rejects with a FaceModelError.
 */
export function loadFaceModels() {
  runtimePromise ??= (async () => {
    const ort = await import('onnxruntime-web/wasm')
    // One thread selects the build without shared memory. ort-wasm.wasm is
    // for phones without wasm SIMD (iOS before 16.4).
    ort.env.wasm.numThreads = 1
    ort.env.wasm.wasmPaths = { 'ort-wasm-simd.wasm': simdWasmUrl, 'ort-wasm.wasm': plainWasmUrl }
    const options = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' }
    // One after the other: two sessions compiling at once doubles the peak
    // memory, which is what an iPhone tab runs out of first.
    const detector = await ort.InferenceSession.create(MODELS.detector, options)
    const recognizer = await ort.InferenceSession.create(MODELS.recognizer, options)
    return { ort, detector, recognizer }
  })().catch((err) => {
    runtimePromise = null
    throw err instanceof FaceModelError ? err : new FaceModelError(err)
  })
  return runtimePromise
}

// A wasm session cannot run two inferences at once, so every run is queued.
let queue = Promise.resolve()
function exclusive(task) {
  const result = queue.then(task)
  queue = result.catch(() => {})
  return result
}

async function infer(session, ort, data, dims) {
  const output = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', data, dims) })
  return session.outputNames.map((name) => output[name].data)
}

function makeCanvas(width, height) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

function context2d(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  return ctx
}

/**
 * Decodes an image file into a canvas whose long side is at most `maxSide`.
 * Going through <img> applies the EXIF orientation, so phone photos come out
 * upright.
 *
 * @param {Blob} blob
 * @param {number} maxSide
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function imageToCanvas(blob, maxSide) {
  const url = URL.createObjectURL(blob)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight))
    const canvas = makeCanvas(Math.round(img.naturalWidth * scale), Math.round(img.naturalHeight * scale))
    context2d(canvas).drawImage(img, 0, 0, canvas.width, canvas.height)
    return canvas
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Runs SCRFD on one region of `source`, scaled by `scale` into the detector square. */
async function detectRegion(rt, source, [sx, sy, sw, sh], scale) {
  const square = makeCanvas(DET_SIZE, DET_SIZE)
  const ctx = context2d(square)
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, DET_SIZE, DET_SIZE)
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, sw * scale, sh * scale)
  const rgba = ctx.getImageData(0, 0, DET_SIZE, DET_SIZE).data
  const outputs = await infer(rt.detector, rt.ort, toPlanarRgb(rgba, DET_SIZE * DET_SIZE, 128), [1, 3, DET_SIZE, DET_SIZE])
  return decodeScrfd(outputs, { scale, offsetX: sx, offsetY: sy })
}

/** Start offsets of overlapping windows of `size` covering `length`. */
function windowStarts(length, size, step) {
  if (length <= size) return [0]
  const starts = []
  for (let start = 0; start + size < length; start += step) starts.push(start)
  starts.push(length - size)
  return starts
}

/**
 * Finds faces in a canvas. With `tiles`, the image is also scanned at up to
 * 1280px in overlapping 640px windows, which picks up the small faces at the
 * back of a crowd shot that the single 640px pass misses.
 */
async function detectFaces(rt, source, tiles) {
  const { width, height } = source
  const found = await detectRegion(rt, source, [0, 0, width, height], letterboxScale(width, height))

  const scale = Math.min(1, (DET_SIZE * 2) / Math.max(width, height))
  const tile = DET_SIZE / scale
  if (tiles && tile < Math.max(width, height)) {
    for (const y of windowStarts(height, tile, tile * 0.75)) {
      for (const x of windowStarts(width, tile, tile * 0.75)) {
        found.push(...(await detectRegion(rt, source, [x, y, Math.min(tile, width), Math.min(tile, height)], scale)))
      }
    }
  }
  return nms(found)
}

/**
 * Aligned 112x112 crop -> unit-length 512-d embedding. A face much larger than
 * the crop is first shrunk with a plain drawImage (good downsampling) and only
 * then warped, since a big one-step affine downscale would alias.
 */
async function embedFace(rt, source, { box, landmarks }) {
  let image = source
  let points = landmarks
  const [a, b] = alignmentTransform(landmarks)
  const shrink = 2 * Math.hypot(a, b)
  if (shrink < 1) {
    const pad = box[2] - box[0]
    const x = Math.max(0, box[0] - pad)
    const y = Math.max(0, box[1] - pad)
    const w = Math.min(source.width, box[2] + pad) - x
    const h = Math.min(source.height, box[3] + pad) - y
    image = makeCanvas(Math.max(1, Math.round(w * shrink)), Math.max(1, Math.round(h * shrink)))
    context2d(image).drawImage(source, x, y, w, h, 0, 0, image.width, image.height)
    points = landmarks.map(([px, py]) => [(px - x) * shrink, (py - y) * shrink])
  }

  const crop = makeCanvas(FACE_SIZE, FACE_SIZE)
  const ctx = context2d(crop)
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, FACE_SIZE, FACE_SIZE)
  ctx.setTransform(...alignmentTransform(points))
  ctx.drawImage(image, 0, 0)
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  const rgba = ctx.getImageData(0, 0, FACE_SIZE, FACE_SIZE).data
  const [embedding] = await infer(rt.recognizer, rt.ort, toPlanarRgb(rgba, FACE_SIZE * FACE_SIZE, 127.5), [1, 3, FACE_SIZE, FACE_SIZE])
  return normalize(Float32Array.from(embedding))
}

/**
 * @typedef {import('./faceMath').Detection & { embedding: Float32Array }} Face
 */

/**
 * Every face in `canvas` at least `minFaceSize` pixels wide, largest first,
 * each with its embedding.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {{ tiles?: boolean, minFaceSize?: number }} [options]
 * @returns {Promise<Face[]>}
 */
export async function analyzeFaces(canvas, { tiles = false, minFaceSize = 32 } = {}) {
  const rt = await loadFaceModels()
  return exclusive(async () => {
    const width = (det) => det.box[2] - det.box[0]
    const detections = (await detectFaces(rt, canvas, tiles))
      .filter((det) => width(det) >= minFaceSize)
      .sort((x, y) => width(y) - width(x))
    const faces = []
    for (const det of detections) faces.push({ ...det, embedding: await embedFace(rt, canvas, det) })
    return faces
  })
}

/** Why a selfie was turned down - see SELFIE_ERRORS in the UI. */
export class SelfieError extends Error {
  /** @param {'no-face' | 'many-faces' | 'too-small'} reason */
  constructor(reason) {
    super(reason)
    this.reason = reason
  }
}

/**
 * The embedding of the one face a selfie is about. Throws SelfieError when
 * there is no clear single face: none at all, a second face nearly as big
 * (whose would it be?), or a face too small to trust.
 *
 * @param {Blob} blob
 * @returns {Promise<Float32Array>}
 */
export async function selfieEmbedding(blob) {
  const canvas = await imageToCanvas(blob, 1280)
  const faces = await analyzeFaces(canvas, { minFaceSize: 24 })
  if (faces.length === 0) throw new SelfieError('no-face')
  const width = (face) => face.box[2] - face.box[0]
  if (faces.length > 1 && width(faces[1]) > width(faces[0]) * 0.65) throw new SelfieError('many-faces')
  if (width(faces[0]) < 80) throw new SelfieError('too-small')
  return faces[0].embedding
}
