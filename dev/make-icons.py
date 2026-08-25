#!/usr/bin/env python3
"""Genera le icone della PWA: il marchio FEED, bianco su nero.

    pip3 install Pillow && python3 dev/make-icons.py

Sono generate e non disegnate a mano apposta: restano riproducibili invece di
essere binari di provenienza ignota dentro il repo. Il lettering e' pesante e
stretto, nello spirito dei marchi sportivi: quattro lettere che riempiono il
quadrato, perche' a 60 pixel sulla home dell'iPhone un segno gentile sparisce.
"""

import os

from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), os.pardir, "icons")

WORD = "FEED"
BG = (0, 0, 0)
INK = (255, 255, 255)

# Impact e' la piu' stretta e pesante fra quelle di sistema. Le altre sono
# ripieghi in ordine di somiglianza, per non far fallire lo script altrove.
FONT_CANDIDATES = [
    "/System/Library/Fonts/Supplemental/Impact.ttf",
    "/System/Library/Fonts/Supplemental/Arial Black.ttf",
    "/System/Library/Fonts/Supplemental/Arial Narrow Bold.ttf",
    "/System/Library/Fonts/HelveticaNeue.ttc",
]


def font_path():
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            return path
    raise SystemExit("nessun font utilizzabile trovato fra: %s" % ", ".join(FONT_CANDIDATES))


def fitted_font(draw, text, target_width, path):
    """La dimensione che porta il testo alla larghezza voluta.

    Si cerca invece di calcolarla perche' il rapporto fra corpo e larghezza
    dipende dal font: con un ripiego diverso da Impact il numero cambierebbe.
    """
    size = 10
    while size < 2000:
        candidate = ImageFont.truetype(path, size)
        width = draw.textbbox((0, 0), text, font=candidate)[2]
        if width >= target_width:
            return ImageFont.truetype(path, max(10, size - 1))
        size += 2
    return ImageFont.truetype(path, size)


def build(size, name, fill_ratio, radius_ratio):
    image = Image.new("RGB", (size, size), BG)
    draw = ImageDraw.Draw(image)
    path = font_path()

    font = fitted_font(draw, WORD, size * fill_ratio, path)
    box = draw.textbbox((0, 0), WORD, font=font)
    x = (size - (box[2] - box[0])) / 2 - box[0]
    y = (size - (box[3] - box[1])) / 2 - box[1]
    draw.text((x, y), WORD, font=font, fill=INK)

    if radius_ratio:
        # Angoli stondati: iOS ritaglia comunque con la sua maschera, ma su
        # Android l'icona "any" resterebbe un quadrato netto.
        mask = Image.new("L", (size, size), 0)
        ImageDraw.Draw(mask).rounded_rectangle(
            (0, 0, size - 1, size - 1), radius=int(size * radius_ratio), fill=255)
        image = Image.composite(image, Image.new("RGB", (size, size), BG), mask)

    out = os.path.abspath(os.path.join(OUT, name))
    image.save(out, "PNG")
    print("  %-28s %d×%d" % (name, size, size))


def main():
    os.makedirs(os.path.abspath(OUT), exist_ok=True)
    print("icone generate in icons/ con %s:" % os.path.basename(font_path()))
    build(180, "icon-180.png", 0.78, 0.22)
    build(192, "icon-192.png", 0.78, 0.22)
    build(512, "icon-512.png", 0.78, 0.22)
    # Maskable: Android ritaglia fino al 20% per lato, quindi il marchio sta
    # piu' dentro e lo sfondo copre l'intero quadrato.
    build(512, "icon-maskable-512.png", 0.55, 0)


if __name__ == "__main__":
    main()
