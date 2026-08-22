from pathlib import Path

import numpy as np
from PIL import Image

assets = Path(r"C:\Users\aaron\.cursor\projects\c-Users-aaron-OneDrive-Desktop-Chesshehe-ChessGame\assets")
root = Path(r"c:\Users\aaron\OneDrive\Desktop\Chesshehe\ChessGame\client\public\Chesspansion")

jobs = [
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
    rgb = arr[:, :, :3].astype(np.int16)
    a = arr[:, :, 3]
    dark = (rgb.max(axis=2) < 28) & (a > 0)
    arr[dark, 0:3] = 0
    trans = a < 8
    arr[trans] = [0, 0, 0, 255]
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


def main() -> None:
    for src_name, folder, base in jobs:
        src = assets / src_name
        if not src.exists():
            print("MISSING", src_name)
            continue
        white = to_canvas(Image.open(src))
        dest_dir = root / folder
        dest_dir.mkdir(parents=True, exist_ok=True)
        white_path = dest_dir / f"{base}White.png"
        black_path = dest_dir / f"{base}Black.png"
        white.save(white_path, "PNG")
        make_black(white).save(black_path, "PNG")
        print("wrote", white_path.relative_to(root), black_path.name)

    print("done")


if __name__ == "__main__":
    main()
