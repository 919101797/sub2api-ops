"""Bake scene materials outside the browser. Requires Pillow and NumPy.

Usage: python render-cosmic-textures.py --source-dir /path/to/nasa-originals
Source files: moon.jpg and earth.jpg; attribution: THIRD_PARTY_NOTICES.md.
The generated WebP files are committed assets, not a runtime build step.
"""
from pathlib import Path
import argparse
import numpy as np
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parents[1] / 'web/src/assets'

def noise(x, y, seed=0):
    xi, yi = np.floor(x).astype(np.int64), np.floor(y).astype(np.int64)
    fx, fy = x-xi, y-yi
    u, v = fx*fx*fx*(fx*(fx*6-15)+10), fy*fy*fy*(fy*(fy*6-15)+10)
    def h(a, b):
        n = ((a + seed*71)*374761393 ^ (b + seed*137)*668265263).astype(np.uint32)
        n = ((n ^ (n >> 13)).astype(np.uint64)*1274126177).astype(np.uint32)
        return ((n ^ (n >> 16)).astype(np.float32) / 4294967295)
    a, b, c, d = h(xi, yi), h(xi+1, yi), h(xi, yi+1), h(xi+1, yi+1)
    return a+(b-a)*u+(c-a)*v+(a-b-c+d)*u*v

def fbm(x, y, seed=0, octaves=7):
    result = np.zeros(np.broadcast_shapes(x.shape, y.shape), dtype=np.float32)
    amplitude, total = 1., 0.
    for i in range(octaves):
        result += noise(x, y, seed+i)*amplitude
        total += amplitude; amplitude *= .52; x, y = x*2.03, y*2.03
    return result/total

def save(data, name, quality=94):
    image = Image.fromarray(np.clip(data, 0, 255).astype(np.uint8))
    image.save(OUT/name, quality=quality, method=6)
    print(name, image.size, (OUT/name).stat().st_size)

def planets(source):
    moon = np.asarray(Image.open(source/'moon.jpg').crop((47, 22, 1901, 1876)).resize((1854, 1854)).convert('RGB')).astype(np.float32)
    y, x = np.mgrid[:1854, :1854].astype(np.float32)
    nx, ny = (x-927)/925, (y-927)/925; rr = nx*nx+ny*ny
    z = np.sqrt(np.maximum(0, 1-rr))
    exposure = .25+np.maximum(0, -nx*.56-ny*.23+z*.64)*1.06
    alpha = np.clip((1-rr)*600, 0, 1)*255
    save(np.dstack([moon*exposure[..., None], alpha]), 'moon-lro.webp', 96)
    earth = np.asarray(Image.open(source/'earth.jpg').resize((1024, 1024), Image.Resampling.LANCZOS).convert('RGB'))
    y, x = np.mgrid[:1024, :1024].astype(np.float32)
    alpha = np.clip((464-np.hypot(x-512, y-512))/5, 0, 1)*255
    save(np.dstack([earth, alpha]), 'earth-blue-marble.webp', 94)

def nebula():
    w, h = 2560, 1536
    y, x = np.mgrid[:h, :w].astype(np.float32); nx, ny = x/w, y/h
    flow = fbm(x/420, y/420, 17, 5)
    wx = x/190 + flow*3.3; wy = y/170 - flow*2.7
    structure = fbm(wx, wy, 32, 8)
    fine = fbm(wx*4.4, wy*5.1, 63, 5)
    distance = np.abs(ny-.5-np.sin(nx*6.8)*.14)
    band = np.clip(1-distance*3.7, 0, 1)**1.4 * np.sin(nx*np.pi)**.7
    density = np.clip((structure-.31)*3.2, 0, 1)**1.8 * band
    # Bright, narrow turbulent edges alternate with deep transparent dust lanes.
    filaments = (1-np.abs(fine-.5)*2)**12
    detail = np.clip((fine-.33)*2.2, 0, 1)
    alpha = np.clip(density*(.42 + detail*.7), 0, .93)*255
    tint = np.array([77, 126, 125])[None,None,:]*(1-nx[...,None]) + np.array([188, 207, 184])[None,None,:]*nx[...,None]
    light = .55+detail*.5+filaments*.4
    save(np.dstack([tint*light[...,None], alpha]), 'nebula-material.webp', 95)

def ground():
    w, h = 3072, 1408
    y, x = np.mgrid[:h, :w].astype(np.float32); d = y/h
    surface = fbm(x/(35+d*48), y/(9+d*38), 68, 8)
    gy, gx = np.gradient(surface)
    lighting = np.clip(.62-gx*11-gy*6, .25, 1.15)
    grain = np.random.default_rng(46).normal(0, 4, (h,w))*(.5+d*.7)
    shade = (84+surface*64)*lighting+grain
    rgb = np.stack([shade*1.03, shade*1.02, shade], axis=-1)
    image = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8)); draw = ImageDraw.Draw(image)
    rng = np.random.default_rng(23)
    # Angular regolith fragments: crisp edges and directional faces in the foreground.
    for _ in range(850):
        depth = float(rng.random()); xx, yy = float(rng.random()*w), 25+depth*(h-25)
        r = .7+depth**2*float(rng.random())*13
        pts = [(xx-r,yy), (xx-r*.5,yy-r*.46), (xx+r*.3,yy-r*.63), (xx+r,yy+r*.12), (xx+r*.35,yy+r*.36)]
        draw.polygon(pts, fill=(96,98,94))
        draw.polygon([pts[0],pts[1],pts[2],(xx+r*.1,yy)], fill=(143,144,136))
        draw.polygon([pts[2],pts[3],pts[4],(xx+r*.1,yy)], fill=(48,55,57))
    image.save(OUT/'lunar-ground.webp', quality=94, method=6)
    print('lunar-ground.webp', image.size, (OUT/'lunar-ground.webp').stat().st_size)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--source-dir', required=True, type=Path)
    args = parser.parse_args(); OUT.mkdir(exist_ok=True)
    planets(args.source_dir); nebula(); ground()
