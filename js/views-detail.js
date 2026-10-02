// Dettaglio di un giorno di servizio.
import { h, fmtDayShort, DOW_SHORT, dowOf, kindOf, titleCase } from './util.js';
import { state, actions, saveSettings, homeTravelMin } from './state.js';
import { fmtHM } from '../src/ftl.js';
import { times, timeEl, utcText, locText } from './timefmt.js';
import { buildDayTimeline, durationMin, fmtDuration, fmtUtc, utcOffsetHours } from '../src/timeline.js';
import { arrowRoute } from './views-list.js';
import { collectRoutes } from '../src/geo.js';
import { createMap } from './map.js';

const sheet = () => document.getElementById('sheet');

function airportName(code) {
  const n = state.data.airports[code]?.name;
  return n ? titleCase(n.replace(/\s+APT$/i, '')) : '';
}

function legCard(item, day) {
  const { leg, depMs, arrMs } = item;
  const ref = day.date;
  const dep = times(depMs, leg.dep, ref);
  const arr = times(arrMs, leg.arr, ref);
  const dur = durationMin(depMs, arrMs);
  const name = leg.kind === 'flight' ? `${leg.airline ?? ''} ${leg.number}`.trim() : leg.kind === 'transport' ? `Trasferimento ${leg.code}` : `Attività ${leg.code}`;
  const pt = (code, t, right) => h('div', { class: `pt${right ? ' r' : ''}` },
    h('div', { class: 'apt' }, code ?? '—'),
    h('div', { class: 'city' }, airportName(code) || ' '),
    h('div', { class: 'tu' }, t ? utcText(t) : '—'),
    h('div', { class: 'tl' }, t ? (t.loc ? locText(t) : 'ora locale n.d.') : ''));
  const off = utcOffsetHours(depMs, leg.dep, state.data.airports);
  return h('div', { class: 'leg' },
    h('div', { class: 'head' }, h('b', {}, name), h('span', {}, [leg.ac, dur != null && leg.kind !== 'ground' ? fmtDuration(dur) : null].filter(Boolean).join(' · '))),
    h('div', { class: 'route' }, pt(leg.dep, dep, false), h('div', { class: 'mid' }, leg.kind === 'flight' ? '✈︎' : leg.kind === 'transport' ? '→' : '•'), leg.arr ? pt(leg.arr, arr, true) : h('div')),
    off != null ? h('div', { class: 'info' }, `Fuso di ${leg.dep}: UTC${off >= 0 ? '+' : ''}${off}`) : null,
    leg.takeoff || leg.landing ? h('div', {}, h('span', { class: 'pf' }, [leg.takeoff ? 'Decollo' : null, leg.landing ? 'Atterraggio' : null].filter(Boolean).join(' + '))) : null,
    leg.note ? h('div', { class: 'info' }, leg.note) : null);
}

const STATE_TXT = {
  local: 'acclimatato all’ora locale di partenza',
  B: 'acclimatato all’ora di base (B)',
  D: 'acclimatato all’ora locale di destinazione (D)',
  X: 'acclimatazione sconosciuta (X): tabella ridotta',
};

function utcRange(startMs, min) {
  return `${fmtUtc(startMs)} – ${fmtUtc(startMs + min * 60000)} UTC`;
}

// Riquadro FDP come nell'app EASA: effettivo, massimo, discrezione del comandante (solo riferimento) e margini
function fdpCard(d, day) {
  const f = d.fdp;
  const L = d.limits;
  const stat = d.status;
  const setCrew = (n) => {
    if (n === 2) delete state.settings.ftlCrew[d.key];
    else state.settings.ftlCrew[d.key] = n;
    saveSettings();
    actions.ftlChanged(day.date);
  };
  const seg = h('div', { class: 'crewseg' }, h('span', { class: 'muted' }, 'Piloti'), h('div', { class: 'seg' }, [2, 3, 4].map((n) => h('button', { 'aria-pressed': String(d.crew === n), onclick: () => setCrew(n) }, n === 2 ? '2 (standard)' : String(n)))));
  const kindTxt = { basic: 'tabella base', ext: 'con estensione (Ext)', inflight: 'con riposo in volo' }[d.limitKind] ?? 'tabella base';
  const sub = `${f.sectors} ${f.sectors === 1 ? 'settore' : 'settori'}, inizio ${String(Math.floor(d.refMinute / 60)).padStart(2, '0')}:${String(d.refMinute % 60).padStart(2, '0')} ora di riferimento`;
  const limitMin = stat === 'ext' ? L.ext : L.used;
  const rows = [
    h('div', { class: 'fdp-row' }, h('span', {}, 'Effettivo', h('small', {}, utcRange(f.startMs, f.min))), h('b', {}, `${fmtHM(f.min)} h`)),
    limitMin != null ? h('div', { class: 'fdp-row' }, h('span', {}, 'Massimo', h('small', {}, `${utcRange(f.startMs, limitMin)} · ${kindTxt}`)), h('b', {}, `${fmtHM(limitMin)} h`)) : h('div', { class: 'fdp-row' }, h('span', {}, 'Massimo'), h('b', {}, 'n.d.')),
    L.discretion != null ? h('div', { class: 'fdp-row' }, h('span', {}, 'Discrezione del comandante', h('small', {}, `${utcRange(f.startMs, L.discretion)} · solo riferimento`)), h('b', {}, `${fmtHM(L.discretion)} h`)) : null,
    d.gapMin != null ? h('div', { class: `fdp-row gap ${stat}` }, h('span', {}, 'Margine al massimo'), h('b', {}, `${d.gapMin < 0 ? '−' : ''}${fmtHM(Math.abs(d.gapMin))} h`)) : null,
    L.discretion != null ? h('div', { class: `fdp-row gap ${f.min > L.discretion ? 'over' : 'ok'}` }, h('span', {}, 'Margine alla discrezione'), h('b', {}, `${f.min > L.discretion ? '−' : ''}${fmtHM(Math.abs(L.discretion - f.min))} h`)) : null,
  ];
  const tags = d.tags.map((t) => h('span', { class: 'chip warn' }, { presto: 'Inizio presto', tardi: 'Fine tardi', notte: 'Servizio notturno' }[t] ?? t));
  if (day.flags.includes('E_FDP')) tags.push(h('span', { class: 'chip' }, 'E_FDP (roster)'));
  return h('div', { class: 'card' }, h('h2', {}, `FDP cockpit${d.dates[0] !== day.date ? ` · servizio iniziato il ${d.dates[0].slice(8)}/${d.dates[0].slice(5, 7)}` : ''}`),
    seg, rows,
    h('p', { class: 'muted', style: 'font-size:12.5px;margin-top:8px' }, `${sub} · ${STATE_TXT[d.acclimatisation.state]}${d.crew >= 3 && f.sectors > 3 ? ' · riposo in volo non applicabile (max 3 settori)' : ''}.`),
    d.notes.length ? h('div', { class: 'muted', style: 'font-size:13px' }, d.notes.join(' · ')) : null,
    tags.length ? h('div', { class: 'tagrow' }, tags) : null,
    h('p', { class: 'muted', style: 'font-size:12px;margin-top:8px' }, 'Indicazione calcolata con le tabelle dell’OMA-A cap. 7: fa fede il manuale.'));
}

function restCard(r) {
  const cls = r.status === 'over' ? 'over' : r.status === 'warn' ? 'warn' : 'ok';
  return h('div', { class: 'card' }, h('h2', {}, 'Riposo prima di questo servizio'),
    h('div', { class: 'fdp-row' }, h('span', {}, 'Effettivo', h('small', {}, `${r.atBase ? 'a base' : 'fuori base'}`)), h('b', {}, `${fmtHM(r.restMin)} h`)),
    h('div', { class: 'fdp-row' }, h('span', {}, 'Minimo richiesto', h('small', {}, r.why.join(' · '))), h('b', {}, `${fmtHM(r.needMin)} h`)),
    h('div', { class: `fdp-row gap ${cls}` }, h('span', {}, 'Margine'), h('b', {}, `${r.restMin < r.needMin ? '−' : ''}${fmtHM(Math.abs(r.restMin - r.needMin))} h`)));
}

function body(day) {
  const k = kindOf(day);
  const tl = buildDayTimeline(day);
  const ref = day.date;
  const parts = [];
  const hero = h('div', { class: `hero ${k.cls}` }, h('span', { class: 'pill' }, k.label),
    h('div', { class: 'big' }, day.kind === 'flight' || day.kind === 'transport' ? arrowRoute(day) : day.kind === 'sim' ? 'Simulatore' : day.kind === 'off' ? 'Riposo' : day.kind === 'vacation' ? 'Ferie' : day.kind === 'rest' ? 'Giorno X' : day.kind === 'standby' ? k.label : 'Nessun servizio'),
    day.flags.includes('E_FDP') ? h('div', { class: 'muted' }, 'E_FDP (FDP esteso)') : null,
    day.kind === 'standby' && tl.window ? h('div', {}, timeEl(times(tl.window.startMs, day.airport, ref)), ' → ', timeEl(times(tl.window.endMs, day.airport, ref))) : null);
  parts.push(hero);

  const pend = state.pending.get(day.date);
  if (pend) parts.push(h('div', { class: 'card changes' }, h('h2', {}, `Modificato dall'ultimo import (${{ added: 'aggiunto', removed: 'tolto', changed: 'cambiato' }[pend.kind]})`), h('ul', {}, pend.lines.map((l) => h('li', {}, l)))));

  const cells = [];
  if (day.ft != null || day.dt != null) {
    cells.push(h('div', {}, h('small', { class: 'muted' }, 'FT'), h('b', {}, day.ft ?? '—'), h('div', { class: 'sub' }, 'tempo di volo')));
    cells.push(h('div', {}, h('small', { class: 'muted' }, 'DT'), h('b', {}, day.dt ?? '—'), h('div', { class: 'sub' }, 'duty time')));
  }
  if (day.simFt && day.simFt !== '0:00') cells.push(h('div', {}, h('small', { class: 'muted' }, 'SIM FT'), h('b', {}, day.simFt)));
  if (cells.length) parts.push(h('div', { class: 'grid4' }, cells));
  if (tl.events.length) parts.push(h('p', { class: 'muted', style: 'margin:10px 4px 0;font-size:13px' }, 'Orari UTC (Z) in evidenza, ora locale dell’aeroporto sotto.'));
  const first = day.seq?.[0];
  if (first && !['pickup', 'ci'].includes(first.t)) parts.push(h('p', { class: 'muted', style: 'margin:6px 4px 0;font-size:13px' }, '↤ Giorno X: contiene la parte finale del servizio iniziato il giorno prima.'));

  // eventi nell'ordine del PDF: pick up, C/I, tratte, C/O
  const evRow = (label, apt, ms) => {
    const t = times(ms, apt, ref);
    return h('div', { class: 'ev' }, h('span', { class: 'lb' }, label, apt ? h('small', { class: 'muted' }, apt) : null),
      h('span', { class: 'tm' }, h('b', {}, t ? utcText(t) : '—'), h('div', { class: 'loc', style: 'font-size:13px' }, t ? (t.loc ? locText(t) : 'ora locale n.d.') : '')));
  };
  const geo = collectRoutes([day]);
  if (geo.routes.length) {
    const mini = h('div', { class: 'mapbox mini' });
    parts.push(mini);
    requestAnimationFrame(() => createMap(mini, { routes: geo.routes, airports: geo.airports, height: 170, interactive: false }));
  }
  const homeRow = (ciMs, apt, refDate) => {
    const t = times(ciMs - homeTravelMin() * 60000, apt, refDate);
    return h('div', { class: 'ev home' }, h('span', { class: 'lb' }, '🏠 Partenza da casa', h('small', { class: 'muted' }, `${homeTravelMin()} min prima`)),
      h('span', { class: 'tm' }, h('b', {}, t ? utcText(t) : '—'), h('div', { class: 'loc', style: 'font-size:13px' }, t?.loc ? locText(t) : '')));
  };
  for (const e of tl.events) {
    if (e.t === 'leg') parts.push(legCard(e, day));
    else if (e.t === 'pickup') parts.push(evRow('Pick up', day.checkIn?.airport ?? day.airport, e.ms));
    else {
      if (e.t === 'ci' && e.airport === (state.data.pilot?.base ?? 'MXP')) parts.push(homeRow(e.ms, e.airport, ref));
      parts.push(evRow(e.label === 'C/I' || e.t === 'ci' ? (e.label ?? 'C/I') : (e.label ?? 'C/O'), e.airport, e.ms));
    }
  }
  if (day.kind !== 'off' && day.kind !== 'blank' && tl.events.length && !tl.events.some((e) => e.t === 'co')) parts.push(h('p', { class: 'muted', style: 'margin:6px 4px 0;font-size:13px' }, 'Il servizio continua il giorno dopo ↦'));

  if (day.hotel) {
    const hot = day.hotel;
    parts.push(h('div', { class: 'card hotel' }, h('h2', {}, `Hotel ${hot.code}${hot.airport ? ` · ${hot.airport}` : ''}`), h('div', {}, hot.name ?? hot.code), hot.phone ? h('div', {}, h('a', { href: `tel:${hot.phone.replace(/[^\d+]/g, '')}` }, hot.phone)) : null));
  }
  if (day.notes.length) parts.push(h('div', { class: 'card' }, h('h2', {}, 'Note'), day.notes.map((n) => h('div', {}, n))));
  const ftl = state.ftl?.byDate.get(day.date);
  for (const d of ftl?.duties ?? []) if (d.fdp) parts.push(fdpCard(d, day));
  for (const r of ftl?.rests ?? []) parts.push(restCard(r));
  if (day.kind === 'off' && !tl.events.length) parts.push(h('p', { class: 'muted', style: 'text-align:center;margin-top:30px' }, 'Giorno di riposo'));
  if (day.kind === 'blank') parts.push(h('p', { class: 'muted', style: 'text-align:center;margin-top:30px' }, 'Nessun servizio indicato nel PDF'));
  return parts;
}

export function showDetail(date) {
  const all = [...state.data.days.keys()].sort();
  const i = all.indexOf(date);
  const day = state.data.days.get(date);
  if (!day) return;
  const el = sheet();
  el.hidden = false;
  el.replaceChildren(
    h('header', {},
      h('button', { onclick: () => actions.closeSheet(), 'aria-label': 'Indietro' }, '‹ Indietro'),
      h('h1', {}, `${DOW_SHORT[dowOf(date)]} ${fmtDayShort(date)} ${date.slice(0, 4)}`),
      h('button', { disabled: i <= 0, onclick: () => showDetail(all[i - 1]), 'aria-label': 'Giorno precedente' }, '‹'),
      h('button', { disabled: i >= all.length - 1, onclick: () => showDetail(all[i + 1]), 'aria-label': 'Giorno successivo' }, '›')),
    h('div', { class: 'body' }, body(day)));
  el.style.animation = 'none';
  requestAnimationFrame(() => (el.style.animation = ''));
  showDetail.current = date;
}
