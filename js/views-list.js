// Lista dei giorni del mese, stile RosterBuster.
import { h, DOW_SHORT, dowOf, fmtMonth, fmtDayShort, isoWeek, kindOf, mmToHm, todayIso } from './util.js';
import { state, actions, monthDays, monthKeys } from './state.js';
import { times, utcText, locText } from './timefmt.js';
import { buildDayTimeline } from '../src/timeline.js';
import { routeOf, flightNumbers } from '../src/ics.js';
import { monthSummary, hhmmToMinutes } from '../src/stats.js';
import { evaluateRecurrent } from '../src/recurrent.js';
import { showImportSheet } from './views-more.js';
import { fmtHM } from '../src/ftl.js';

export const arrowRoute = (day) => routeOf(day).split('-').join(' → ');

// aeroporto in cui si trova l'evento con quell'istante (per l'ora locale)
function airportAt(tl, ms, fallback) {
  for (const e of tl.events) {
    if (e.t === 'leg') {
      if (e.depMs === ms) return e.leg.dep;
      if (e.arrMs === ms) return e.leg.arr;
    } else if (e.ms === ms) return e.airport ?? fallback;
  }
  return fallback;
}

// righe sintetiche di un giorno (usate da lista e prossimo servizio)
export function daySummary(day) {
  const tl = buildDayTimeline(day);
  const out = { title: '', timeline: null, extra: [] };
  const rng = (aMs, aApt, bMs, bApt) => {
    const a = times(aMs, aApt, day.date);
    const b = times(bMs, bApt, day.date);
    if (!a || !b) return null;
    const loc = a.loc && b.loc ? `${a.loc}–${b.loc}${b.locDelta !== a.locDelta ? '+1' : ''} LT` : '';
    return { utc: `${a.utc}–${b.utc}Z${b.utcDelta > a.utcDelta ? '+1' : ''}`, loc };
  };
  const base = day.checkIn?.airport ?? day.airport;
  if (day.kind === 'flight' || day.kind === 'transport' || day.kind === 'sim') {
    const first = day.seq?.[0];
    const hasCo = tl.events.some((e) => e.t === 'co');
    const hasCi = tl.events.some((e) => e.t === 'ci');
    out.title = day.kind === 'sim' ? 'Simulatore' : arrowRoute(day) || (hasCi ? `C/I ${day.checkIn.airport}` : 'Servizio');
    if (tl.startMs != null && tl.endMs != null) {
      if (tl.endMs > tl.startMs) out.timeline = rng(tl.startMs, airportAt(tl, tl.startMs, base), tl.endMs, airportAt(tl, tl.endMs, base));
      else {
        const t = times(tl.startMs, airportAt(tl, tl.startMs, base), day.date);
        out.timeline = { utc: `dalle ${t.utc}Z →`, loc: t.loc ? `${t.loc} LT` : '' };
      }
    }
    if (day.kind === 'flight') out.extra.push(flightNumbers(day));
    if (day.kind === 'sim' && day.legs[0]?.note) out.extra.push(day.legs[0].note);
    if (first && !['pickup', 'ci'].includes(first.t)) out.extra.push('↤ dal giorno prima');
    if (hasCi && !hasCo) out.extra.push('continua il giorno dopo ↦');
  } else if (day.kind === 'standby') {
    out.title = day.code === 'RESERVE' ? 'Reserve' : 'Stand-by';
    if (tl.window) out.timeline = rng(tl.window.startMs, day.airport, tl.window.endMs, day.airport);
    if (day.airport) out.extra.push(day.airport);
  } else if (day.kind === 'vacation') out.title = 'Ferie';
  return out;
}

// FDP effettivo / massimo del servizio che inizia in questo giorno
export function ftlChip(day) {
  const d = state.ftl?.byDate.get(day.date)?.duties.find((x) => x.fdp && x.dates[0] === day.date);
  if (!d || d.status == null) return null;
  return h('span', { class: `ftl ftl-${d.status}` }, `FDP ${fmtHM(d.fdp.min)} / ${fmtHM(d.limits.used)}${d.status === 'ext' ? ' Ext' : ''}`);
}

function dayRow(day, today) {
  const k = kindOf(day);
  const changed = state.pending.has(day.date);
  const cls = ['day', k.cls, day.kind, day.date === today ? 'today' : '', changed ? 'changed' : ''].filter(Boolean).join(' ');
  const dt = h('div', { class: 'dt' }, h('div', { class: 'n' }, Number(day.date.slice(8))), h('div', { class: 'w' }, DOW_SHORT[dowOf(day.date)]));
  let main;
  if (['off', 'blank', 'rest'].includes(day.kind) && !day.seq?.length) {
    main = h('div', { class: 'main' }, { off: 'Riposo', rest: 'Giorno X · nessun nuovo servizio', blank: '—' }[day.kind], day.hotel ? h('span', { class: 'muted', style: 'margin-left:10px' }, `🛏 ${day.hotel.code} ${day.hotel.airport ?? ''}`) : null);
  } else {
    const s = daySummary(day);
    main = h('div', { class: 'main' },
      h('div', { class: 'l1' }, h('span', { class: 'route' }, s.title), day.ft && day.kind === 'flight' ? h('span', { class: 'ft' }, `FT ${day.ft.replace(/^0/, '')}`) : null),
      s.timeline ? h('div', { class: 'l2' }, s.timeline.utc, s.timeline.loc ? h('span', { class: 'loc' }, `  ·  ${s.timeline.loc}`) : null) : null,
      h('div', { class: 'l3' }, s.extra.filter(Boolean).map((x) => h('span', {}, x)), ftlChip(day), day.hotel ? h('span', {}, `🛏 ${day.hotel.code} ${day.hotel.airport ?? ''}`) : null, day.flags.includes('E_FDP') ? h('span', {}, 'E_FDP') : null));
  }
  return h('button', { class: cls, onclick: () => actions.openDay(day.date), 'aria-label': day.date }, dt, h('div', { class: 'bar' }), main);
}

const lastChanged = () => [...state.imports].filter((i) => i.changes && !i.seen).sort((a, b) => b.importedAt.localeCompare(a.importedAt))[0];

export function nextDuty() {
  const today = todayIso();
  return [...state.data.days.values()].filter((d) => d.date >= today && ['flight', 'transport', 'sim', 'standby'].includes(d.kind)).sort((a, b) => a.date.localeCompare(b.date))[0];
}

export function renderList(view) {
  const today = todayIso();
  const key = state.month;
  const days = monthDays(key);
  const frag = [];

  const next = nextDuty();
  if (next) {
    const s = daySummary(next);
    const n = Math.round((Date.parse(next.date + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 86400000);
    const when = n === 0 ? 'Oggi' : n === 1 ? 'Domani' : `Tra ${n} giorni`;
    const k = kindOf(next);
    const ci = next.checkIn ? times(buildDayTimeline(next).checkIn?.ms, next.checkIn.airport, next.date) : null;
    frag.push(h('button', { class: `next ${k.cls}`, onclick: () => actions.openDay(next.date) },
      h('div', { class: 'lbl' }, `Prossimo servizio · ${when} · ${fmtDayShort(next.date)}`),
      h('div', { class: 'big' }, s.title),
      s.timeline ? h('div', {}, s.timeline.utc, s.timeline.loc ? h('span', { class: 'loc' }, `  ·  ${s.timeline.loc}`) : null) : null,
      ci ? h('div', { class: 'loc' }, `${next.checkIn.label ?? 'C/I'} ${utcText(ci)}${ci.loc ? ` (${locText(ci)})` : ''}`) : null));
  }

  const rec = evaluateRecurrent(state.data.recurrent, today, { warn: state.settings.warn, critical: state.settings.critical })
    .filter((r) => (state.settings.include787 || r.aircraft !== 'B787') && r.status !== 'ok');
  if (rec.length) {
    const exp = rec.filter((r) => r.status === 'expired').length;
    frag.push(h('button', { class: 'banner alert', onclick: () => actions.go('exp') }, h('span', {}, '⚠️'), h('span', {}, h('b', {}, exp ? `${exp} scadut${exp === 1 ? 'a' : 'e'}` : `${rec.length} in scadenza`), exp && rec.length > exp ? ` · ${rec.length - exp} in scadenza` : ''), h('span', { class: 'go' }, 'Vedi ›')));
  }
  const ch = days.filter((d) => state.pending.has(d.date));
  if (ch.length) frag.push(h('button', { class: 'banner change', onclick: () => showImportSheet(lastChanged()) }, h('span', {}, '🔄'), h('span', {}, h('b', {}, `${ch.length} giorn${ch.length === 1 ? 'o' : 'i'} modificat${ch.length === 1 ? 'o' : 'i'}`), ' dall’ultimo import'), h('span', { class: 'go' }, 'Vedi ›')));

  const s = monthSummary(days);
  frag.push(h('div', { class: 'summary' },
    h('div', {}, h('b', {}, mmToHm(s.ft)), h('small', {}, 'FT')),
    h('div', {}, h('b', {}, mmToHm(s.dt)), h('small', {}, 'DT')),
    h('div', {}, h('b', {}, s.sectors), h('small', {}, 'Settori')),
    h('div', {}, h('b', {}, s.offDays), h('small', {}, 'Off'))));

  // settimane (lunedì-domenica)
  let curWeek = null;
  let weekBox = null;
  const weeks = [];
  for (const d of days) {
    const w = isoWeek(d.date);
    if (w !== curWeek) {
      curWeek = w;
      weekBox = { w, days: [] };
      weeks.push(weekBox);
    }
    weekBox.days.push(d);
  }
  for (const wk of weeks) {
    const ft = wk.days.reduce((a, d) => a + hhmmToMinutes(d.ft), 0);
    frag.push(h('div', { class: 'week' }, h('span', {}, `Sett. ${wk.w} · ${fmtDayShort(wk.days[0].date)}–${fmtDayShort(wk.days.at(-1).date)}`), ft ? h('span', {}, `FT ${mmToHm(ft)}`) : null));
    for (const d of wk.days) frag.push(dayRow(d, today));
  }
  view.replaceChildren(...frag);
  const t = view.querySelector('.day.today');
  if (t && key === today.slice(0, 7)) requestAnimationFrame(() => t.scrollIntoView({ block: 'center' }));
}

export const monthTitle = () => fmtMonth(state.month);
export const monthStep = (n) => {
  const keys = monthKeys();
  const i = keys.indexOf(state.month) + n;
  if (i >= 0 && i < keys.length) state.month = keys[i];
};
