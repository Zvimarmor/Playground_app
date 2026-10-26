/*
 * Face pipeline math - no DOM, no onnxruntime. Everything here takes plain
 * arrays so the browser pipeline (faces.js) and a Node check can share it.
 *
 * Models: InsightFace buffalo_s
 *   det_500m.onnx  - SCRFD-500M detector, 640x640 input, 5 landmarks per face
 *   w600k_mbf.onnx - ArcFace MobileFaceNet, 112x112 aligned crop -> 512-d
 */

/** Detector input side. The model takes a square, letterboxed top-left. */
export const DET_SIZE = 640

/** ArcFace crop side. */
export const FACE_SIZE = 112

/** Embedding length of w600k_mbf. Must match vector(512) in migration_photos.sql. */
export const EMBEDDING_DIM = 512

/**
 * Same-person cut-offs for cosine similarity between ArcFace embeddings.
 * 0.42 is the default search; the guest can widen it once nothing is found,
 * or tighten it when strangers show up. find_my_photos() clamps whatever it
 * is sent to the 0.38-0.46 range.
 */
export const MATCH_THRESHOLD = 0.42
export const EXPANDED_THRESHOLD = 0.38
export const STRICT_THRESHOLD = 0.46

const STRIDES = [8, 16, 32]
const ANCHORS_PER_CELL = 2

/**
 * Where the five landmarks (left eye, right eye, nose, left mouth corner,
 * right mouth corner) sit in the 112x112 crop ArcFace was trained on.
 */
export const ARCFACE_TEMPLATE = [
  [38.2946, 51.6963],
  [73.5318, 51.5014],
  [56.0252, 71.7366],
  [41.5493, 92.3655],
  [70.7299, 92.2041],
]

/**
 * @typedef {Object} Detection
 * @property {number} score                     detector confidence, 0..1
 * @property {[number, number, number, number]} box  x1, y1, x2, y2 in source pixels
 * @property {Array<[number, number]>} landmarks 5 points in source pixels
 */

/**
 * Scale that fits a w x h image inside the detector square, as InsightFace
 * does it: keep the aspect ratio and paste at the top-left corner.
 */
export function letterboxScale(width, height) {
  return Math.min(DET_SIZE / width, DET_SIZE / height)
}

/**
 * RGBA pixels -> planar RGB float32 tensor data, (value - mean) / std.
 * SCRFD wants std 128, ArcFace 127.5.
 *
 * @param {Uint8ClampedArray} rgba
 * @param {number} pixels  width * height
 * @param {number} std
 */
export function toPlanarRgb(rgba, pixels, std) {
  const out = new Float32Array(pixels * 3)
  for (let i = 0; i < pixels; i++) {
    out[i] = (rgba[i * 4] - 127.5) / std
    out[pixels + i] = (rgba[i * 4 + 1] - 127.5) / std
    out[pixels * 2 + i] = (rgba[i * 4 + 2] - 127.5) / std
  }
  return out
}

/**
 * Turns the nine SCRFD outputs into detections in source-image pixels.
 *
 * @param {Float32Array[]} outputs  scores x3, boxes x3, landmarks x3 - strides 8, 16, 32 in that order
 * @param {object} frame
 * @param {number} frame.scale    source pixels -> detector pixels
 * @param {number} [frame.offsetX] source x of the detector input's left edge (for tiles)
 * @param {number} [frame.offsetY]
 * @param {number} [scoreThreshold]
 * @returns {Detection[]} not yet de-duplicated - run nms() on the result
 */
export function decodeScrfd(outputs, { scale, offsetX = 0, offsetY = 0 }, scoreThreshold = 0.5) {
  const found = []
  STRIDES.forEach((stride, level) => {
    const scores = outputs[level]
    const boxes = outputs[level + STRIDES.length]
    const kps = outputs[level + STRIDES.length * 2]
    const cells = DET_SIZE / stride
    for (let i = 0; i < scores.length; i++) {
      if (scores[i] < scoreThreshold) continue
      // Anchors run row by row, two per cell.
      const cell = Math.floor(i / ANCHORS_PER_CELL)
      const cx = (cell % cells) * stride
      const cy = Math.floor(cell / cells) * stride
      const toSource = (x, y) => [x / scale + offsetX, y / scale + offsetY]
      const [x1, y1] = toSource(cx - boxes[i * 4] * stride, cy - boxes[i * 4 + 1] * stride)
      const [x2, y2] = toSource(cx + boxes[i * 4 + 2] * stride, cy + boxes[i * 4 + 3] * stride)
      const landmarks = []
      for (let k = 0; k < 5; k++) {
        landmarks.push(toSource(cx + kps[i * 10 + k * 2] * stride, cy + kps[i * 10 + k * 2 + 1] * stride))
      }
      found.push({ score: scores[i], box: [x1, y1, x2, y2], landmarks })
    }
  })
  return found
}

function iou(a, b) {
  const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0])
  const h = Math.min(a[3], b[3]) - Math.max(a[1], b[1])
  if (w <= 0 || h <= 0) return 0
  const inter = w * h
  const area = (box) => (box[2] - box[0]) * (box[3] - box[1])
  return inter / (area(a) + area(b) - inter)
}

/** Greedy non-maximum suppression, best score first. */
export function nms(detections, threshold = 0.4) {
  const sorted = [...detections].sort((a, b) => b.score - a.score)
  const kept = []
  for (const det of sorted) {
    if (kept.every((other) => iou(det.box, other.box) < threshold)) kept.push(det)
  }
  return kept
}

/**
 * Least-squares similarity transform (rotation + uniform scale + shift) that
 * maps the detected landmarks onto ARCFACE_TEMPLATE - the 2-D Umeyama fit.
 * Returned as canvas setTransform() arguments: x' = a*x + c*y + e, y' = b*x + d*y + f.
 *
 * @param {Array<[number, number]>} landmarks
 * @returns {[number, number, number, number, number, number]}
 */
export function alignmentTransform(landmarks) {
  const n = landmarks.length
  const mean = (points, axis) => points.reduce((sum, p) => sum + p[axis], 0) / n
  const sx = mean(landmarks, 0)
  const sy = mean(landmarks, 1)
  const dx = mean(ARCFACE_TEMPLATE, 0)
  const dy = mean(ARCFACE_TEMPLATE, 1)
  let dot = 0
  let cross = 0
  let norm = 0
  for (let i = 0; i < n; i++) {
    const xs = landmarks[i][0] - sx
    const ys = landmarks[i][1] - sy
    const xd = ARCFACE_TEMPLATE[i][0] - dx
    const yd = ARCFACE_TEMPLATE[i][1] - dy
    dot += xs * xd + ys * yd
    cross += xs * yd - ys * xd
    norm += xs * xs + ys * ys
  }
  const a = dot / norm // s*cos
  const b = cross / norm // s*sin
  return [a, b, -b, a, dx - (a * sx - b * sy), dy - (b * sx + a * sy)]
}

/** Applies an alignmentTransform() to one point - handy for checks. */
export function applyTransform([a, b, c, d, e, f], [x, y]) {
  return [a * x + c * y + e, b * x + d * y + f]
}

/** Scales a vector to unit length (in place) and returns it. */
export function normalize(vector) {
  let sum = 0
  for (const value of vector) sum += value * value
  const length = Math.sqrt(sum) || 1
  for (let i = 0; i < vector.length; i++) vector[i] /= length
  return vector
}

/**
 * v_avg = (v1 + ... + vN) / N, then back to unit length. Each input is
 * normalised first so a sharper selfie cannot outweigh the others.
 *
 * @param {ArrayLike<number>[]} vectors
 * @returns {Float32Array}
 */
export function averageEmbedding(vectors) {
  const sum = new Float32Array(vectors[0].length)
  for (const vector of vectors) {
    const unit = normalize(Float32Array.from(vector))
    for (let i = 0; i < sum.length; i++) sum[i] += unit[i] / vectors.length
  }
  return normalize(sum)
}

/** Cosine similarity of two vectors of any length. */
export function cosine(a, b) {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  return dot / Math.sqrt(na * nb)
}
