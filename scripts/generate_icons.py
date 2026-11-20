#!/usr/bin/env python3
"""Genera tutte le icone PWA da un'unica immagine sorgente.

Uso:
    1. Salva l'icona definitiva come  assets/icon-source.png  (quadrata, >= 1024 px consigliati)
    2. npm run icons

Se assets/icon-source.png non esiste, viene generata un'icona SEGNAPOSTO (piatto + posate).
Output (in public/):  icons/pwa-192.png, icons/pwa-512.png, icons/pwa-maskable-512.png,
                      apple-touch-icon.png (180), favicon.png (64)
"""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "icon-source.png"
PUB = ROOT / "public"
BG = (255, 247, 238)      # --bg Mochi
BRAND = (176, 82, 15)     # --brand Mochi
PEACH = (255, 205, 150)


def placeholder(size: int = 1024) -> Image.Image:
    img = Image.new("RGB", (size, size), BG)
    d = ImageDraw.Draw(img)
    # sfumatura morbida
    for i in range(size):
        t = i / size
        c = tuple(int(BG[k] * (1 - t) + PEACH[k] * t) for k in range(3))
        d.line([(0, i), (size, i)], fill=c)
    cx, cy, r = size // 2, size // 2, int(size * 0.30)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(255, 253, 249), outline=BRAND, width=size // 40)
    r2 = int(r * 0.62)
    d.ellipse([cx - r2, cy - r2, cx + r2, cy + r2], outline=PEACH, width=size // 60)
    # forchetta (sx) e cucchiaio (dx)
    w = size // 34
    fx = cx - int(r * 1.35)
    for dx in (-w * 2, 0, w * 2):
        d.rounded_rectangle([fx + dx - w // 2, cy - r, fx + dx + w // 2, cy - r // 4], radius=w // 2, fill=BRAND)
    d.rounded_rectangle([fx - w * 2.5, cy - r // 2, fx + w * 2.5, cy - r // 4], radius=w, fill=BRAND)
    d.rounded_rectangle([fx - w // 2, cy - r // 4, fx + w // 2, cy + r], radius=w // 2, fill=BRAND)
    sx = cx + int(r * 1.35)
    d.ellipse([sx - w * 2.4, cy - r, sx + w * 2.4, cy - r // 8], fill=BRAND)
    d.rounded_rectangle([sx - w // 2, cy - r // 8, sx + w // 2, cy + r], radius=w // 2, fill=BRAND)
    return img


def load() -> Image.Image:
    if SRC.exists():
        im = Image.open(SRC).convert("RGBA")
        side = min(im.size)
        left, top = (im.width - side) // 2, (im.height - side) // 2
        im = im.crop((left, top, left + side, top + side))
        bg = Image.new("RGB", im.size, BG)
        bg.paste(im, mask=im.split()[3])
        return bg
    print("assets/icon-source.png non trovato: uso l'icona segnaposto")
    return placeholder()


def main() -> None:
    src = load()
    (PUB / "icons").mkdir(parents=True, exist_ok=True)
    resize = lambda n: src.resize((n, n), Image.LANCZOS)
    resize(192).save(PUB / "icons" / "pwa-192.png")
    resize(512).save(PUB / "icons" / "pwa-512.png")
    # maskable: contenuto nel 80% centrale (safe zone), bordo pieno del colore di sfondo
    canvas = Image.new("RGB", (512, 512), BG)
    inner = src.resize((410, 410), Image.LANCZOS)
    canvas.paste(inner, (51, 51))
    canvas.save(PUB / "icons" / "pwa-maskable-512.png")
    resize(180).save(PUB / "apple-touch-icon.png")
    resize(64).save(PUB / "favicon.png")
    print("Icone generate in public/")


if __name__ == "__main__":
    main()
