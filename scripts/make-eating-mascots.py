"""Genera le immagini dei gattini che mangiano (public/cats/*-*.png).

Parte dai PNG dei gattini (già senza la fessura del salvadanaio, vedi remove-coin-slot.py) e disegna davanti un
piatto di cibo in stile piatto/acquerello, con contorno marrone come quello dei gattini. Il cibo copre il petto e il
campanellino: così sembra che il gattino faccia capolino da dietro il piatto.

Uso: python3 scripts/make-eating-mascots.py
"""
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

CATS = Path(__file__).resolve().parent.parent / 'public' / 'cats'
S = 4                       # supercampionamento
OUT = (92, 62, 48, 255)     # contorno
LW = 2 * S                  # spessore del contorno


def rgba(h, a=255):
    h = h.lstrip('#')
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), a)


class Canvas:
    def __init__(self, w, h):
        self.w, self.h = w, h
        self.im = Image.new('RGBA', (w * S, h * S), (0, 0, 0, 0))
        self.d = ImageDraw.Draw(self.im)

    def P(self, pts):
        return [(x * S, y * S) for x, y in pts]

    def ellipse(self, x0, y0, x1, y1, fill, outline=True, w=LW):
        self.d.ellipse([x0 * S, y0 * S, x1 * S, y1 * S], fill=rgba(fill), outline=OUT if outline else None, width=w)

    def poly(self, pts, fill, outline=True):
        self.d.polygon(self.P(pts), fill=rgba(fill), outline=OUT if outline else None)
        if outline:
            self.d.line(self.P(pts + [pts[0]]), fill=OUT, width=LW, joint='curve')

    def line(self, pts, fill=None, w=LW):
        self.d.line(self.P(pts), fill=fill or OUT, width=w, joint='curve')

    def rrect(self, x0, y0, x1, y1, r, fill, outline=True):
        self.d.rounded_rectangle([x0 * S, y0 * S, x1 * S, y1 * S], r * S, fill=rgba(fill), outline=OUT if outline else None, width=LW)

    def half(self, cx, cy, a, b, fill, top=True, outline=True, n=40):
        """Mezza ellisse (cupola verso l'alto o ciotola verso il basso)."""
        sign = -1 if top else 1
        pts = [(cx + a * math.cos(math.pi * i / n), cy + sign * b * math.sin(math.pi * i / n)) for i in range(n + 1)]
        self.poly(pts, fill, outline)

    def sparkle(self, cx, cy, r, fill='#ffd66b'):
        pts = []
        for i in range(8):
            ang = math.pi / 4 * i - math.pi / 2
            rr = r if i % 2 == 0 else r * 0.38
            pts.append((cx + rr * math.cos(ang), cy + rr * math.sin(ang)))
        self.poly(pts, fill, outline=False)

    def heart(self, cx, cy, r, fill='#f08a9a'):
        pts = []
        for i in range(60):
            t = 2 * math.pi * i / 60
            x = 16 * math.sin(t) ** 3
            y = -(13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t))
            pts.append((cx + x * r / 16, cy + y * r / 16))
        self.poly(pts, fill, outline=False)

    def done(self):
        return self.im.resize((self.w, self.h), Image.LANCZOS)


def shade(c, f):
    c = rgba(c)
    return '#%02x%02x%02x' % tuple(max(0, min(255, int(v * f))) for v in c[:3])


# ---------------- cibi (ognuno si disegna con il centro del bordo superiore in (cx, y)) ----------------

def rice_bowl(c, cx, y, a=62):
    """Ciotola di riso con le bacchette."""
    c.half(cx, y + 8, a, a * 0.5, '#e9e2d3', top=True, outline=True)               # cupola di riso (ombra)
    c.half(cx, y + 8, a - 3, a * 0.5 - 3, '#fffdf7', top=True, outline=False)
    for gx, gy in ((-26, -15), (-8, -24), (14, -20), (30, -9), (-36, -5), (2, -9), (22, -28)):
        c.ellipse(cx + gx - 3, y + 8 + gy - 2, cx + gx + 3, y + 8 + gy + 2, '#efe7d6', outline=False)
    c.half(cx, y + 8, a + 6, a * 0.78, '#7aa6c8', top=False)                       # ciotola
    c.half(cx, y + 8, a + 6, a * 0.78, '#7aa6c8', top=False, outline=False)
    c.line([(cx - a - 3, y + 8), (cx + a + 3, y + 8)], w=LW)
    c.rrect(cx - a * 0.45, y + a * 0.74, cx + a * 0.45, y + a * 0.9, 3, '#5d86a8')   # piede
    c.line([(cx - a + 8, y + 26), (cx - a * 0.2, y + a * 0.55)], fill='#a9c8e0', w=3 * S)  # riflesso


def fish_plate(c, cx, y, a=66):
    """Piatto con un pesce."""
    c.ellipse(cx - a, y, cx + a, y + a * 0.5, '#fbf6ec')
    c.ellipse(cx - a + 9, y + 5, cx + a - 9, y + a * 0.5 - 5, '#efe7d6', outline=False)
    fx, fy = cx, y + a * 0.2
    c.poly([(fx + 26, fy), (fx + 50, fy - 14), (fx + 46, fy), (fx + 50, fy + 14)], '#ee8f6a')           # coda
    c.ellipse(fx - 34, fy - 16, fx + 34, fy + 16, '#f6a37e')                                             # corpo
    c.poly([(fx - 4, fy - 15), (fx + 10, fy - 26), (fx + 16, fy - 14)], '#ee8f6a')                       # pinna
    for k in (0, 1, 2):
        c.line([(fx + 2 + k * 9, fy - 8), (fx + 6 + k * 9, fy), (fx + 2 + k * 9, fy + 8)], fill='#d97a58', w=S)
    c.ellipse(fx - 24, fy - 6, fx - 17, fy + 1, '#3b2a22', outline=False)                               # occhio
    c.ellipse(fx - 22.5, fy - 5, fx - 20.5, fy - 3, '#ffffff', outline=False)
    c.sparkle(cx + a - 6, y - 8, 7)


def milk_glass(c, cx, y, a=44):
    """Bicchiere di latte con la cannuccia."""
    c.line([(cx + 6, y + 4), (cx + 24, y - 34)], fill='#e86a7a', w=4 * S)
    c.poly([(cx - a * 0.62, y), (cx + a * 0.62, y), (cx + a * 0.46, y + 62), (cx - a * 0.46, y + 62)], '#e4f1fa')       # vetro
    c.poly([(cx - a * 0.6, y + 12), (cx + a * 0.6, y + 12), (cx + a * 0.45, y + 60), (cx - a * 0.45, y + 60)], '#ffffff', outline=False)  # latte
    c.line([(cx - a * 0.42, y + 20), (cx - a * 0.3, y + 52)], fill='#cfe6f6', w=3 * S)
    c.ellipse(cx - a * 0.62, y - 4, cx + a * 0.62, y + 8, '#f3f9fd')
    for k, (dx, dy) in enumerate(((-34, -12), (40, 10), (46, -22))):
        c.heart(cx + dx, y + dy, 5 + k % 2 * 2)


def pizza(c, cx, y, a=64):
    """Una fetta di pizza su un piatto."""
    c.ellipse(cx - a, y + 18, cx + a, y + 18 + a * 0.5, '#fbf6ec')
    c.poly([(cx - 40, y + 20), (cx + 40, y + 20), (cx, y + 78)], '#f6c453')                # formaggio
    c.rrect(cx - 44, y + 10, cx + 44, y + 26, 8, '#e0a45a')                                # crosta
    for px, py in ((-16, 36), (12, 34), (-2, 54)):
        c.ellipse(cx + px - 8, y + py - 8, cx + px + 8, y + py + 8, '#e0584f')
        c.ellipse(cx + px - 3, y + py - 3, cx + px + 1, y + py + 1, '#f19089', outline=False)
    c.sparkle(cx + a - 4, y + 2, 8)


def table_with_food(c, cx, y, w):
    """Tavolo di legno con onigiri e fragole, per la coppia."""
    c.rrect(8, y, w - 8, y + 70, 10, '#e2b98a')
    c.line([(18, y + 22), (w - 18, y + 22)], fill='#c99a68', w=S)
    c.line([(18, y + 46), (w - 18, y + 46)], fill='#c99a68', w=S)
    # onigiri
    ox = cx - 70
    c.poly([(ox, y - 38), (ox - 30, y + 8), (ox + 30, y + 8)], '#fffdf7')
    c.ellipse(ox - 33, y - 4, ox + 33, y + 16, '#fffdf7', outline=False)
    c.line([(ox - 30, y + 8), (ox + 30, y + 8)], w=LW)
    c.rrect(ox - 14, y - 6, ox + 14, y + 12, 3, '#2d3a35')
    # fragole
    for k, fx in enumerate((cx + 20, cx + 56, cx + 92)):
        fy = y - 4 + (k % 2) * 4
        c.poly([(fx - 15, fy - 12), (fx + 15, fy - 12), (fx + 3, fy + 18), (fx - 3, fy + 18)], '#e8566b')
        c.ellipse(fx - 16, fy - 18, fx + 16, fy - 2, '#e8566b', outline=False)
        c.line([(fx - 15, fy - 10), (fx - 3, fy + 18), (fx + 3, fy + 18), (fx + 15, fy - 10)], w=LW)
        for sx, sy in ((-6, -2), (5, -4), (0, 6), (-2, 12)):
            c.ellipse(fx + sx - 1, fy + sy - 1, fx + sx + 1.5, fy + sy + 2, '#ffd6a0', outline=False)
        c.poly([(fx - 10, fy - 14), (fx, fy - 22), (fx + 10, fy - 14), (fx, fy - 11)], '#6aa84f')
    c.heart(cx + 120, y - 30, 7)
    c.sparkle(cx - 118, y - 44, 8)


def compose(name_in, name_out, food, y_frac, x_off=0, extra_h=0, **kw):
    cat = Image.open(CATS / name_in).convert('RGBA')
    w, h = cat.size
    top = int(h * y_frac)
    c = Canvas(w, h + extra_h)
    c.im.paste(cat.resize((w * S, h * S), Image.LANCZOS), (0, 0))
    food(c, w // 2 + x_off, top, **kw)
    out = c.done()
    out.save(CATS / name_out, optimize=True)
    print(name_out, out.size)


def main():
    compose('mochi.png', 'mochi-rice.png', rice_bowl, 0.72, extra_h=30)
    compose('zenitsu.png', 'zenitsu-fish.png', fish_plate, 0.76, extra_h=24)
    compose('mochi.png', 'mochi-milk.png', milk_glass, 0.70, x_off=-4, extra_h=26)
    compose('zenitsu.png', 'zenitsu-pizza.png', pizza, 0.72, extra_h=40)
    pair = Image.open(CATS / 'pair.png').convert('RGBA')
    w, h = pair.size
    c = Canvas(w, h)
    c.im.paste(pair.resize((w * S, h * S), Image.LANCZOS), (0, 0))
    table_with_food(c, w // 2, int(h * 0.80), w)
    c.done().save(CATS / 'pair-table.png', optimize=True)
    print('pair-table.png', (w, h))


if __name__ == '__main__':
    main()
