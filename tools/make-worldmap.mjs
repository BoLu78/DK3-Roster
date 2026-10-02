// Genera js/worldmap.js (contorni dei continenti) da Natural Earth, dominio pubblico.
// Uso: npm install world-atlas (in una cartella qualsiasi), poi
//   node tools/make-worldmap.mjs <cartella>/node_modules/world-atlas/land-50m.json
import fs from 'node:fs';

const topo = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const { scale, translate } = topo.transform;

// archi del topojson: coordinate quantizzate, codificate a differenze
const arcs = topo.arcs.map((arc) => {
  let x = 0, y = 0;
  return arc.map(([dx, dy]) => [(x += dx) * scale[0] + translate[0], (y += dy) * scale[1] + translate[1]]);
});
const ring = (idx) => idx.flatMap((i) => (i >= 0 ? arcs[i] : [...arcs[~i]].reverse()));

const rings = [];
for (const g of topo.objects.land.geometries) {
  const polys = g.type === 'Polygon' ? [g.arcs] : g.arcs;
  for (const poly of polys) for (const r of poly.slice(0, 1)) rings.push(ring(r)); // solo contorni esterni
}

// semplificazione (Douglas-Peucker, tolleranza 0.06 gradi) e precisione 1/20 di grado
const TOL = 0.06;
function simplify(pts) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    const [x1, y1] = pts[i], [x2, y2] = pts[j];
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
    let max = 0, at = -1;
    for (let k = i + 1; k < j; k++) {
      // anello chiuso (primo = ultimo punto): distanza dal punto iniziale
      const d = len < 1e-9 ? Math.hypot(pts[k][0] - x1, pts[k][1] - y1) : Math.abs(dy * pts[k][0] - dx * pts[k][1] + x2 * y1 - y2 * x1) / len;
      if (d > max) { max = d; at = k; }
    }
    if (max > TOL) { keep[at] = 1; stack.push([i, at], [at, j]); }
  }
  return pts.filter((_, k) => keep[k]);
}
const out = [];
for (const r of rings) {
  const flat = [];
  let px = null, py = null;
  for (const [lon, lat] of simplify(r)) {
    const x = Math.round(lon * 20), y = Math.round(lat * 20);
    if (x === px && y === py) continue;
    flat.push(x, y);
    px = x; py = y;
  }
  if (flat.length >= 8) out.push(flat);
}
const js = `// Contorni dei continenti (Natural Earth, dominio pubblico). Generato da tools/make-worldmap.mjs.\n// Ogni anello: [lon*20, lat*20, lon*20, lat*20, ...]\nexport const LAND = ${JSON.stringify(out)};\n`;
fs.writeFileSync(new URL('../js/worldmap.js', import.meta.url), js);
console.log(`${out.length} anelli, ${(js.length / 1024).toFixed(0)} KB`);
