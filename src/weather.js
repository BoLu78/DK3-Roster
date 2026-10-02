// Meteo previsto per aeroporto (Open-Meteo, gratuito, senza account né chiave).
//
// Opzionale e spento di default. Ogni richiesta contiene solo le coordinate dell'aeroporto e le
// date: nessun dato del roster, nessun nome, nessun identificativo.
import { coordsFor } from './airports-geo.js';
import { buildDayTimeline } from './timeline.js';

export const FORECAST_DAYS = 15; // Open-Meteo prevede fino a ~16 giorni
export const STALE_HOURS = 3; // dopo quante ore si riscaricano le previsioni
export const WINDY_KT = 25; // raffiche da cui si segnala il vento

const HOUR = 3600000;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

// Codici meteo WMO -> gruppo, icona e testo
export function describeCode(code, gustKt = 0) {
  let group, icon, label;
  if (code === 0) [group, icon, label] = ['clear', '☀️', 'Sereno'];
  else if (code === 1) [group, icon, label] = ['clear', '🌤️', 'Quasi sereno'];
  else if (code === 2) [group, icon, label] = ['partly', '⛅', 'Parzialmente nuvoloso'];
  else if (code === 3) [group, icon, label] = ['cloudy', '☁️', 'Nuvoloso'];
  else if (code === 45 || code === 48) [group, icon, label] = ['fog', '🌫️', 'Nebbia'];
  else if ((code >= 51 && code <= 57) || (code >= 80 && code <= 82)) [group, icon, label] = ['rain', '🌦️', 'Pioggia debole / rovesci'];
  else if (code >= 61 && code <= 67) [group, icon, label] = ['rain', '🌧️', 'Pioggia'];
  else if ((code >= 71 && code <= 77) || code === 85 || code === 86) [group, icon, label] = ['snow', '🌨️', 'Neve'];
  else if (code >= 95) [group, icon, label] = ['storm', '⛈️', 'Temporale'];
  else [group, icon, label] = ['cloudy', '☁️', 'Variabile'];
  return { group, icon, label, windy: gustKt >= WINDY_KT };
}

// chiave oraria "2026-10-05T12" dell'ora UTC più vicina
export function hourKey(ms) {
  return new Date(Math.round(ms / HOUR) * HOUR).toISOString().slice(0, 13);
}

export function buildUrl(lat, lon, startDate, endDate) {
  const q = new URLSearchParams({
    latitude: lat.toFixed(2),
    longitude: lon.toFixed(2),
    hourly: 'temperature_2m,weather_code,wind_gusts_10m',
    wind_speed_unit: 'kn',
    timezone: 'UTC',
    start_date: startDate,
    end_date: endDate,
  });
  return `https://api.open-meteo.com/v1/forecast?${q}`;
}

// risposta Open-Meteo -> { "2026-10-05T12": [temperatura, codice, raffica_kt] }
export function parseResponse(json) {
  const h = json?.hourly;
  if (!h?.time) throw new Error('Risposta meteo non valida');
  const out = {};
  h.time.forEach((t, i) => {
    const temp = h.temperature_2m?.[i];
    const code = h.weather_code?.[i];
    if (temp == null || code == null) return;
    out[t.slice(0, 13)] = [Math.round(temp), code, Math.round(h.wind_gusts_10m?.[i] ?? 0)];
  });
  return out;
}

// Unisce una nuova previsione a quella salvata. Se per la stessa ora cambia il gruppo di tempo
// (es. sole -> pioggia) ricorda il codice di prima, per mostrare "prima: ...".
export function mergeForecast(old, hours, fetchedAt) {
  const merged = { fetchedAt, hours: { ...(old?.hours ?? {}) }, changes: { ...(old?.changes ?? {}) } };
  for (const [key, val] of Object.entries(hours)) {
    const before = old?.hours?.[key];
    if (before && describeCode(before[1]).group !== describeCode(val[1]).group) {
      // il confronto è con la prima previsione vista, non con l'ultima intermedia
      const first = merged.changes[key] ?? { code: before[1], at: old.fetchedAt };
      if (describeCode(first.code).group === describeCode(val[1]).group) delete merged.changes[key];
      else merged.changes[key] = first;
    }
    merged.hours[key] = val;
  }
  return merged;
}

// Aeroporti (con coordinate note) e date UTC che servono per i giorni da oggi in poi.
export function neededForecasts(days, todayIsoDate, buildEvents) {
  const last = isoDay(Date.parse(todayIsoDate + 'T00:00:00Z') + FORECAST_DAYS * 86400000);
  const need = new Map();
  const add = (apt, ms) => {
    if (!apt || ms == null || !coordsFor(apt)) return;
    const d = isoDay(ms);
    if (d < todayIsoDate || d > last) return;
    const e = need.get(apt) ?? { from: d, to: d };
    if (d < e.from) e.from = d;
    if (d > e.to) e.to = d;
    need.set(apt, e);
  };
  for (const day of days) {
    for (const [apt, ms] of buildEvents(day)) add(apt, ms);
  }
  return need;
}

// Scarica (o aggiorna) le previsioni mancanti o vecchie. cache: { [aeroporto]: previsione }.
// fetchFn: (url) => Promise<json>. Restituisce { cache, updated, failed }.
export async function updateForecasts({ cache = {}, need, fetchFn, now = Date.now(), force = false }) {
  const next = { ...cache };
  const todo = [...need].filter(([apt, range]) => {
    const c = cache[apt];
    if (force || !c) return true;
    const fresh = now - c.fetchedAt < STALE_HOURS * HOUR;
    const covers = c.hours[`${range.from}T12`] && c.hours[`${range.to}T12`];
    return !(fresh && covers);
  });
  let updated = 0;
  let failed = 0;
  const queue = [...todo];
  const worker = async () => {
    while (queue.length) {
      const [apt, range] = queue.shift();
      const [lat, lon] = coordsFor(apt);
      try {
        const hours = parseResponse(await fetchFn(buildUrl(lat, lon, range.from, range.to)));
        next[apt] = mergeForecast(cache[apt], hours, now);
        updated++;
      } catch {
        failed++;
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return { cache: next, updated, failed };
}

// elimina le ore passate da più di 2 giorni (il vecchio meteo non serve)
export function prune(cache, nowMs) {
  const limit = new Date(nowMs - 48 * HOUR).toISOString().slice(0, 13);
  const out = {};
  for (const [apt, f] of Object.entries(cache)) {
    const hours = Object.fromEntries(Object.entries(f.hours).filter(([k]) => k >= limit));
    const changes = Object.fromEntries(Object.entries(f.changes ?? {}).filter(([k]) => k >= limit));
    if (Object.keys(hours).length) out[apt] = { ...f, hours, changes };
  }
  return out;
}

// previsione per aeroporto e istante
export function weatherAt(cache, apt, ms) {
  const f = cache?.[apt];
  if (!f || ms == null) return null;
  const key = hourKey(ms);
  const v = f.hours[key];
  if (!v) return null;
  const d = describeCode(v[1], v[2]);
  const ch = f.changes?.[key];
  return { temp: v[0], gust: v[2], ...d, before: ch ? describeCode(ch.code) : null, updatedAt: f.fetchedAt };
}

// Luoghi e istanti del giorno che interessano per il meteo: partenze, arrivi, check-in/out e hotel.
export function weatherEventsOf(day) {
  const tl = buildDayTimeline(day);
  const out = [];
  for (const e of tl.events) {
    if (e.t === 'leg') out.push([e.leg.dep, e.depMs], [e.leg.arr, e.arrMs]);
    else if (e.t === 'ci' || e.t === 'co') out.push([e.airport, e.ms]);
  }
  if (day.hotel?.airport) out.push([day.hotel.airport, Date.parse(day.date + 'T12:00:00Z')]);
  return out;
}
