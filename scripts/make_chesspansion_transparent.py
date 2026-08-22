"""Make only the outer black background transparent (keep borders + internal blacks)."""
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(r"c:\Users\aaron\OneDrive\Desktop\Chesshehe\ChessGame\client\public\Chesspansion")
BLACK_MAX = 28
CONTENT_MIN = 42
CHROMA_MIN = 28
BORDER_PROTECT_PX = 5


def dilate(mask: np.ndarray, iterations: int) -> np.ndarray:
    out = mask.copy()
    for _ in range(iterations):
        nxt = out.copy()
        nxt[1:, :] |= out[:-1, :]
        nxt[:-1, :] |= out[1:, :]
        nxt[:, 1:] |= out[:, :-1]
        nxt[:, :-1] |= out[:, 1:]
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
    chroma = mx - rgb.min(axis=2)
    return (a > 20) & ((mx >= CONTENT_MIN) | (chroma >= CHROMA_MIN))


def flood_background_mask(arr: np.ndarray) -> np.ndarray:
    h, w = arr.shape[:2]
    mx = arr[:, :, :3].max(axis=2)
    protected = dilate(content_mask(arr), BORDER_PROTECT_PX)
    is_bg_candidate = (mx <= BLACK_MAX) & ~protected

    visited = np.zeros((h, w), dtype=bool)
    queue: deque[tuple[int, int]] = deque()

    def try_seed(y: int, x: int) -> None:
        if 0 <= y < h and 0 <= x < w and is_bg_candidate[y, x] and not visited[y, x]:
            visited[y, x] = True
            queue.append((y, x))

    for x in range(w):
        try_seed(0, x)
        try_seed(h - 1, x)
    for y in range(h):
        try_seed(y, 0)
        try_seed(y, w - 1)

    while queue:
        y, x = queue.popleft()
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= ny < h and 0 <= nx < w and not visited[ny, nx] and is_bg_candidate[ny, nx]:
                visited[ny, nx] = True
                queue.append((ny, nx))

    return visited


def make_transparent(path: Path) -> None:
    im = Image.open(path).convert("RGBA")
    # Refill punched holes with black so we can re-run safely only if originals
    # are solid; for already-transparent files this cannot restore lost borders.
    solid = Image.new("RGBA", im.size, (0, 0, 0, 255))
    solid.alpha_composite(im)
    arr = np.array(solid).astype(np.float32)
    bg = flood_background_mask(arr.astype(np.uint8))
    arr[bg, 3] = 0
    arr[bg, 0:3] = 0
    clear = arr[:, :, 3] < 1
    arr[clear, 0:3] = 0
    Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGBA").save(path, "PNG")


def main() -> None:
    n = 0
    for path in sorted(ROOT.rglob("*.png")):
        make_transparent(path)
        n += 1
        print("transparent", path.relative_to(ROOT))
    print(f"done ({n} files)")


if __name__ == "__main__":
    main()
