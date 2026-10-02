// Calendario mensile in stile NetLine: settimane in riga, una barra colorata per
// giorno e le rotazioni con pernottamento come un'unica barra continua.
// Sotto, il riquadro del giorno selezionato.
import { h, dowOf, kindOf, todayIso, mmToHm, fmtDayShort, DOW_SHORT } from './util.js';
import { state, actions, monthDays } from './state.js';
import { monthSummary, addDays } from '../src/stats.js';
import { buildTrips } from '../src/trips.js';
import { buildDayTimeline } from '../src/timeline.js';
import { times, utcText, locText } from './timefmt.js';
import { arrowRoute } from './views-list.js';
import { eventName } from '../src/labels.js';

const base = () => state.data.pilot?.base ?? 'MXP';
let selected = null;

const BAR = {
  standby: { label: 'SBY', cls: 'k-standby' },
  reserve: { label: 'RSV', cls: 'k-reserve' },
  sim: { label: 'SIM', cls: 'k-sim' },
  off: { label: 'OFF', cls: 'k-off' },
  vacation: { label: '🌴 FER', cls: 'k-vac' },
  rest: { label: 'X', cls: 'k-off' },
  transport: { label: '➜ TSP', cls: 'k-transport' },
};

function dayBarOf(day) {
  if (day.kind === 'standby') return day.code === 'RESERVE' ? BAR.reserve : BAR.standby;
  return BAR[day.kind] ?? null;
}

// n = quante colonne (giorni) occupa la barra: in una sola colonna c'è poco spazio
function tripLabel(trip, n) {
  if (trip.kind === 'sim') return 'SIM';
  const icon = trip.kind === 'flight' ? '✈︎' : '➜';
  const s = trip.stops;
  if (n === 1) return `${icon} ${s[0] ?? ''}${s.length > 1 ? `+${s.length - 1}` : ''}`.trim();
  return `${icon} ${s.slice(0, n >= 3 ? 3 : 2).join(' · ')}${s.length > (n >= 3 ? 3 : 2) ? ` +${s.length - (n >= 3 ? 3 : 2)}` : ''}`;
}

function mondayOnOrBefore(iso) {
  return addDays(iso, -((dowOf(iso) + 6) % 7));
}

function weekRow(weekStart, key, trips, today) {
  const dates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const wk = h('div', { class: 'wk' });
  dates.forEach((date, i) => {
    const day = state.data.days.get(date);
    const out = !date.startsWith(key);
    wk.append(h('button', { class: ['dn', out ? 'out' : '', date === today ? 'today' : '', date === selected ? 'sel' : '', state.pending.has(date) ? 'changed' : ''].filter(Boolean).join(' '), style: `grid-column:${i + 1};grid-row:1`, onclick: () => { selected = date; renderCalendar(document.getElementById('view')); }, 'aria-label': date },
      Number(date.slice(8)), day?.hotel ? h('span', { class: 'hot' }, '🛏') : null));
    wk.append(h('div', { class: `ln${out ? ' out' : ''}`, style: `grid-column:${i + 1};grid-row:2` }));
  });
  const covered = new Set();
  for (const t of trips) {
    const from = t.startDate < dates[0] ? dates[0] : t.startDate;
    const to = t.endDate > dates[6] ? dates[6] : t.endDate;
    if (from > to) continue;
    const s = dates.indexOf(from) + 1;
    const n = dates.indexOf(to) + 1 - s + 1;
    for (let i = 0; i < n; i++) covered.add(dates[s - 1 + i]);
    const cls = t.kind === 'flight' ? 'k-flight' : t.kind === 'sim' ? 'k-sim' : 'k-transport';
    wk.append(h('button', { class: `bar solid ${cls}${t.startDate < from ? ' cont-l' : ''}${t.endDate > to ? ' cont-r' : ''}`, style: `grid-column:${s} / span ${n};grid-row:2`, onclick: () => { selected = from; renderCalendar(document.getElementById('view')); } }, tripLabel(t, n)));
  }
  dates.forEach((date, i) => {
    const day = state.data.days.get(date);
    if (!day || covered.has(date)) return;
    const b = dayBarOf(day);
    if (!b) return;
    wk.append(h('button', { class: `bar solid ${b.cls}`, style: `grid-column:${i + 1};grid-row:2`, onclick: () => { selected = date; renderCalendar(document.getElementById('view')); } }, b.label));
  });
  return wk;
}

function selectedCard(date) {
  const day = state.data.days.get(date);
  if (!day) return null;
  const k = kindOf(day);
  const tl = buildDayTimeline(day);
  const t = (ms, apt) => times(ms, apt, day.date);
  const line = (ms, apt) => {
    const x = t(ms, apt);
    return x ? h('span', {}, h('b', {}, utcText(x)), x.loc ? h('span', { class: 'loc' }, ` · ${locText(x)}`) : null) : '—';
  };
  const rows = [];
  for (const e of tl.events) {
    if (e.t === 'leg') {
      const l = e.leg;
      rows.push(h('div', { class: 'cl' }, h('div', { class: 'cl-t' }, l.kind === 'flight' ? `${l.airline ?? ''}${l.number}` : l.code ?? '', ' · ', `${l.dep ?? ''} → ${l.arr ?? ''}`, l.ac ? h('span', { class: 'muted' }, ` · ${l.ac}`) : null),
        h('div', {}, line(e.depMs, l.dep), ' → ', line(e.arrMs, l.arr)),
        l.takeoff || l.landing ? h('div', { class: 'muted', style: 'font-size:12.5px' }, [l.takeoff ? 'Decollo' : null, l.landing ? 'Atterraggio' : null].filter(Boolean).join(' + ')) : null));
    } else if (e.t === 'pickup') rows.push(h('div', { class: 'cl' }, h('div', { class: 'cl-t' }, 'Pick up'), h('div', {}, line(e.ms, day.checkIn?.airport ?? day.airport))));
    else rows.push(h('div', { class: 'cl' }, h('div', { class: 'cl-t' }, eventName(e.label, e.t === 'ci' ? 'C/I' : 'C/O'), ' ', e.airport ?? ''), h('div', {}, line(e.ms, e.airport))));
  }
  if (tl.window) rows.push(h('div', { class: 'cl' }, h('div', { class: 'cl-t' }, kindOf(day).label, day.airport ? ` ${day.airport}` : ''), h('div', {}, line(tl.window.startMs, day.airport), ' → ', line(tl.window.endMs, day.airport))));
  return h('div', { class: `card selday ${k.cls}` },
    h('div', { class: 'row spread' }, h('b', { style: 'font-size:17px' }, `${DOW_SHORT[dowOf(date)]} ${fmtDayShort(date)}`), h('span', { class: 'pill' }, k.label)),
    day.kind === 'flight' || day.kind === 'transport' ? h('div', { class: 'selroute' }, arrowRoute(day) || '') : null,
    rows,
    day.ft || day.dt ? h('div', { class: 'cl muted' }, `FT ${day.ft ?? '—'} · DT ${day.dt ?? '—'}`) : null,
    day.hotel ? h('div', { class: 'cl' }, `🛏 ${day.hotel.code} ${day.hotel.airport ?? ''} · ${day.hotel.name ?? ''}`) : null,
    h('button', { class: 'btn secondary', style: 'margin-top:10px', onclick: () => actions.openDay(date) }, 'Dettaglio completo'));
}

export function renderCalendar(view) {
  const key = state.month;
  const today = todayIso();
  if (!selected || !selected.startsWith(key)) selected = today.startsWith(key) ? today : `${key}-01`;
  const first = `${key}-01`;
  const trips = buildTrips([...state.data.days.values()].sort((a, b) => a.date.localeCompare(b.date)), base(), state.data.airports);
  const lastDay = monthDays(key).at(-1)?.date ?? first;
  const parts = [h('div', { class: 'wkhead' }, ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'].map((w) => h('span', {}, w)))];
  for (let ws = mondayOnOrBefore(first); ws <= lastDay; ws = addDays(ws, 7)) parts.push(weekRow(ws, key, trips, today));
  const card = selectedCard(selected);
  if (card) parts.push(card);
  const s = monthSummary(monthDays(key));
  parts.push(h('div', { class: 'summary' },
    h('div', {}, h('b', {}, mmToHm(s.ft)), h('small', {}, 'FT')),
    h('div', {}, h('b', {}, mmToHm(s.dt)), h('small', {}, 'DT')),
    h('div', {}, h('b', {}, s.flightDays), h('small', {}, 'Giorni volo')),
    h('div', {}, h('b', {}, s.standbyDays + s.reserveDays), h('small', {}, 'Sby/Rsv'))));
  parts.push(h('div', { class: 'legend' },
    [['k-flight', 'Rotazione'], ['k-transport', 'Trasferimento'], ['k-standby', 'Stand-by'], ['k-reserve', 'Reserve'], ['k-sim', 'Simulatore'], ['k-vac', 'Ferie'], ['k-off', 'Riposo']].map(([c, t]) => h('span', { class: c }, h('i'), t)),
    h('span', {}, '🛏 hotel')));
  view.replaceChildren(...parts);
}
