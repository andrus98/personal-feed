#!/usr/bin/env python3
"""Genera le icone della PWA.

    pip3 install Pillow && python3 dev/make-icons.py

Sono generate e non disegnate a mano apposta: restano riproducibili invece di
essere binari di provenienza ignota dentro il repo. Il segno e' la scheda del
feed vista in astratto — le righe del titolo e il quadrato dell'anteprima.
"""

import os

from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), os.pardir, "icons")

BG = (14, 16, 20)
INK = (250, 249, 247)
ACCENT = (240, 134, 63)


def rounded(size, radius_ratio):
    image = Image.new("RGB", (size, size), BG)
    draw = ImageDraw.Draw(image)
    if radius_ratio:
        # Sfondo pieno con angoli stondati: le maschere di iOS ritagliano
        # comunque, ma su Android l'icona "any" resta quadrata.
        mask = Image.new("L", (size, size), 0)
        ImageDraw.Draw(mask).rounded_rectangle(
            (0, 0, size - 1, size - 1), radius=int(size * radius_ratio), fill=255)
        base = Image.new("RGB", (size, size), BG)
        image = Image.composite(base, Image.new("RGB", (size, size), BG), mask)
        draw = ImageDraw.Draw(image)
    return image, draw


def glyph(draw, size, inset):
    """Tre righe di testo e il quadrato dell'immagine, come nelle schede."""
    box = size - inset * 2
    left = inset
    top = inset
    thumb = int(box * 0.30)
    gap = int(box * 0.115)
    bar_h = max(2, int(box * 0.105))
    bar_w = box - thumb - gap
    radius = bar_h // 2

    draw.rounded_rectangle(
        (left + box - thumb, top, left + box, top + thumb),
        radius=int(thumb * 0.22), fill=ACCENT)

    widths = (bar_w, bar_w, int(bar_w * 0.62))
    for index, width in enumerate(widths):
        y = top + index * (bar_h + gap)
        fill = INK if index == 0 else tuple(int(c * 0.55) for c in INK)
        draw.rounded_rectangle((left, y, left + width, y + bar_h), radius=radius, fill=fill)

    y = top + thumb + gap
    for index, width in enumerate((box, int(box * 0.84), int(box * 0.45))):
        yy = y + index * (bar_h + gap)
        fill = tuple(int(c * 0.42) for c in INK)
        draw.rounded_rectangle((left, yy, left + width, yy + bar_h), radius=radius, fill=fill)


def build(size, name, inset_ratio):
    image, draw = rounded(size, 0.22 if "maskable" not in name else 0)
    glyph(draw, size, int(size * inset_ratio))
    path = os.path.abspath(os.path.join(OUT, name))
    image.save(path, "PNG")
    print("  %-28s %d×%d" % (name, size, size))


def main():
    os.makedirs(os.path.abspath(OUT), exist_ok=True)
    print("icone generate in icons/:")
    build(180, "icon-180.png", 0.22)
    build(192, "icon-192.png", 0.22)
    build(512, "icon-512.png", 0.22)
    # Maskable: Android ritaglia fino al 20% per lato, quindi il segno sta piu'
    # dentro e lo sfondo copre tutto il quadrato.
    build(512, "icon-maskable-512.png", 0.30)


if __name__ == "__main__":
    main()
