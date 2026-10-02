// Dagli orari "hhmm" UTC del PDF agli istanti reali (UTC) e all'ora locale.
import { timezoneFor } from './tz.js';

const MIN = 60000;
const DAY = 86400000;

export function dateToMs(isoDate) {
  return Date.parse(isoDate + 'T00:00:00Z');
}

const hhmmToMin = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(2, 4));

// Costruisce gli istanti UTC di un giorno di servizio. Gli orari sono letti in
// ordine cronologico: quando un orario è più piccolo del precedente significa
// che si è passati a mezzanotte (+1 giorno).
export function buildDayTimeline(day) {
  const base = dateToMs(day.date);
  let cursor = base;
  const at = (hhmm) => {
    if (!hhmm || !/^\d{4}$/.test(hhmm)) return null;
    let ms = base + hhmmToMin(hhmm) * MIN;
    while (ms < cursor) ms += DAY;
    cursor = ms;
    return ms;
  };
  const tl = { pickupMs: null, checkIn: null, legs: [], checkOut: null, window: null };
  if (day.pickup) tl.pickupMs = at(day.pickup);
  if (day.checkIn?.time) tl.checkIn = { ...day.checkIn, ms: at(day.checkIn.time) };
  for (const leg of day.legs) {
    const depMs = at(leg.depTime);
    const arrMs = at(leg.arrTime);
    tl.legs.push({ leg, depMs, arrMs });
  }
  if (day.checkOut?.time) tl.checkOut = { ...day.checkOut, ms: at(day.checkOut.time) };
  if (day.window) {
    const startMs = base + hhmmToMin(day.window.start) * MIN;
    let endMs = base + hhmmToMin(day.window.end) * MIN;
    if (endMs < startMs) endMs += DAY;
    tl.window = { startMs, endMs, airport: day.airport };
  }
  // inizio/fine del servizio
  const first = tl.checkIn?.ms ?? tl.legs.find((l) => l.depMs != null)?.depMs ?? tl.window?.startMs ?? null;
  const last = tl.checkOut?.ms ?? [...tl.legs].reverse().find((l) => l.arrMs != null)?.arrMs ?? tl.window?.endMs ?? null;
  tl.startMs = first;
  tl.endMs = last;
  return tl;
}

export function fmtUtc(ms) {
  const d = new Date(ms);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

const formatters = new Map();
function formatterFor(tz) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    formatters.set(tz, f);
  }
  return f;
}

// Ora locale dell'aeroporto. `refDate` è la data (UTC) del giorno di servizio:
// serve per segnare "+1" / "-1" quando la data locale è diversa.
export function localTime(ms, iata, airports, refDate) {
  const tz = timezoneFor(iata, airports);
  if (!tz || ms == null) return null;
  const parts = Object.fromEntries(formatterFor(tz).formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  const localDate = `${parts.year}-${parts.month}-${parts.day}`;
  const dayDelta = refDate ? Math.round((Date.parse(localDate + 'T00:00:00Z') - Date.parse(refDate + 'T00:00:00Z')) / DAY) : 0;
  const utcDate = new Date(ms).toISOString().slice(0, 10);
  const utcDelta = refDate ? Math.round((Date.parse(utcDate + 'T00:00:00Z') - Date.parse(refDate + 'T00:00:00Z')) / DAY) : 0;
  return { time: `${parts.hour}:${parts.minute}`, tz, localDate, dayDelta, utcDayDelta: utcDelta };
}

// Differenza UTC (in ore, es. +2) dell'aeroporto in quell'istante.
export function utcOffsetHours(ms, iata, airports) {
  const tz = timezoneFor(iata, airports);
  if (!tz) return null;
  const p = Object.fromEntries(formatterFor(tz).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  return Math.round(((asUtc - Math.floor(ms / MIN) * MIN) / MIN / 60) * 100) / 100;
}

// Durata in minuti tra due istanti, per mostrare "3h40" di volo.
export function durationMin(aMs, bMs) {
  return aMs == null || bMs == null ? null : Math.round((bMs - aMs) / MIN);
}

export function fmtDuration(min) {
  if (min == null) return '';
  return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`;
}
