// Briefing: dati salvati sul telefono, scarico da aviationweather.gov / Open-Meteo e regole importate.
// Spento di default. Le richieste contengono solo codici ICAO, coordinate e date: nessun dato del roster.
import { safeStorage } from './util.js';
import { state } from './state.js';
import { buildDayTimeline } from '../src/timeline.js';
import { parseMetar, parseTaf } from '../src/metar.js';
import { metarUrl, tafUrl, sigmetUrl, parseMetarJson, parseTafJson, RELAYS } from '../src/awc.js';
import { routePoints, buildRouteUrl, parseRouteResponse, routeSegments, parseSigmets, sigmetHits } from '../src/route-wx.js';
import { normalizeRules } from '../src/rules.js';
import { flightLegs, stationsNeeded, briefDay } from '../src/briefing.js';
import { analyzeNotams } from '../src/notam.js';
import { coordsFor } from '../src/airports-geo.js';
import { icaoFor } from '../src/icao.js';

const storage = safeStorage();
const KEY = 'dk3-briefing';
const RULES_KEY = 'dk3-rules';
const HOUR = 3600000;
const MIN = 60000;

export const LEAD_HOURS = 36; // il briefing nasce a meno di 36 ore dalla partenza
export const STATION_TTL_MIN = 20; // METAR e TAF si riscaricano dopo 20 minuti
export const ROUTE_TTL_MIN = 120;
export const SIGMET_TTL_MIN = 30;

export const bstate = { stations: {}, sigmets: { at: 0, items: [] }, routes: {}, notams: {}, extraAlt: {}, at: 0, error: null, busy: false, rules: null, rulesError: null };

export function loadBriefing() {
  try {
    const d = JSON.parse(storage.getItem(KEY) ?? '{}');
    Object.assign(bstate, { stations: d.stations ?? {}, sigmets: d.sigmets ?? { at: 0, items: [] }, routes: d.routes ?? {}, notams: d.notams ?? {}, extraAlt: d.extraAlt ?? {}, at: d.at ?? 0 });
  } catch {
    /* archivio illeggibile: si riparte vuoti */
  }
  loadRules();
}

export function saveBriefing() {
  try {
    storage.setItem(KEY, JSON.stringify({ stations: bstate.stations, sigmets: bstate.sigmets, routes: bstate.routes, notams: bstate.notams, extraAlt: bstate.extraAlt, at: bstate.at }));
  } catch {
    /* archivio pieno: i dati si riscaricano */
  }
}

// ---------------------------------------------------------------- regole
function loadRules() {
  bstate.rules = null;
  bstate.rulesError = null;
  try {
    const t = storage.getItem(RULES_KEY);
    if (t) bstate.rules = normalizeRules(JSON.parse(t));
  } catch (e) {
    bstate.rulesError = e.message;
  }
}

export function importRules(text) {
  const rules = normalizeRules(JSON.parse(text)); // lancia un errore se il file non va
  storage.setItem(RULES_KEY, text);
  bstate.rules = rules;
  bstate.rulesError = null;
}

export function clearRules() {
  storage.removeItem(RULES_KEY);
  bstate.rules = null;
}

// ---------------------------------------------------------------- giorni e tratte
export function legsOfDay(date) {
  const day = state.data.days.get(date);
  if (!day) return [];
  return flightLegs(buildDayTimeline(day));
}

// giorni con voli che iniziano tra poco (o da poco): quelli per cui il briefing si prepara da solo
export function dueDates(nowMs = Date.now()) {
  const out = [];
  for (const [date, day] of state.data.days) {
    if (day.kind !== 'flight') continue;
    const legs = legsOfDay(date);
    if (!legs.length) continue;
    const start = legs[0].depMs;
    const end = legs.at(-1).arrMs;
    if (start - nowMs <= LEAD_HOURS * HOUR && end + 2 * HOUR >= nowMs) out.push(date);
  }
  return out.sort();
}

// ---------------------------------------------------------------- rete
async function fetchText(url, ms = 12000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: ctl.signal });
    if (r.status === 204) return '[]';
    if (!r.ok) throw new Error(`risposta ${r.status}`);
    return await r.text();
  } catch (e) {
    throw new Error(e?.name === 'AbortError' ? 'nessuna risposta in tempo' : e?.message === 'Load failed' || e?.message === 'Failed to fetch' ? 'bloccato o non raggiungibile' : (e?.message ?? String(e)));
  } finally {
    clearTimeout(timer);
  }
}

const parseJson = (t) => {
  if (!t.trim()) return [];
  try {
    return JSON.parse(t);
  } catch {
    throw new Error('risposta non leggibile');
  }
};

// Percorsi possibili per i dati di aviationweather.gov: diretto, poi (solo se consentito) i servizi intermedi.
let lastRoute = 0;
const routesAllowed = () => [{ name: 'diretto', url: (u) => u }, ...(state.settings.briefingRelay ? RELAYS : [])];

async function getAwc(url) {
  const routes = routesAllowed();
  const order = [...routes.keys()].sort((a, b) => (a === lastRoute ? -1 : b === lastRoute ? 1 : a - b));
  const errs = [];
  for (const i of order) {
    try {
      const json = parseJson(await fetchText(routes[i].url(url)));
      lastRoute = i;
      return json;
    } catch (e) {
      errs.push(`${routes[i].name}: ${e.message}`);
    }
  }
  throw new Error(errs.join('; '));
}

// Open-Meteo risponde direttamente al browser
const getJson = async (url) => parseJson(await fetchText(url));

// Prova ogni percorso e dice com'è andata (per capire cosa funziona sul telefono).
export async function testConnection() {
  const lines = [];
  let ok = null;
  const routes = routesAllowed();
  for (const [i, r] of routes.entries()) {
    try {
      const m = parseMetarJson(parseJson(await fetchText(r.url(metarUrl(['LIMC'])), 10000)));
      if (!m.LIMC) throw new Error('nessun METAR ricevuto');
      lines.push(`✅ ${r.name}: funziona`);
      if (ok == null) {
        ok = m.LIMC;
        lastRoute = i;
      }
    } catch (e) {
      lines.push(`❌ ${r.name}: ${e.message}`);
    }
  }
  return { ok, lines, relayOn: !!state.settings.briefingRelay };
}

const fresh = (at, ttlMin, now) => at && now - at < ttlMin * MIN;

async function fetchStations(icaos, now, force) {
  const need = icaos.filter((i) => force || !fresh(bstate.stations[i]?.fetchedAt, STATION_TTL_MIN, now));
  if (!need.length) return 0;
  const [metars, tafs] = await Promise.all([getAwc(metarUrl(need)).then(parseMetarJson), getAwc(tafUrl(need)).then(parseTafJson)]);
  for (const icao of need) {
    const old = bstate.stations[icao];
    const rec = { fetchedAt: now, metarRaw: metars[icao] ?? null, tafRaw: tafs[icao] ?? null, prevTafRaw: old?.prevTafRaw ?? null, prevAt: old?.prevAt ?? null, changedAt: old?.changedAt ?? null };
    if (old?.tafRaw && rec.tafRaw && old.tafRaw !== rec.tafRaw) {
      rec.prevTafRaw = old.tafRaw;
      rec.prevAt = old.fetchedAt;
      rec.changedAt = now;
    }
    bstate.stations[icao] = rec;
  }
  return need.length;
}

async function fetchSigmets(now, force) {
  if (!force && fresh(bstate.sigmets.at, SIGMET_TTL_MIN, now)) return;
  bstate.sigmets = { at: now, items: parseSigmets(await getAwc(sigmetUrl())) };
}

async function fetchRoute(leg, now, force) {
  const a = coordsFor(leg.dep);
  const b = coordsFor(leg.arr);
  if (!a || !b) return null;
  const key = `${leg.dep}-${leg.arr}-${leg.depMs}`;
  const hit = bstate.routes[key];
  if (!force && hit && fresh(hit.at, ROUTE_TTL_MIN, now)) return hit;
  const pts = routePoints(a, b, leg.depMs, leg.arrMs, 100);
  const withWx = parseRouteResponse(await getJson(buildRouteUrl(pts)), pts);
  const rec = { at: now, points: withWx.map((p) => ({ nm: p.nm, ms: p.ms, lat: Math.round(p.lat * 10) / 10, lon: Math.round(p.lon * 10) / 10, code: p.code, cape: p.cape })) };
  bstate.routes[key] = rec;
  return rec;
}

// Scarica (o aggiorna) tutto ciò che serve a un giorno. Restituisce true se qualcosa è cambiato.
export async function refreshDay(date, { force = false } = {}) {
  if (!state.settings.briefingOn || bstate.busy || !navigator.onLine) return false;
  const legs = legsOfDay(date);
  if (!legs.length) return false;
  const now = Date.now();
  bstate.busy = true;
  bstate.error = null;
  let changed = false;
  const problems = [];
  try {
    const { icaos } = stationsNeeded(legs, bstate.rules, bstate.extraAlt[date] ?? {});
    try {
      changed = (await fetchStations(icaos, now, force)) > 0;
    } catch (e) {
      problems.push(`METAR/TAF: ${e.message}`);
    }
    try {
      await fetchSigmets(now, force);
    } catch (e) {
      problems.push(`SIGMET: ${e.message}`);
    }
    for (const leg of legs) {
      try {
        await fetchRoute(leg, now, force);
      } catch (e) {
        problems.push(`rotta ${leg.dep}-${leg.arr}: ${e.message}`);
      }
    }
    if (changed) bstate.at = now;
    bstate.error = problems.length ? `Non tutto si è aggiornato (${problems.join('; ')}).` : null;
    prune(now);
    saveBriefing();
    return changed || problems.length > 0;
  } finally {
    bstate.busy = false;
  }
}

// toglie ciò che è vecchio di più di 3 giorni
function prune(now) {
  const limit = now - 72 * HOUR;
  for (const [k, v] of Object.entries(bstate.stations)) if (v.fetchedAt < limit) delete bstate.stations[k];
  for (const [k, v] of Object.entries(bstate.routes)) if (v.at < limit) delete bstate.routes[k];
  const keepDays = new Set([...state.data.days.keys()].filter((d) => d >= new Date(now - 7 * 24 * HOUR).toISOString().slice(0, 10)));
  for (const d of Object.keys(bstate.notams)) if (!keepDays.has(d)) delete bstate.notams[d];
}

// ---------------------------------------------------------------- dati per il motore
function stationData(rec) {
  if (!rec) return { metar: null, taf: null, fetchedAt: null };
  const ref = rec.fetchedAt;
  return { metar: rec.metarRaw ? parseMetar(rec.metarRaw, ref) : null, taf: rec.tafRaw ? parseTaf(rec.tafRaw, ref) : null, prevTaf: rec.prevTafRaw ? parseTaf(rec.prevTafRaw, rec.prevAt ?? ref) : null, fetchedAt: rec.fetchedAt, changedAt: rec.changedAt };
}

export function wxMap(icaos) {
  const out = {};
  for (const i of icaos) out[i] = stationData(bstate.stations[i]);
  return out;
}

function routeData(legs) {
  const now = Date.now();
  const out = {};
  legs.forEach((leg, i) => {
    const rec = bstate.routes[`${leg.dep}-${leg.arr}-${leg.depMs}`];
    const a = coordsFor(leg.dep);
    const b = coordsFor(leg.arr);
    if (!rec) return;
    const sigmets = a && b ? sigmetHits(bstate.sigmets.items, routePoints(a, b, leg.depMs, leg.arrMs, 25)) : [];
    out[i] = { points: rec.points, segments: routeSegments(rec.points, 2), sigmets, at: rec.at, sigmetAt: bstate.sigmets.at, stale: now - rec.at > 6 * HOUR };
  });
  return out;
}

// Briefing completo di un giorno con i dati salvati (senza rete)
export function buildBrief(date) {
  const legs = legsOfDay(date);
  if (!legs.length) return null;
  const rules = bstate.rules;
  const { icaos } = stationsNeeded(legs, rules, bstate.extraAlt[date] ?? {});
  const wx = wxMap(icaos);
  const windows = {};
  const interest = [];
  for (const leg of legs) {
    for (const [apt, ms] of [[leg.dep, leg.depMs], [leg.arr, leg.arrMs]]) {
      const code = apt && icaoFor(apt);
      if (!code) continue;
      windows[code] = windows[code] ? [Math.min(windows[code][0], ms - HOUR), Math.max(windows[code][1], ms + HOUR)] : [ms - HOUR, ms + HOUR];
      interest.push(code);
    }
  }
  const text = bstate.notams[date] ?? '';
  const notams = text.trim() ? analyzeNotams(text, { icaos: [...new Set(interest)], windows, nowMs: Date.now() }) : null;
  const nowMs = Date.now();
  const brief = briefDay({ legs, wx, rules, route: routeData(legs), extraAlt: bstate.extraAlt[date] ?? {}, nowMs, notams });
  brief.fetchedAt = Math.max(0, ...icaos.map((i) => bstate.stations[i]?.fetchedAt ?? 0)) || null;
  brief.wx = wx;
  brief.date = date;
  return brief;
}

export function setNotams(date, text) {
  if (text.trim()) bstate.notams[date] = text;
  else delete bstate.notams[date];
  saveBriefing();
}

export function setExtraAlt(date, legIndex, list) {
  const cur = { ...(bstate.extraAlt[date] ?? {}) };
  if (list.length) cur[legIndex] = list;
  else delete cur[legIndex];
  if (Object.keys(cur).length) bstate.extraAlt[date] = cur;
  else delete bstate.extraAlt[date];
  saveBriefing();
}

export function clearBriefing() {
  Object.assign(bstate, { stations: {}, sigmets: { at: 0, items: [] }, routes: {}, notams: {}, extraAlt: {}, at: 0, error: null });
  saveBriefing();
}

// Semaforo del giorno per il pulsante nel dettaglio: usa solo i dati già salvati.
export function badgeFor(date) {
  if (!state.settings.briefingOn) return null;
  try {
    const legs = legsOfDay(date);
    if (!legs.length) return null;
    const icaos = stationsNeeded(legs, bstate.rules, bstate.extraAlt[date] ?? {}).icaos;
    if (!icaos.some((i) => bstate.stations[i])) return { level: null, fetchedAt: null };
    const b = buildBrief(date);
    return { level: b.level, fetchedAt: b.fetchedAt };
  } catch (e) {
    console.error(e);
    return null;
  }
}

// aggiornamento automatico: giorni "vicini" (meno di 36 ore)
export async function autoRefresh({ force = false } = {}) {
  if (!state.settings.briefingOn) return false;
  let any = false;
  for (const d of dueDates()) any = (await refreshDay(d, { force })) || any;
  return any;
}

