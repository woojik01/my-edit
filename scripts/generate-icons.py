"""Raster variants of the existing code-mark SVG geometry (requires Pillow)."""
from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parent.parent / "app" / "public" / "icons"
scale = 4
for size, maskable in [(192, False), (512, False), (512, True)]:
    factor = size * scale / 512
    image = Image.new("RGBA", (size * scale, size * scale), "#d7f36b" if maskable else (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    if not maskable:
        draw.rounded_rectangle((0, 0, size * scale - 1, size * scale - 1), radius=140 * factor, fill="#d7f36b")
    width = round(32 * factor)
    for points in [[(184, 158), (96, 256), (184, 354)], [(328, 158), (416, 256), (328, 354)], [(297, 120), (217, 392)]]:
        actual = [(round(x * factor), round(y * factor)) for x, y in points]
        draw.line(actual, fill="#151710", width=width, joint="curve")
        for x, y in actual:
            radius = width / 2
            draw.ellipse((x-radius, y-radius, x+radius, y+radius), fill="#151710")
    filename = f"icon-{'maskable-' if maskable else ''}{size}.png"
    image.resize((size, size), Image.Resampling.LANCZOS).save(root / filename)
