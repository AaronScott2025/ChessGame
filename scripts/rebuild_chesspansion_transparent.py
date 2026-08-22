"""Rebuild Chesspansion pieces with transparent outer backgrounds.

Preserves black outlines and internal black features by protecting dark
pixels adjacent to visible content before edge flood-fill.
"""
from __future__ import annotations

from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image

ASSETS = Path(r"C:\Users\aaron\.cursor\projects\c-Users-aaron-OneDrive-Desktop-Chesshehe-ChessGame\assets")
ROOT = Path(r"c:\Users\aaron\OneDrive\Desktop\Chesshehe\ChessGame\client\public\Chesspansion")

# User originals recovered from Recycle Bin (pre-transparency)
RECOVERY = {
    "Pawns": Path(r"C:\$Recycle.Bin\S-1-5-21-3315124135-3021538801-2778854597-1003\$ROGXMWU"),
    "Rooks": Path(r"C:\$Recycle.Bin\S-1-5-21-3315124135-3021538801-2778854597-1003\$RYEF18A"),
}

JOBS = [
    ("HorseWhite.png", "Knights", "Horse"),
    ("SnakeWhite.png", "Knights", "Snake"),
    ("PigWhite.png", "Knights", "Pig"),
    ("BishopWhite.png", "Bishops", "Bishop"),
    ("ScammanWhite.png", "Bishops", "Scamman"),
    ("WizardWhite.png", "Bishops", "Wizard"),
    ("QueenWhite.png", "Queens", "Queen"),
    ("AngelWhite.png", "Queens", "Angel"),
    ("GhostWhite.png", "Queens", "Ghost"),
    ("ReaperWhite.png", "Queens", "Reaper"),
    ("PrincePrincessWhite.png", "Wildcards", "PrincePrincess"),
    ("DemonWhite.png", "Wildcards", "Demon"),
    ("MimicWhite.png", "Wildcards", "Mimic"),
    ("KingWhite.png", "Kings", "King"),
]

SIZE = 1000
BODY_BLACK = 58
# Only near-pure black can be background
BLACK_MAX = 28
# Anything brighter/colorful is piece content
CONTENT_MIN = 42
CHROMA_MIN = 28
# Grow content so black outlines next to the body are protected
BORDER_PROTECT_PX = 5
PAD = 40


def dilate(mask: np.ndarray, iterations: int) -> np.ndarray:
    out = mask.copy()
    for _ in range(iterations):
        nxt = out.copy()
        nxt[1:, :] |= out[:-1, :]
        nxt[:-1, :] |= out[1:, :]
        nxt[:, 1:] |= out[:, :-1]
        nxt[:, :-1] |= out[:, 1:]
        # diagonals help seal single-pixel outline gaps
        nxt[1:, 1:] |= out[:-1, :-1]
        nxt[1:, :-1] |= out[:-1, 1:]
        nxt[:-1, 1:] |= out[1:, :-1]
        nxt[:-1, :-1] |= out[1:, 1:]
        out = nxt
    return out


def content_mask(arr: np.ndarray) -> np.ndarray:
    rgb = arr[:, :, :3].astype(np.int16)
    a = arr[:, :, 3]
    mx = rgb.max(axis=2)
    mn = rgb.min(axis=2)
    chroma = mx - mn
    return (a > 20) & ((mx >= CONTENT_MIN) | (chroma >= CHROMA_MIN))


def flood_outer_black(arr: np.ndarray) -> np.ndarray:
    """Edge-connected near-black pixels, excluding a protected rim around content."""
    h, w = arr.shape[:2]
    mx = arr[:, :, :3].max(axis=2)
    content = content_mask(arr)
    protected = dilate(content, BORDER_PROTECT_PX)
    candidate = (mx <= BLACK_MAX) & ~protected

    visited = np.zeros((h, w), dtype=bool)
    q: deque[tuple[int, int]] = deque()

    def seed(y: int, x: int) -> None:
        if 0 <= y < h and 0 <= x < w and candidate[y, x] and not visited[y, x]:
            visited[y, x] = True
            q.append((y, x))

    for x in range(w):
        seed(0, x)
        seed(h - 1, x)
    for y in range(h):
        seed(y, 0)
        seed(y, w - 1)

    while q:
        y, x = q.popleft()
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= ny < h and 0 <= nx < w and not visited[ny, nx] and candidate[ny, nx]:
                visited[ny, nx] = True
                q.append((ny, nx))
    return visited


def clear_outer_black(im: Image.Image) -> Image.Image:
    arr = np.array(im).astype(np.float32)
    bg = flood_outer_black(arr.astype(np.uint8))
    arr[bg, 3] = 0
    arr[bg, 0:3] = 0
    # Mild AA only on outer fringe far from protected content
    content = content_mask(arr.astype(np.uint8))
    protected = dilate(content, max(1, BORDER_PROTECT_PX - 1))
    dil = bg.copy()
    dil[1:, :] |= bg[:-1, :]
    dil[:-1, :] |= bg[1:, :]
    dil[:, 1:] |= bg[:, :-1]
    dil[:, :-1] |= bg[:, 1:]
    mx = arr[:, :, :3].max(axis=2)
    fringe = dil & ~bg & ~protected & (mx <= 40) & (arr[:, :, 3] > 0)
    if fringe.any():
        t = np.clip((mx[fringe] - 12) / 28.0, 0.0, 1.0)
        arr[fringe, 3] *= t
    clear = arr[:, :, 3] < 1
    arr[clear, 0:3] = 0
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGBA")


def to_canvas(im: Image.Image) -> Image.Image:
    im = im.convert("RGBA")
    canvas = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 255))
    w, h = im.size
    scale = min(SIZE / w, SIZE / h)
    nw, nh = max(1, int(w * scale)), max(1, int(h * scale))
    resized = im.resize((nw, nh), Image.Resampling.LANCZOS)
    x, y = (SIZE - nw) // 2, (SIZE - nh) // 2
    canvas.alpha_composite(resized, (x, y))
    arr = np.array(canvas)
    a = arr[:, :, 3]
    arr[a < 8] = [0, 0, 0, 255]
    return Image.fromarray(arr, "RGBA")


def make_black(white: Image.Image) -> Image.Image:
    arr = np.array(white).astype(np.float32)
    rgb = arr[:, :, :3]
    a = arr[:, :, 3]
    mx = rgb.max(axis=2)
    mn = rgb.min(axis=2)
    chroma = mx - mn
    body = (mx > 170) & (chroma < 45) & (a > 20)
    mid = (mx > 90) & (mx <= 170) & (chroma < 35) & (a > 20)
    for mask, target in ((body, float(BODY_BLACK)), (mid, BODY_BLACK * 0.85)):
        if not mask.any():
            continue
        lum = rgb[mask].mean(axis=1)
        scale = np.where(lum > 1, target / lum, 1.0)
        scale = np.clip(scale, 0.05, 1.0)
        rgb[mask] = rgb[mask] * scale[:, None]
    accent = (chroma >= 45) & (a > 20)
    if accent.any():
        rgb[accent] *= 0.82
    out = arr.copy()
    out[:, :, :3] = np.clip(rgb, 0, 255)
    return Image.fromarray(out.astype(np.uint8), "RGBA")


def trim_to_content(im: Image.Image) -> Image.Image:
    arr = np.array(im)
    # Include protected black outlines in the bbox (opaque dark counts)
    lit = arr[:, :, 3] > 12
    rows = np.where(lit.any(axis=1))[0]
    cols = np.where(lit.any(axis=0))[0]
    if len(rows) == 0 or len(cols) == 0:
        return im
    cropped = im.crop((int(cols[0]), int(rows[0]), int(cols[-1]) + 1, int(rows[-1]) + 1))
    cw, ch = cropped.size
    side = max(cw, ch) + PAD * 2
    square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    square.alpha_composite(cropped, ((side - cw) // 2, (side - ch) // 2))
    return square.resize((SIZE, SIZE), Image.Resampling.LANCZOS)


def finalize(im: Image.Image) -> Image.Image:
    return trim_to_content(clear_outer_black(im))


def process_user_original(src: Path, dest: Path) -> None:
    """Fit user art onto a black canvas, then clear only outer background."""
    im = Image.open(src).convert("RGBA")
    # If already large, place on black; if small, scale up like generated art
    canvas = to_canvas(im)
    finalize(canvas).save(dest, "PNG")


def main() -> None:
    # Restore / rebuild generated class pieces from source assets
    for src_name, folder, base in JOBS:
        src = ASSETS / src_name
        if not src.exists():
            print("MISSING", src_name)
            continue
        white_src = to_canvas(Image.open(src))
        dest = ROOT / folder
        dest.mkdir(parents=True, exist_ok=True)
        finalize(white_src).save(dest / f"{base}White.png", "PNG")
        finalize(make_black(white_src)).save(dest / f"{base}Black.png", "PNG")
        print("rebuilt", folder, base)

    # Restore Pawns / Rooks from recycle-bin originals
    for folder, src_dir in RECOVERY.items():
        dest = ROOT / folder
        dest.mkdir(parents=True, exist_ok=True)
        if not src_dir.exists():
            print("MISSING recovery", folder, src_dir)
            continue
        for path in sorted(src_dir.glob("*.png")):
            out = dest / path.name
            process_user_original(path, out)
            print("restored", out.relative_to(ROOT))

    print("done")


if __name__ == "__main__":
    main()
