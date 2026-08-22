"""Trim excess black padding from Chesspansion PNGs so pieces fill the frame."""
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(r"c:\Users\aaron\OneDrive\Desktop\Chesshehe\ChessGame\client\public\Chesspansion")
SIZE = 1000
PAD = 48  # keep a little breathing room after trim


def content_bbox(arr: np.ndarray) -> tuple[int, int, int, int] | None:
    rgb = arr[:, :, :3].astype(np.int16)
    a = arr[:, :, 3]
    # Treat near-black as empty background
    lit = (rgb.max(axis=2) > 28) | ((a > 20) & (rgb.max(axis=2) > 12))
    rows = np.where(lit.any(axis=1))[0]
    cols = np.where(lit.any(axis=0))[0]
    if len(rows) == 0 or len(cols) == 0:
        return None
    return int(rows[0]), int(rows[-1]), int(cols[0]), int(cols[-1])


def trim_and_fit(path: Path) -> bool:
    im = Image.open(path).convert("RGBA")
    arr = np.array(im)
    box = content_bbox(arr)
    if box is None:
        print("skip empty", path.name)
        return False
    top, bottom, left, right = box
    cropped = im.crop((left, top, right + 1, bottom + 1))
    cw, ch = cropped.size
    # Square canvas with padding, then scale to SIZE
    side = max(cw, ch) + PAD * 2
    square = Image.new("RGBA", (side, side), (0, 0, 0, 255))
    ox = (side - cw) // 2
    oy = (side - ch) // 2
    square.alpha_composite(cropped, (ox, oy))
    out = square.resize((SIZE, SIZE), Image.Resampling.LANCZOS)
    # Ensure opaque black background
    out_arr = np.array(out)
    dark = out_arr[:, :, :3].max(axis=2) < 18
    out_arr[dark] = [0, 0, 0, 255]
    Image.fromarray(out_arr, "RGBA").save(path, "PNG")
    return True


def main() -> None:
    n = 0
    for path in sorted(ROOT.rglob("*.png")):
        if trim_and_fit(path):
            n += 1
            print("trimmed", path.relative_to(ROOT))
    print(f"done ({n} files)")


if __name__ == "__main__":
    main()
