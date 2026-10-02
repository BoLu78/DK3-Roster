// Meteo: archivio sul telefono, aggiornamento e piccoli elementi grafici.
import { h, safeStorage, todayIso } from './util.js';
import { state } from './state.js';
import { neededForecasts, updateForecasts, prune, weatherAt, weatherEventsOf } from '../src/weather.js';

const storage = safeStorage();
const KEY = 'dk3-weather';

export function loadWeather() {
  try {
    const d = JSON.parse(storage.getItem(KEY) ?? '{}');
    state.weather = { cache: d.cache ?? {}, at: d.at ?? 0, error: null, busy: false };
  } catch {
    state.weather = { cache: {}, at: 0, error: null, busy: false };
  }
}

function save() {
  try {
    storage.setItem(KEY, JSON.stringify({ cache: state.weather.cache, at: state.weather.at }));
  } catch {
    /* archivio pieno: il meteo si riscarica */
  }
}

async function getJson(url) {
  const r = await fetch(url, { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (!r.ok) throw new Error(`meteo ${r.status}`);
  return r.json();
}

// Scarica le previsioni dei giorni da oggi in poi (solo se l'interruttore è acceso).
// Restituisce true se qualcosa è cambiato.
export async function refreshWeather({ force = false } = {}) {
  const w = state.weather;
  if (!state.settings.weatherOn || w.busy || !navigator.onLine) return false;
  const need = neededForecasts([...state.data.days.values()], todayIso(), weatherEventsOf);
  if (!need.size) return false;
  w.busy = true;
  try {
    const r = await updateForecasts({ cache: w.cache, need, fetchFn: getJson, force });
    w.cache = prune(r.cache, Date.now());
    if (r.updated) w.at = Date.now();
    w.error = r.failed && !r.updated ? 'Non riesco a scaricare il meteo (rete o servizio non disponibili).' : null;
    save();
    return r.updated > 0;
  } finally {
    w.busy = false;
  }
}

export function clearWeather() {
  state.weather = { cache: {}, at: 0, error: null, busy: false };
  save();
}

// elemento "☀️ 24°" per un aeroporto in un istante; detail = mostra anche "prima: ..."
export function wxChip(apt, ms, { detail = false } = {}) {
  if (!state.settings.weatherOn) return null;
  const w = weatherAt(state.weather?.cache, apt, ms);
  if (!w) return null;
  return h('span', { class: `wx${w.before ? ' changed' : ''}`, title: `${w.label}${w.windy ? `, raffiche ${w.gust} kt` : ''}` },
    w.icon, w.windy ? '💨' : null, `${w.temp}°`,
    detail && w.before ? h('small', {}, ` (prima: ${w.before.icon})`) : null);
}
