"""Generate Yeti and TimeKeeper Chesspansion PNGs (white + black pairs)."""

from __future__ import annotations

import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

SIZE = 1000
BODY_BLACK = 58
OUTLINE = (0, 0, 0, 255)
BODY_WHITE = (255, 255, 255, 255)
ICE = (120, 210, 255, 255)
EYE = (255, 140, 40, 255)
CLOCK_GOLD = (255, 196, 60, 255)
CLOCK_FACE = (255, 240, 180, 255)
CLOCK_HAND = (40, 40, 40, 255)
BASE_TOP_Y = 900


def octagon_points(cx: float, cy: float, rx: float, ry: float, rotation: float = 0.0) -> list[tuple[float, float]]:
    pts: list[tuple[float, float]] = []
    for i in range(8):
        ang = rotation + i * math.pi / 4
        pts.append((cx + rx * math.cos(ang), cy + ry * math.sin(ang)))
    return pts


def draw_base(draw: ImageDraw.ImageDraw) -> None:
    draw.polygon(
        [(220, BASE_TOP_Y), (780, BASE_TOP_Y), (800, 928), (780, 943), (220, 943), (200, 928)],
        fill=BODY_WHITE,
        outline=OUTLINE,
    )


def draw_gnome_body(draw: ImageDraw.ImageDraw) -> None:
    draw.polygon(
        [(305, BASE_TOP_Y), (695, BASE_TOP_Y), (620, 480), (380, 480)],
        fill=BODY_WHITE,
        outline=OUTLINE,
    )


def draw_gnome_head(draw: ImageDraw.ImageDraw) -> None:
    draw.polygon(
        [(380, 480), (620, 480), (670, 390), (620, 280), (380, 280), (330, 390)],
        fill=BODY_WHITE,
        outline=OUTLINE,
    )
    draw.polygon([(490, 430), (510, 430), (500, 450)], fill=OUTLINE)


def draw_yeti(draw: ImageDraw.ImageDraw) -> None:
    """Yeti rook: pedestal with head resting directly on the base."""
    draw_base(draw)

    cx = SIZE // 2
    rx, ry = 250, 230
    rotation = -math.pi / 8

    # Place head so its lowest point sits on the base top edge.
    probe = octagon_points(cx, 0, rx, ry, rotation)
    cy = BASE_TOP_Y - max(p[1] for p in probe)
    head = octagon_points(cx, cy, rx, ry, rotation)
    draw.polygon(head, fill=BODY_WHITE, outline=OUTLINE)

    # Shaggy fur crown — anchored to head top
    head_top = min(p[1] for p in head)
    fur_base_y = head_top + 20
    draw.polygon(
        [
            (320, fur_base_y),
            (360, fur_base_y - 90),
            (410, fur_base_y - 40),
            (500, fur_base_y - 130),
            (590, fur_base_y - 40),
            (640, fur_base_y - 90),
            (680, fur_base_y),
            (620, fur_base_y + 20),
            (380, fur_base_y + 20),
        ],
        fill=BODY_WHITE,
        outline=OUTLINE,
    )

    # Horns
    horn_y = head_top + 60
    draw.polygon([(340, horn_y), (290, horn_y - 90), (370, horn_y - 20)], fill=ICE, outline=OUTLINE)
    draw.polygon([(660, horn_y), (710, horn_y - 90), (630, horn_y - 20)], fill=ICE, outline=OUTLINE)

    # Brow
    brow_y = cy - 70
    draw.polygon([(390, brow_y), (610, brow_y), (590, brow_y + 30), (410, brow_y + 30)], fill=BODY_WHITE, outline=OUTLINE)

    # Eyes
    eye_y = cy + 10
    for ex in (420, 580):
        draw.ellipse((ex - 36, eye_y, ex + 36, eye_y + 70), fill=EYE, outline=OUTLINE)
        draw.polygon([(ex - 20, eye_y + 18), (ex + 20, eye_y + 18), (ex, eye_y + 48)], fill=OUTLINE)

    # Snout
    snout_y = cy + 70
    draw.polygon([(470, snout_y), (530, snout_y), (500, snout_y + 40)], fill=OUTLINE)
    draw.line([(450, snout_y + 55), (550, snout_y + 55)], fill=OUTLINE, width=5)


def draw_octagonal_clock(draw: ImageDraw.ImageDraw, cx: float, cy: float, rx: float, ry: float) -> None:
    outer = octagon_points(cx, cy, rx, ry, -math.pi / 8)
    draw.polygon(outer, fill=CLOCK_GOLD, outline=OUTLINE)

    inner = octagon_points(cx, cy, rx * 0.72, ry * 0.72, -math.pi / 8)
    draw.polygon(inner, fill=CLOCK_FACE, outline=OUTLINE)

    for i in range(12):
        ang = -math.pi / 2 + i * (2 * math.pi / 12)
        x0 = cx + math.cos(ang) * rx * 0.55
        y0 = cy + math.sin(ang) * ry * 0.55
        x1 = cx + math.cos(ang) * rx * 0.82
        y1 = cy + math.sin(ang) * ry * 0.82
        draw.line([(x0, y0), (x1, y1)], fill=OUTLINE, width=4 if i % 3 == 0 else 2)

    draw.line([(cx, cy), (cx, cy - ry * 0.45)], fill=CLOCK_HAND, width=8)
    draw.line([(cx, cy), (cx + rx * 0.35, cy + ry * 0.15)], fill=CLOCK_HAND, width=6)
    draw.ellipse((cx - 10, cy - 10, cx + 10, cy + 10), fill=OUTLINE)


def draw_timekeeper(draw: ImageDraw.ImageDraw) -> None:
    draw_base(draw)
    draw_gnome_body(draw)
    draw_gnome_head(draw)
    draw_octagonal_clock(draw, SIZE / 2, 210, 120, 105)


def finalize(im: Image.Image) -> Image.Image:
    """Keep piece art and outlines; background stays transparent."""
    arr = np.array(im.convert("RGBA"))
    rgb = arr[:, :, :3]
    alpha = arr[:, :, 3]
    # Drop accidental near-empty pixels; preserve anti-aliased edges + outlines.
    empty = (alpha < 8) | ((rgb.max(axis=2) < 8) & (alpha < 40))
    arr[empty] = [0, 0, 0, 0]
    return Image.fromarray(arr, "RGBA")


def make_black(white: Image.Image) -> Image.Image:
    arr = np.array(white).astype(np.float32)
    rgb = arr[:, :, :3]
    a = arr[:, :, 3]
    visible = a > 20
    mx = rgb[:, :, 0].copy()
    mn = rgb[:, :, 0].copy()
    for c in range(3):
        mx = np.maximum(mx, rgb[:, :, c])
        mn = np.minimum(mn, rgb[:, :, c])
    chroma = mx - mn
    body = visible & (mx > 170) & (chroma < 45)
    mid = visible & (mx > 90) & (mx <= 170) & (chroma < 35)
    for mask, target in ((body, float(BODY_BLACK)), (mid, BODY_BLACK * 0.85)):
        if not mask.any():
            continue
        lum = rgb[mask].mean(axis=1)
        scale = np.where(lum > 1, target / lum, 1.0)
        scale = np.clip(scale, 0.05, 1.0)
        rgb[mask] = rgb[mask] * scale[:, None]
    accent = visible & (chroma >= 45)
    if accent.any():
        rgb[accent] *= 0.82
    out = arr.copy()
    out[:, :, :3] = np.clip(rgb, 0, 255)
    return Image.fromarray(out.astype(np.uint8), "RGBA")


def write_pair(draw_fn, out_dir: Path, base_name: str) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    layer = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    draw_fn(draw)
    white = finalize(layer)
    black = make_black(white)
    white_path = out_dir / f"{base_name}White.png"
    black_path = out_dir / f"{base_name}Black.png"
    white.save(white_path, "PNG")
    black.save(black_path, "PNG")
    print("wrote", white_path)
    print("wrote", black_path)


def main() -> None:
    root = Path(__file__).resolve().parents[1] / "client" / "public" / "Chesspansion"
    write_pair(draw_yeti, root / "Rooks", "Yeti")
    write_pair(draw_timekeeper, root / "Wildcards", "TimeKeeper")


if __name__ == "__main__":
    main()
