#!/usr/bin/env python3
"""
Straighten the party photos before face indexing, and optionally upload them.

For every image in SRC_DIR (e.g. the unzipped Google Drive folder 23/10):

  1. Apply the EXIF orientation with PIL.ImageOps.exif_transpose, so the
     pixels themselves are upright and no viewer depends on the tag.
  2. Catch photos that are still sideways - pixels stored rotated with no
     EXIF tag to say so. Rotating every landscape photo blindly would break
     the correct ones, so the script runs the same SCRFD face detector the
     site uses (public/models/det_500m.onnx) at 0, -90 and +90 degrees and
     only turns a photo when a sideways orientation clearly finds faces the
     upright one does not. Photos without faces are left as they are.
     --force-rotate NAME applies .rotate(-90, expand=True) by hand.
  3. Write the result to OUT_DIR at full resolution: same file name, same
     pixels, width/height swapped only when it was turned a quarter turn.
     Point /admin/photos at OUT_DIR - that page does the face indexing, and a
     photo is only findable on /find-photos once it has been indexed there.
  4. With --upload, also put each straightened original in the
     'event-photos' bucket under originals/<uuid>.jpg (the bucket is public,
     so file names must not be guessable) and record the mapping in
     OUT_DIR/upload_manifest.json. Needs SUPABASE_SERVICE_ROLE_KEY - keep it
     in .env, never in the repo or the browser.

Setup:
    python3 -m venv .venv && source .venv/bin/activate
    pip install pillow numpy onnxruntime supabase

Usage:
    python upload_and_rotate.py ~/Downloads/23-10 --out ~/Downloads/23-10-upright
    python upload_and_rotate.py ~/Downloads/23-10 --out ~/Downloads/23-10-upright --upload
    python upload_and_rotate.py SRC --out OUT --force-rotate IMG_0042.jpg IMG_0107.jpg
"""

from __future__ import annotations

import argparse
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
EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}

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


def straighten(path: Path, out_dir: Path, detector: FaceDetector | None, force: bool) -> Result:
    with Image.open(path) as original:
        original.load()
        raw_size = original.size
        icc = original.info.get("icc_profile")
        exif_fixed = original.getexif().get(0x0112, 1) != 1
        upright = ImageOps.exif_transpose(original)

    exif = upright.getexif()

    angle = -90 if force else (best_rotation(detector, upright) if detector else 0)
    straight = upright.rotate(angle, expand=True) if angle else upright

    # A quarter turn swaps width and height and nothing else - no crop, no padding.
    expected = (upright.height, upright.width) if angle else upright.size
    if straight.size != expected:
        raise RuntimeError(f"size changed unexpectedly: {upright.size} -> {straight.size}")

    exif[0x0112] = 1  # the pixels are upright now; a stale tag would turn them again
    output = out_dir / (path.stem + ".jpg")
    straight.convert("RGB").save(output, "JPEG", quality=95, exif=exif.tobytes(), icc_profile=icc)
    return Result(path.name, raw_size, straight.size, exif_fixed, angle, output)


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

    counts = {"exif": 0, "rotated": 0, "uploaded": 0, "failed": 0}
    for n, path in enumerate(files, 1):
        prefix = f"[{n}/{len(files)}] {path.name}"
        try:
            result = straighten(path, args.out, detector, path.name in forced)
            notes = []
            if result.exif_fixed:
                counts["exif"] += 1
                notes.append("EXIF applied")
            if result.rotated:
                counts["rotated"] += 1
                notes.append(f"turned {'clockwise' if result.rotated < 0 else 'counter-clockwise'}")
            if upload and path.name not in manifest:
                manifest[path.name] = upload(result.output)
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
        f"{counts['uploaded']} uploaded, {counts['failed']} failed.\n"
        f"Next: /admin/photos -> choose folder -> {args.out}"
    )


if __name__ == "__main__":
    main()
