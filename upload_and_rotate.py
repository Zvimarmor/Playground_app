#!/usr/bin/env python3
"""
Straighten the party photos before face indexing, and optionally upload them.

For every image in SRC_DIR (e.g. the unzipped Google Drive folder 23/10):

  1. Apply the EXIF orientation with PIL.ImageOps.exif_transpose, so the
     pixels themselves are upright and no viewer depends on the tag.
     Canon RAW (.cr2) is converted to RGB JPEG: the camera's own full-size
     JPEG rendering embedded in the file is used when there is one (camera
     colours, and far faster than developing the RAW), turned upright by the
     orientation LibRaw reads from the file; otherwise LibRaw develops the RAW.
     A .cr2 with a JPEG twin of the same name (RAW+JPEG shooting) is skipped,
     so the album does not get every such photo twice.
  2. Catch photos that are still sideways - pixels stored rotated with no
     EXIF tag to say so. Rotating every landscape photo blindly would break
     the correct ones, so the script runs the same SCRFD face detector the
     site uses (public/models/det_500m.onnx) at 0, -90 and +90 degrees and
     only turns a photo when a sideways orientation clearly finds faces the
     upright one does not. Photos without faces are left as they are.
     --force-rotate NAME applies .rotate(-90, expand=True) by hand.
  3. Write the result to OUT_DIR at full resolution as <name>.jpg - same
     pixels, width/height swapped only when it was turned a quarter turn.
     Two sources with the same name (different subfolders) get <name>-2.jpg.
     Point /admin/photos at OUT_DIR - that page does the face indexing, and a
     photo is only findable on /find-photos once it has been indexed there.
  4. With --upload, also put each straightened original in the
     'event-photos' bucket under originals/<uuid>.jpg (the bucket is public,
     so file names must not be guessable) and record the mapping in
     OUT_DIR/upload_manifest.json. Needs SUPABASE_SERVICE_ROLE_KEY - keep it
     in .env, never in the repo or the browser.

Setup:
    python3 -m venv .venv && source .venv/bin/activate
    pip install pillow numpy onnxruntime supabase rawpy

Usage:
    python upload_and_rotate.py ~/Downloads/23-10 --out ~/Downloads/23-10-upright
    python upload_and_rotate.py ~/Downloads/23-10 --out ~/Downloads/23-10-upright --upload
    python upload_and_rotate.py SRC --out OUT --force-rotate IMG_0042.jpg IMG_0107.jpg
"""

from __future__ import annotations

import argparse
import io
import json
import os
import sys
import uuid
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent
DETECTOR = ROOT / "public" / "models" / "det_500m.onnx"
BUCKET = "event-photos"
JPEG_EXTENSIONS = {".jpg", ".jpeg"}
RAW_EXTENSIONS = {".cr2"}  # matched case-insensitively, so .CR2 too
EXTENSIONS = JPEG_EXTENSIONS | {".png", ".webp"} | RAW_EXTENSIONS

# A RAW's embedded preview is used when its long side is at least this - the
# site shows photos at 2048px. Smaller previews mean developing the RAW.
MIN_PREVIEW_SIDE = 2048
# LibRaw's sizes.flip -> the transpose that makes the image upright.
LIBRAW_FLIP = {3: Image.Transpose.ROTATE_180, 5: Image.Transpose.ROTATE_90, 6: Image.Transpose.ROTATE_270}
# EXIF worth carrying over from a RAW; its IFD0 also holds pointers into the RAW data, which a JPEG must not.
RAW_EXIF_TAGS = (0x010F, 0x0110, 0x0132, 0x013B, 0x8298)  # Make, Model, DateTime, Artist, Copyright
RAW_EXIF_IFD_TAGS = (0x9003, 0x9004, 0x829A, 0x829D, 0x8827, 0x920A)  # dates, exposure, f-number, ISO, focal length

DET_SIZE = 640
STRIDES = (8, 16, 32)
ANCHORS_PER_CELL = 2
# A face counts when the detector is at least this sure of it.
FACE_SCORE = 0.6
# A sideways orientation must beat upright by this much to win.
ROTATE_MARGIN = 0.15

# PIL rotates counter-clockwise for positive angles: -90 is a clockwise quarter turn.
ORIENTATIONS = (0, -90, 90)


# ---------------------------------------------------------------- detection

class FaceDetector:
    """SCRFD-500M, decoded exactly like src/lib/faceMath.js decodeScrfd()."""

    def __init__(self, model: Path):
        self.session = ort.InferenceSession(str(model), providers=["CPUExecutionProvider"])
        self.input_name = self.session.get_inputs()[0].name

    def face_scores(self, image: Image.Image) -> list[float]:
        """Confidence of every face found, best first, after de-duplication."""
        scale = min(DET_SIZE / image.width, DET_SIZE / image.height)
        resized = image.convert("RGB").resize(
            (max(1, round(image.width * scale)), max(1, round(image.height * scale))), Image.BILINEAR
        )
        square = np.zeros((DET_SIZE, DET_SIZE, 3), dtype=np.float32)
        square[: resized.height, : resized.width] = np.asarray(resized, dtype=np.float32)
        blob = ((square - 127.5) / 128.0).transpose(2, 0, 1)[None]
        outputs = self.session.run(None, {self.input_name: blob})

        boxes, scores = [], []
        for level, stride in enumerate(STRIDES):
            level_scores = outputs[level].reshape(-1)
            level_boxes = outputs[level + len(STRIDES)].reshape(-1, 4) * stride
            cells = DET_SIZE // stride
            for i in np.nonzero(level_scores >= 0.5)[0]:
                cell = i // ANCHORS_PER_CELL
                cx, cy = (cell % cells) * stride, (cell // cells) * stride
                d = level_boxes[i]
                boxes.append((cx - d[0], cy - d[1], cx + d[2], cy + d[3]))
                scores.append(float(level_scores[i]))
        return [scores[i] for i in nms(boxes, scores)]


def nms(boxes, scores, threshold=0.4) -> list[int]:
    kept: list[int] = []
    for i in sorted(range(len(scores)), key=lambda k: -scores[k]):
        if all(iou(boxes[i], boxes[j]) < threshold for j in kept):
            kept.append(i)
    return kept


def iou(a, b) -> float:
    w = min(a[2], b[2]) - max(a[0], b[0])
    h = min(a[3], b[3]) - max(a[1], b[1])
    if w <= 0 or h <= 0:
        return 0.0
    inter = w * h
    return inter / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter)


def orientation_strength(scores: list[float]) -> float:
    """How convincingly an orientation shows upright faces: best score, plus a little per extra face."""
    good = [s for s in scores if s >= FACE_SCORE]
    return (good[0] + 0.05 * (len(good) - 1)) if good else 0.0


def best_rotation(detector: FaceDetector, image: Image.Image) -> int:
    """0, -90 or 90 - the PIL rotate() angle that makes the faces upright."""
    # Detection runs on a small copy; the angle is then applied to the full image.
    small = image.copy()
    small.thumbnail((1280, 1280))
    strength = {angle: orientation_strength(detector.face_scores(small.rotate(angle, expand=True) if angle else small))
                for angle in ORIENTATIONS}
    angle = max((-90, 90), key=strength.get)
    return angle if strength[angle] > 0 and strength[angle] >= strength[0] + ROTATE_MARGIN else 0


# ---------------------------------------------------------------- processing

@dataclass
class Result:
    name: str
    size_in: tuple[int, int]
    size_out: tuple[int, int]
    exif_fixed: bool
    rotated: int
    output: Path


@dataclass
class Loaded:
    upright: Image.Image
    stored_size: tuple[int, int]  # as the pixels sit in the file
    exif_fixed: bool  # whether the camera's orientation tag turned it
    exif: Image.Exif
    icc: bytes | None


def load_image(path: Path) -> Loaded:
    with Image.open(path) as original:
        original.load()
        exif_fixed = original.getexif().get(0x0112, 1) != 1
        upright = ImageOps.exif_transpose(original)
        return Loaded(upright, original.size, exif_fixed, upright.getexif(), original.info.get("icc_profile"))


def load_raw(path: Path) -> Loaded:
    import rawpy  # only needed when the folder has RAW files

    with rawpy.imread(str(path)) as raw:
        flip = raw.sizes.flip
        preview = None
        try:
            thumb = raw.extract_thumb()
            if thumb.format == rawpy.ThumbFormat.JPEG:
                preview = Image.open(io.BytesIO(thumb.data))
                preview.load()
        except (rawpy.LibRawNoThumbnailError, rawpy.LibRawUnsupportedThumbnailError):
            pass

        if preview is not None and max(preview.size) >= MIN_PREVIEW_SIDE:
            # The preview is stored as the sensor saw it; its own EXIF (if any)
            # is ignored so the orientation is applied exactly once, from LibRaw.
            stored = preview.size
            icc = preview.info.get("icc_profile")
            image = preview.convert("RGB")
            upright = image.transpose(LIBRAW_FLIP[flip]) if flip in LIBRAW_FLIP else image
        else:
            # LibRaw applies the orientation itself while developing (sRGB, 8-bit).
            upright = Image.fromarray(raw.postprocess(use_camera_wb=True, output_bps=8))
            stored = upright.size[::-1] if flip in (5, 6) else upright.size
            icc = None

    return Loaded(upright, stored, flip in LIBRAW_FLIP, raw_exif(path), icc)


def raw_exif(path: Path) -> Image.Exif:
    """Date, camera and exposure from a RAW, without its TIFF structure tags."""
    exif = Image.Exif()
    try:
        with Image.open(path) as tiff:  # Pillow reads a CR2's TIFF header, not its pixels
            source = tiff.getexif()
            for tag in RAW_EXIF_TAGS:
                if tag in source:
                    exif[tag] = source[tag]
            details = source.get_ifd(0x8769)
            kept = {tag: details[tag] for tag in RAW_EXIF_IFD_TAGS if tag in details}
            if kept:
                exif.get_ifd(0x8769).update(kept)
    except Exception:
        pass  # metadata is a nicety - never fail a photo over it
    return exif


def straighten(path: Path, output: Path, detector: FaceDetector | None, force: bool) -> Result:
    loaded = load_raw(path) if path.suffix.lower() in RAW_EXTENSIONS else load_image(path)
    upright, exif = loaded.upright, loaded.exif

    angle = -90 if force else (best_rotation(detector, upright) if detector else 0)
    straight = upright.rotate(angle, expand=True) if angle else upright

    # A quarter turn swaps width and height and nothing else - no crop, no padding.
    expected = (upright.height, upright.width) if angle else upright.size
    if straight.size != expected:
        raise RuntimeError(f"size changed unexpectedly: {upright.size} -> {straight.size}")

    exif[0x0112] = 1  # the pixels are upright now; a stale tag would turn them again
    straight.convert("RGB").save(output, "JPEG", quality=95, exif=exif.tobytes(), icc_profile=loaded.icc)
    return Result(path.name, loaded.stored_size, straight.size, loaded.exif_fixed, angle, output)


def has_jpeg_twin(path: Path) -> bool:
    """IMG_0001.CR2 next to IMG_0001.JPG - the camera shot RAW+JPEG."""
    return any(path.with_suffix(ext).exists() or path.with_suffix(ext.upper()).exists() for ext in JPEG_EXTENSIONS)


def output_path(path: Path, out_dir: Path, claimed: set[str]) -> Path:
    """<stem>.jpg in out_dir, or <stem>-2.jpg ... when another source already took that name."""
    name, n = f"{path.stem}.jpg", 1
    while name.lower() in claimed:
        n += 1
        name = f"{path.stem}-{n}.jpg"
    claimed.add(name.lower())
    return out_dir / name


def load_env(path: Path) -> None:
    """Minimal .env reader so the script finds VITE_SUPABASE_URL like the site does."""
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip("'\""))


def make_uploader():
    from supabase import create_client  # only needed with --upload

    load_env(ROOT / ".env")
    url = os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        sys.exit("--upload needs VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (in .env or the environment)")
    storage = create_client(url, key).storage.from_(BUCKET)

    def upload(file: Path) -> str:
        remote = f"originals/{uuid.uuid4()}.jpg"
        storage.upload(remote, file.read_bytes(), {"content-type": "image/jpeg", "cache-control": "31536000"})
        return remote

    return upload


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("src", type=Path, help="folder with the original photos (searched recursively)")
    parser.add_argument("--out", type=Path, required=True, help="where the upright copies go")
    parser.add_argument("--upload", action="store_true", help=f"also upload to the {BUCKET} bucket under originals/")
    parser.add_argument("--force-rotate", nargs="*", default=[], metavar="NAME",
                        help="file names to turn 90 degrees clockwise no matter what the detector says")
    parser.add_argument("--no-auto-rotate", action="store_true", help="only apply EXIF orientation")
    args = parser.parse_args()

    if args.out.resolve() == args.src.resolve():
        sys.exit("--out must be a different folder - the originals are never overwritten")
    args.out.mkdir(parents=True, exist_ok=True)
    files = sorted(p for p in args.src.rglob("*") if p.suffix.lower() in EXTENSIONS and not p.name.startswith("."))
    if not files:
        sys.exit(f"no images in {args.src}")

    detector = None if args.no_auto_rotate else FaceDetector(DETECTOR)
    upload = make_uploader() if args.upload else None
    manifest_path = args.out / "upload_manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    forced = set(args.force_rotate)

    counts = {"exif": 0, "rotated": 0, "uploaded": 0, "skipped": 0, "failed": 0}
    claimed: set[str] = set()
    for n, path in enumerate(files, 1):
        prefix = f"[{n}/{len(files)}] {path.name}"
        if path.suffix.lower() in RAW_EXTENSIONS and has_jpeg_twin(path):
            counts["skipped"] += 1
            print(f"{prefix}: skipped - the camera's JPEG of the same shot is used instead")
            continue
        try:
            result = straighten(path, output_path(path, args.out, claimed), detector, path.name in forced)
            notes = []
            if path.suffix.lower() in RAW_EXTENSIONS:
                notes.append(f"RAW -> {result.output.name}")
            if result.exif_fixed:
                counts["exif"] += 1
                notes.append("EXIF applied")
            if result.rotated:
                counts["rotated"] += 1
                notes.append(f"turned {'clockwise' if result.rotated < 0 else 'counter-clockwise'}")
            source = path.relative_to(args.src).as_posix()  # unique even when names repeat across subfolders
            if upload and source not in manifest:
                manifest[source] = upload(result.output)
                manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False))
                counts["uploaded"] += 1
                notes.append("uploaded")
            size = lambda s: f"{s[0]}x{s[1]}"
            print(f"{prefix}: {size(result.size_in)} -> {size(result.size_out)} {', '.join(notes) or 'unchanged'}")
        except Exception as err:  # keep going - one bad file must not stop 1,300
            counts["failed"] += 1
            print(f"{prefix}: FAILED - {err}", file=sys.stderr)

    print(
        f"\nDone: {len(files)} photos, {counts['exif']} EXIF-oriented, {counts['rotated']} turned upright, "
        f"{counts['uploaded']} uploaded, {counts['skipped']} RAW skipped (JPEG twin), {counts['failed']} failed.\n"
        f"Next: /admin/photos -> choose folder -> {args.out}"
    )


if __name__ == "__main__":
    main()
