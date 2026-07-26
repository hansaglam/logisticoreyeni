#!/usr/bin/env python3
"""
Normalize fleet trailer PNG assets: trim transparent margins, pad, place on 1024x1024 canvas.
Does not alter colors, perspective, or trailer design — crop/resize/canvas only.
"""

from __future__ import annotations

import hashlib
import json
import shutil
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
TRAILER_DIR = ROOT / "assets" / "fleet" / "trailers"
ORIGINALS_DIR = TRAILER_DIR / "originals"

FILES = [
    "standard-trailer.png",
    "heavy-haul-trailer.png",
    "refrigerated-trailer.png",
    "container-trailer.png",
]

ALPHA_THRESHOLD = 8
PADDING_RATIO = 0.06  # 5–7% safe padding
CANVAS_SIZE = 1024
TARGET_WIDTH_RATIO = 0.88  # 86–90% of canvas width
BOTTOM_MARGIN = 64
TOP_MIN_MARGIN = 40


def file_md5(path: Path) -> str:
    return hashlib.md5(path.read_bytes()).hexdigest()


def content_hash(img: Image.Image) -> str:
    """Hash RGBA pixel data for before/after crop comparison."""
    return hashlib.sha256(img.tobytes()).hexdigest()[:16]


def alpha_bbox(img: Image.Image, threshold: int = ALPHA_THRESHOLD) -> tuple[int, int, int, int]:
    alpha = img.split()[3]
    mask = alpha.point(lambda p: 255 if p > threshold else 0)
    return mask.getbbox() or (0, 0, img.width, img.height)


def corner_alphas(img: Image.Image) -> list[int]:
    w, h = img.size
    corners = [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]
    px = img.load()
    return [px[x, y][3] for x, y in corners]


def fill_ratio(img: Image.Image, threshold: int = ALPHA_THRESHOLD) -> float:
    alpha = img.split()[3]
    visible = sum(1 for p in alpha.getdata() if p > threshold)
    return visible / (img.width * img.height)


def crop_with_padding(img: Image.Image, bbox: tuple[int, int, int, int]) -> Image.Image:
    left, top, right, bottom = bbox
    bw = right - left
    bh = bottom - top
    pad_x = max(1, int(bw * PADDING_RATIO))
    pad_y = max(1, int(bh * PADDING_RATIO))
    left = max(0, left - pad_x)
    top = max(0, top - pad_y)
    right = min(img.width, right + pad_x)
    bottom = min(img.height, bottom + pad_y)
    return img.crop((left, top, right, bottom))


def normalize_trailer(path: Path) -> dict:
    original = Image.open(path).convert("RGBA")
    orig_size = original.size
    orig_md5 = file_md5(path)
    bbox = alpha_bbox(original)
    cropped = crop_with_padding(original, bbox)
    crop_hash = content_hash(cropped)
    crop_size = cropped.size

    target_w = int(CANVAS_SIZE * TARGET_WIDTH_RATIO)
    scale = target_w / cropped.width
    new_w = target_w
    new_h = int(cropped.height * scale)

    max_h = CANVAS_SIZE - BOTTOM_MARGIN - TOP_MIN_MARGIN
    if new_h > max_h:
        scale = max_h / cropped.height
        new_h = max_h
        new_w = int(cropped.width * scale)

    resized = cropped.resize((new_w, new_h), Image.Resampling.LANCZOS)

    canvas = Image.new("RGBA", (CANVAS_SIZE, CANVAS_SIZE), (0, 0, 0, 0))
    x = (CANVAS_SIZE - new_w) // 2
    y = CANVAS_SIZE - BOTTOM_MARGIN - new_h
    canvas.paste(resized, (x, y), resized)

    canvas.save(path, format="PNG", optimize=False)

    return {
        "file": path.name,
        "original_size": {"width": orig_size[0], "height": orig_size[1]},
        "alpha_bbox": {"left": bbox[0], "top": bbox[1], "right": bbox[2], "bottom": bbox[3]},
        "cropped_size": {"width": crop_size[0], "height": crop_size[1]},
        "placed_size": {"width": new_w, "height": new_h, "x": x, "y": y},
        "new_size": {"width": CANVAS_SIZE, "height": CANVAS_SIZE},
        "fill_ratio_percent": round(fill_ratio(canvas) * 100, 2),
        "corners_transparent": all(a == 0 for a in corner_alphas(canvas)),
        "original_file_md5": orig_md5,
        "new_file_md5": file_md5(path),
        "cropped_content_hash": crop_hash,
        "design_altered": False,
        "backup_created": True,
    }


def main() -> None:
    ORIGINALS_DIR.mkdir(parents=True, exist_ok=True)
    reports: list[dict] = []

    for name in FILES:
        src = TRAILER_DIR / name
        backup = ORIGINALS_DIR / name
        if not src.exists():
            raise FileNotFoundError(f"Missing source asset: {src}")
        if not backup.exists():
            shutil.copy2(src, backup)
        report = normalize_trailer(src)
        report["backup_path"] = str(backup.relative_to(ROOT)).replace("\\", "/")
        reports.append(report)

    out = TRAILER_DIR / "normalization-report.json"
    out.write_text(json.dumps(reports, indent=2), encoding="utf-8")
    print(json.dumps(reports, indent=2))


if __name__ == "__main__":
    main()
