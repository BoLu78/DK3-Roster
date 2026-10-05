// Meteo lungo la rotta diretta (cerchio massimo) tra due aeroporti: instabilità del modello (Open-Meteo)
// e SIGMET in corso (aviationweather.gov). È un'indicazione approssimativa, non una rotta di piano volo.
import { distanceKm, greatCircle } from './geo.js';

const HOUR = 3600000;
const NM = 1.852;

// Punti ogni ~stepNm lungo la rotta, con l'orario di sorvolo (velocità costante).
export function routePoints(a, b, depMs, arrMs, stepNm = 100) {
  const totalNm = distanceKm(a, b) / NM;
  const n = Math.max(2, Math.ceil(totalNm / stepNm));
  return greatCircle(a, b, n).map(([lat, lon], i) => ({ lat, lon, nm: Math.round((totalNm * i) / n), ms: Math.round(depMs + ((arrMs - depMs) * i) / n) }));
}

const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

// Una sola richiesta per tratta: solo coordinate e date, nessun dato del roster.
export function buildRouteUrl(points) {
  const q = new URLSearchParams({
    latitude: points.map((p) => p.lat.toFixed(1)).join(','),
    longitude: points.map((p) => p.lon.toFixed(1)).join(','),
    hourly: 'weather_code,cape,wind_gusts_10m',
    wind_speed_unit: 'kn',
    timezone: 'UTC',
    start_date: isoDay(Math.min(...points.map((p) => p.ms)) - HOUR),
    end_date: isoDay(Math.max(...points.map((p) => p.ms)) + HOUR),
  });
  return `https://api.open-meteo.com/v1/forecast?${q}`;
}

// risposta Open-Meteo (un oggetto, o una lista se i luoghi sono più d'uno) -> dati per punto
export function parseRouteResponse(json, points) {
  const list = Array.isArray(json) ? json : [json];
  if (list.length !== points.length) throw new Error('Risposta meteo di rotta non valida');
  return points.map((p, i) => {
    const h = list[i]?.hourly;
    if (!h?.time) throw new Error('Risposta meteo di rotta non valida');
    const key = new Date(Math.round(p.ms / HOUR) * HOUR).toISOString().slice(0, 13);
    const k = h.time.findIndex((t) => t.slice(0, 13) === key);
    if (k < 0) return { ...p, code: null, cape: null, gust: null };
    return { ...p, code: h.weather_code?.[k] ?? null, cape: h.cape?.[k] ?? null, gust: h.wind_gusts_10m?.[k] ?? null };
  });
}

// livello di un punto: 3 temporale previsto o instabilità molto forte, 2 forte, 1 moderata, 0 calmo
export function pointLevel(p) {
  if (p.code != null && p.code >= 95) return 3;
  if (p.cape != null && p.cape >= 2000) return 3;
  if (p.cape != null && p.cape >= 1000) return 2;
  if (p.cape != null && p.cape >= 500) return 1;
  return 0;
}

// Tratti consecutivi con livello >= minLevel
export function routeSegments(points, minLevel = 2) {
  const out = [];
  let cur = null;
  for (const p of points) {
    const lv = pointLevel(p);
    if (lv >= minLevel) {
      if (!cur) cur = { fromNm: p.nm, toNm: p.nm, fromMs: p.ms, toMs: p.ms, level: lv, maxCape: p.cape ?? 0, thunder: p.code >= 95 };
      else {
        cur.toNm = p.nm;
        cur.toMs = p.ms;
        cur.level = Math.max(cur.level, lv);
        cur.maxCape = Math.max(cur.maxCape, p.cape ?? 0);
        cur.thunder = cur.thunder || p.code >= 95;
      }
    } else if (cur) {
      out.push(cur);
      cur = null;
    }
  }
  if (cur) out.push(cur);
  return out;
}

// ---------------------------------------------------------------- SIGMET
const toMs = (v) => {
  if (v == null) return null;
  if (typeof v === 'number') return v < 1e11 ? v * 1000 : v;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
};

export function parseSigmets(json) {
  const list = Array.isArray(json) ? json : [];
  const out = [];
  for (const s of list) {
    const coords = (s.coords ?? []).map((c) => (Array.isArray(c) ? [Number(c[0]), Number(c[1])] : [Number(c.lat), Number(c.lon)])).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
    if (coords.length < 3) continue;
    out.push({
      id: String(s.seriesId ?? s.isigmetId ?? s.airSigmetId ?? ''),
      fir: String(s.firName ?? s.firId ?? s.icaoId ?? ''),
      hazard: String(s.hazard ?? '').toUpperCase(),
      qualifier: String(s.qualifier ?? s.qual ?? '').toUpperCase(),
      fromMs: toMs(s.validTimeFrom),
      toMs: toMs(s.validTimeTo),
      baseFt: s.base ?? null,
      topFt: s.top ?? null,
      poly: coords,
      raw: String(s.rawSigmet ?? s.rawAirSigmet ?? '').replace(/\s+/g, ' ').trim(),
    });
  }
  return out;
}

export function inPolygon([lat, lon], poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i];
    const [yj, xj] = poly[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const RELEVANT = new Set(['TS', 'TURB', 'ICE', 'VA', 'TC', 'MTW', 'DS', 'SS', 'RDOACT CLD']);

// SIGMET che toccano la rotta (punti fitti) mentre l'aereo ci passa.
export function sigmetHits(sigmets, dense) {
  const hits = [];
  for (const s of sigmets) {
    if (!RELEVANT.has(s.hazard)) continue;
    const pts = dense.filter((p) => inPolygon([p.lat, p.lon], s.poly) && (s.fromMs == null || p.ms + HOUR > s.fromMs) && (s.toMs == null || p.ms - HOUR < s.toMs));
    if (!pts.length) continue;
    hits.push({ ...s, fromNm: pts[0].nm, toNm: pts.at(-1).nm, atMs: pts[0].ms });
  }
  return hits.sort((a, b) => a.fromNm - b.fromNm);
}
