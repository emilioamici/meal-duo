"""Toglie la fessura del salvadanaio dalla testa dei gattini (public/cats/*.png).

Le tre immagini sono le stesse di Clean Duo e MoneyDuo, dove la fessura aveva senso. Qui la si cancella:
si trova la macchia scura (con la sua riga rosa interna) a partire da un punto dentro la fessura e la si riempie
ricostruendo il pelo dai pixel intorno (diffusione, senza dipendenze oltre a Pillow e numpy).

Uso: python3 scripts/remove-coin-slot.py   (legge e riscrive public/cats/{mochi,zenitsu,pair}.png)
"""
import sys
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image

CATS = Path(__file__).resolve().parent.parent / 'public' / 'cats'
# Per ogni immagine, le fessure da togliere:
#   ('box', x0, y0, x1, y1)        riquadro che contiene la fessura (pelo chiaro: si parte dal pixel più scuro)
#   ('capsule', x0, y0, x1, y1, r) asse della fessura e mezza larghezza (pelo grigio, dove la fessura quasi tocca il contorno)
TARGETS = {
    'mochi.png': [('box', 80, 38, 118, 58)],
    'zenitsu.png': [('capsule', 96, 60, 120, 39, 6)],
    'pair.png': [('capsule', 87, 53, 110, 32, 6), ('box', 276, 53, 312, 75)],
}


def luma(a):
    return 0.299 * a[..., 0] + 0.587 * a[..., 1] + 0.114 * a[..., 2]


def grow(mask_ok, seed):
    h, w = mask_ok.shape
    seen = np.zeros_like(mask_ok)
    q = deque([seed]); seen[seed[1], seed[0]] = True
    while q:
        x, y = q.popleft()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (-1, -1), (1, -1), (-1, 1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < w and 0 <= ny < h and mask_ok[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True; q.append((nx, ny))
    return seen


def dilate(m, n=1):
    for _ in range(n):
        p = np.pad(m, 1)
        m = m | p[:-2, 1:-1] | p[2:, 1:-1] | p[1:-1, :-2] | p[1:-1, 2:] | p[:-2, :-2] | p[2:, 2:] | p[:-2, 2:] | p[2:, :-2]
    return m


def erode(m, n=1):
    return ~dilate(~m, n)


def fill_holes(m):
    h, w = m.shape
    outside = grow(~np.pad(m, 1), (0, 0))[1:-1, 1:-1]
    return m | ~outside


def inpaint(rgba, mask, iters=400):
    out = rgba.astype(np.float32).copy()
    known = ~mask
    # parte da una media dei pixel noti vicini e poi diffonde
    for _ in range(iters):
        p = np.pad(out, ((1, 1), (1, 1), (0, 0)), mode='edge')
        pk = np.pad(known.astype(np.float32), 1)
        num = sum(p[1 + dy:p.shape[0] - 1 + dy, 1 + dx:p.shape[1] - 1 + dx] * pk[1 + dy:pk.shape[0] - 1 + dy, 1 + dx:pk.shape[1] - 1 + dx, None]
                  for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))
        den = sum(pk[1 + dy:pk.shape[0] - 1 + dy, 1 + dx:pk.shape[1] - 1 + dx] for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))
        upd = mask & (den > 0)
        out[upd] = (num[upd] / den[upd][:, None])
        known = known | upd
        if known.all():
            break
    # leggeri ritocchi di diffusione per ammorbidire
    for _ in range(30):
        p = np.pad(out, ((1, 1), (1, 1), (0, 0)), mode='edge')
        avg = (p[:-2, 1:-1] + p[2:, 1:-1] + p[1:-1, :-2] + p[1:-1, 2:]) / 4
        out[mask] = avg[mask]
    return out


def main(preview=False):
    for name, seeds in TARGETS.items():
        im = Image.open(CATS / name).convert('RGBA')
        a = np.array(im)
        lum = luma(a[..., :3])
        h, w = lum.shape
        yy, xx = np.mgrid[0:h, 0:w]
        mask = np.zeros(lum.shape, bool)
        for t in seeds:
            if t[0] == 'box':
                _, x0, y0, x1, y1 = t
                box = lum[y0:y1, x0:x1]
                iy, ix = np.unravel_index(np.argmin(box), box.shape)
                dark = (lum < min(150, box.min() + 45)) & (a[..., 3] > 200)
                blob = grow(dark, (x0 + ix, y0 + iy))
                if blob.sum() > 1500:
                    sys.exit(f'{name}: la macchia trovata è troppo grande ({int(blob.sum())} pixel): soglia da rivedere')
            else:
                _, x0, y0, x1, y1, r = t
                dx, dy = x1 - x0, y1 - y0
                u = np.clip(((xx - x0) * dx + (yy - y0) * dy) / (dx * dx + dy * dy), 0, 1)
                dist = np.hypot(xx - (x0 + u * dx), yy - (y0 + u * dy))
                blob = (dist <= r) & (lum < 118) & (a[..., 3] > 200)
            blob = fill_holes(erode(dilate(blob, 3), 3) | blob)  # chiude la riga rosa interna
            mask |= dilate(blob, 2) if t[0] == 'box' else dilate(blob, 1)
        out = inpaint(a[..., :3], mask)
        res = a.copy()
        res[..., :3] = np.clip(out, 0, 255).astype(np.uint8)
        Image.fromarray(res, 'RGBA').save(CATS / name, optimize=True)
        print(name, 'pixel ritoccati:', int(mask.sum()))


if __name__ == '__main__':
    main()
