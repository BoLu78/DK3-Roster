// Piccoli strumenti comuni: creazione elementi, date nella lingua scelta, etichette.
import { tr, dowShort, dowLong, monthName, monthShort } from '../src/i18n.js';

export function h(tag, props, ...kids) {
  const el = tag === 'svg' ? document.createElementNS('http://www.w3.org/2000/svg', 'svg') : document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v; // solo per testo scritto da noi, mai dal PDF
    else el.setAttribute(k, v === true ? '' : v);
  }
  const add = (kid) => {
    if (kid == null || kid === false) return;
    if (Array.isArray(kid)) kid.forEach(add);
    else el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  };
  kids.forEach(add);
  return el;
}

// nomi di giorni e mesi nella lingua scelta (src/i18n.js)
export const dowName = (iso) => dowShort(new Date(iso + 'T00:00:00Z').getUTCDay());

const dateOf = (iso) => new Date(iso + 'T00:00:00Z');
export const dowOf = (iso) => dateOf(iso).getUTCDay();
export const fmtDayLong = (iso) => {
  const d = dateOf(iso);
  return `${dowLong(d.getUTCDay())} ${d.getUTCDate()} ${monthName(d.getUTCMonth())} ${d.getUTCFullYear()}`;
};
export const fmtDayShort = (iso) => {
  const d = dateOf(iso);
  return `${d.getUTCDate()} ${monthShort(d.getUTCMonth())}`;
};
export const fmtMonth = (key) => {
  const [y, m] = key.split('-').map(Number);
  const n = monthName(m - 1);
  return `${n[0].toUpperCase()}${n.slice(1)} ${y}`;
};

export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function daysInMonth(key) {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function shiftMonth(key, n) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// ISO week number (lunedì come primo giorno)
export function isoWeek(iso) {
  const d = dateOf(iso);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((d - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
}

export const mmToHm = (min) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;
export const hhmm = (t) => (t ? `${t.slice(0, 2)}:${t.slice(2)}` : '');

export function titleCase(s) {
  return (s ?? '').toLowerCase().replace(/(^|[\s(-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase());
}

// tipi di giornata: l'etichetta si legge al momento, nella lingua scelta
const kind = (cls, it, en) => ({ cls, get label() { return tr(it, en); } });
export const KINDS = {
  flight: kind('k-flight', 'Volo', 'Flight'),
  transport: kind('k-transport', 'Trasferimento', 'Positioning'),
  standby: kind('k-standby', 'Stand-by', 'Standby'),
  sim: kind('k-sim', 'Simulatore', 'Simulator'),
  ground: kind('k-sim', 'Attività a terra', 'Ground duty'),
  off: kind('k-off', 'OFF', 'OFF'),
  vacation: kind('k-vac', 'Ferie', 'Leave'),
  rest: kind('k-off', 'Giorno X (nessun servizio)', 'Day X (no duty)'),
  blank: kind('k-blank', 'Nessun servizio', 'No duty'),
  other: kind('k-blank', 'Altro', 'Other'),
};

export function kindOf(day) {
  if (day.kind === 'standby' && day.code === 'RESERVE') return { label: 'Reserve', cls: 'k-reserve' };
  return KINDS[day.kind] ?? KINDS.other;
}

export function safeStorage() {
  try {
    const k = '__t';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return localStorage;
  } catch {
    const mem = new Map();
    return { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  }
}
