// Genera le icone PNG dell'app (nessuna dipendenza): node tools/make-icons.mjs
import zlib from 'node:zlib';
import fs from 'node:fs';

function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const v of buf) c = crcTable[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const inTri = (p, a, b, c) => {
  const s = (p1, p2, p3) => (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1]);
  const d1 = s(p, a, b), d2 = s(p, b, c), d3 = s(p, c, a);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
};

// aeroplanino di carta bianco su sfondo blu; scale < 1 lascia margine (maschera)
function icon(size, { scale = 1, rounded = false } = {}) {
  const SS = 3;
  return png(size, (x, y) => {
    let r = 0, g = 0, b = 0, a = 0, white = 0;
    for (let i = 0; i < SS; i++) for (let j = 0; j < SS; j++) {
      const u = (x + (i + 0.5) / SS) / size, v = (y + (j + 0.5) / SS) / size;
      const px = (u - 0.5) / scale + 0.5, py = (v - 0.5) / scale + 0.5;
      const tri1 = inTri([px, py], [0.2, 0.5], [0.8, 0.24], [0.5, 0.58]);
      const tri2 = inTri([px, py], [0.5, 0.58], [0.8, 0.24], [0.6, 0.78]);
      const tri3 = inTri([px, py], [0.5, 0.58], [0.6, 0.78], [0.45, 0.66]);
      if (tri1 || tri2 || tri3) white += tri2 ? 0.82 : tri3 ? 0.7 : 1;
    }
    const wv = white / (SS * SS);
    const t = y / size;
    const bg = [10 + (6 - 10) * t, 108 + (50 - 108) * t, 240 + (150 - 240) * t];
    let alpha = 255;
    if (rounded) {
      const rad = size * 0.22, cx = Math.min(Math.max(x, rad), size - rad), cy = Math.min(Math.max(y, rad), size - rad);
      alpha = Math.hypot(x - cx, y - cy) <= rad ? 255 : 0;
    }
    r = bg[0] + (255 - bg[0]) * wv; g = bg[1] + (255 - bg[1]) * wv; b = bg[2] + (255 - bg[2]) * wv; a = alpha;
    return [Math.round(r), Math.round(g), Math.round(b), a];
  });
}

fs.mkdirSync('icons', { recursive: true });
fs.writeFileSync('icons/icon-192.png', icon(192, { rounded: true }));
fs.writeFileSync('icons/icon-512.png', icon(512, { rounded: true }));
fs.writeFileSync('icons/icon-maskable-512.png', icon(512, { scale: 0.72 }));
fs.writeFileSync('icons/apple-touch-icon.png', icon(180));
console.log('icone create in icons/');
