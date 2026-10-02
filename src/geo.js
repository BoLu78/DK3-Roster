// Geometria per la mappa: distanze, rotte (cerchio massimo) e proiezione.
import { coordsFor } from './airports-geo.js';

const R = 6371; // km
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

export function distanceKm([lat1, lon1], [lat2, lon2]) {
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

// punti [lat, lon] lungo il cerchio massimo (rotta più breve), n+1 punti
export function greatCircle(a, b, n = 32) {
  const [la1, lo1, la2, lo2] = [rad(a[0]), rad(a[1]), rad(b[0]), rad(b[1])];
  const d = distanceKm(a, b) / R;
  if (d < 1e-6) return [a, b];
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(la1) * Math.cos(lo1) + B * Math.cos(la2) * Math.cos(lo2);
    const y = A * Math.cos(la1) * Math.sin(lo1) + B * Math.cos(la2) * Math.sin(lo2);
    const z = A * Math.sin(la1) + B * Math.sin(la2);
    pts.push([deg(Math.atan2(z, Math.hypot(x, y))), deg(Math.atan2(y, x))]);
  }
  return pts;
}

// Tratte di volo uniche (per coppia di aeroporti) con conteggio; gli aeroporti senza coordinate sono elencati a parte.
export function collectRoutes(days) {
  const routes = new Map();
  const airports = new Map();
  const missing = new Set();
  let km = 0;
  let sectors = 0;
  for (const d of days) {
    for (const l of d.legs) {
      if (l.kind !== 'flight') continue;
      const a = coordsFor(l.dep);
      const b = coordsFor(l.arr);
      if (!a) missing.add(l.dep);
      if (!b) missing.add(l.arr);
      if (!a || !b) continue;
      sectors++;
      km += distanceKm(a, b);
      const key = [l.dep, l.arr].sort().join('-');
      const r = routes.get(key) ?? { from: l.dep, to: l.arr, count: 0 };
      r.count++;
      routes.set(key, r);
      for (const code of [l.dep, l.arr]) airports.set(code, (airports.get(code) ?? 0) + 1);
    }
  }
  return { routes: [...routes.values()], airports, missing: [...missing].sort(), km: Math.round(km), sectors };
}

// Proiezione piana (lon scalata col coseno della latitudine centrale).
// Restituisce { project([lat,lon]) -> [x,y], viewBox } che inquadra i punti dati.
export function fitView(points, width, height, pad = 0.18) {
  const lats = points.map((p) => p[0]);
  const lons = points.map((p) => p[1]);
  let [minLat, maxLat, minLon, maxLon] = [Math.min(...lats), Math.max(...lats), Math.min(...lons), Math.max(...lons)];
  const midLat = (minLat + maxLat) / 2;
  const k = Math.cos(rad(Math.min(70, Math.abs(midLat))));
  let w = Math.max((maxLon - minLon) * k, 6);
  let h = Math.max(maxLat - minLat, 6 * (height / width));
  w *= 1 + pad * 2;
  h *= 1 + pad * 2;
  // stesso rapporto del riquadro
  if (w / h > width / height) h = (w * height) / width;
  else w = (h * width) / height;
  const cx = ((minLon + maxLon) / 2) * k;
  const cy = (minLat + maxLat) / 2;
  const scale = width / w;
  const project = ([lat, lon]) => [width / 2 + (lon * k - cx) * scale, height / 2 - (lat - cy) * scale];
  return { project, scale, k };
}
