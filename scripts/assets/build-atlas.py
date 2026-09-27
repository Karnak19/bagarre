"""Builds client/public/vfx/particles.png from the Kenney Particle Pack.

Usage: python3 build-atlas.py "<pack>/PNG (Transparent)" <repo>/client/public/vfx/particles.png

A 4 x 4 atlas of 256 px cells, greyscale: each cell is the source PNG's alpha.
The order must match `Cell` in client/src/vfx.ts. Needs Pillow.
"""
import sys
from PIL import Image

CELLS = ['muzzle_01', 'muzzle_02', 'muzzle_04', 'muzzle_05', 'spark_01', 'spark_02', 'trace_07', 'star_07',
         'smoke_01', 'smoke_04', 'smoke_07', 'fire_01', 'fire_02', 'scorch_01', 'scorch_03', 'circle_05']
S = 256
src, out = sys.argv[1], sys.argv[2]
atlas = Image.new('L', (4 * S, 4 * S), 0)
for i, name in enumerate(CELLS):
    alpha = Image.open(f'{src}/{name}.png').convert('RGBA').split()[3].resize((S, S), Image.LANCZOS)
    atlas.paste(alpha, ((i % 4) * S, (i // 4) * S))
atlas.save(out, optimize=True)
