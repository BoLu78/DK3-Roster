// Dettaglio di un giorno di servizio.
import { h, fmtDayShort, dowOf, kindOf, titleCase } from './util.js';
import { dowName } from './util.js';
import { state, actions, saveSettings, homeTravelMin } from './state.js';
import { fmtHM } from '../src/ftl.js';
import { eventName } from '../src/labels.js';
import { wxChip } from './weather-ui.js';
import { times, timeEl, utcText, locText } from './timefmt.js';
import { buildDayTimeline, durationMin, fmtDuration, fmtUtc, utcOffsetHours } from '../src/timeline.js';
import { arrowRoute, tailLines } from './views-list.js';
import { collectRoutes } from '../src/geo.js';
import { createMap } from './map.js';
import { markDaySeen } from './seen.js';
import { icaoFor } from '../src/airports-icao.js';
import { airlineNote } from '../src/airlines.js';
import { tr } from '../src/i18n.js';
import { changeLine } from '../src/diff.js';

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
  const name = leg.kind === 'flight' ? `${leg.airline ?? ''} ${leg.number}`.trim() : leg.kind === 'transport' ? `${tr('Trasferimento', 'Positioning')} ${leg.code}` : `${tr('Attività', 'Activity')} ${leg.code}`;
  const pt = (code, t, right) => h('div', { class: `pt${right ? ' r' : ''}` },
    h('div', { class: 'apt' }, code ?? '—'),
    icaoFor(code) ? h('div', { class: 'icao' }, icaoFor(code)) : null,
    h('div', { class: 'city' }, airportName(code) || ' '),
    h('div', { class: 'tu' }, t ? utcText(t) : '—'),
    h('div', { class: 'tl' }, t ? (t.loc ? locText(t) : tr('ora locale n.d.', 'local time n/a')) : ''),
    h('div', { class: 'wxline' }, wxChip(code, right ? arrMs : depMs, { detail: true })));
  const off = utcOffsetHours(depMs, leg.dep, state.data.airports);
  const other = airlineNote(leg);
  return h('div', { class: 'leg' },
    h('div', { class: 'head' }, h('b', {}, name), h('span', {}, leg.ac ?? '')),
    other ? h('div', { class: 'airline-note' }, other) : null,
    h('div', { class: 'route' }, pt(leg.dep, dep, false),
      h('div', { class: 'mid' },
        dur != null && leg.kind !== 'ground' ? h('div', { class: 'dur' }, fmtDuration(dur)) : null,
        h('div', {}, leg.kind === 'flight' ? '✈︎' : leg.kind === 'transport' ? '→' : '•')),
      leg.arr ? pt(leg.arr, arr, true) : h('div')),
    off != null ? h('div', { class: 'info' }, `${tr('Fuso di', 'Time zone of')} ${leg.dep}: UTC${off >= 0 ? '+' : ''}${off}`) : null,
    leg.takeoff || leg.landing ? h('div', {}, h('span', { class: 'pf' }, [leg.takeoff ? tr('Decollo', 'Take-off') : null, leg.landing ? tr('Atterraggio', 'Landing') : null].filter(Boolean).join(' + '))) : null,
    leg.note ? h('div', { class: 'info' }, leg.note) : null);
}

const STATE_TXT = () => ({
  local: tr('acclimatato all’ora locale di partenza', 'acclimatised to local departure time'),
  B: tr('acclimatato all’ora di base (B)', 'acclimatised to home base time (B)'),
  D: tr('acclimatato all’ora locale di destinazione (D)', 'acclimatised to local destination time (D)'),
  X: tr('acclimatazione sconosciuta (X): tabella ridotta', 'unknown acclimatisation state (X): reduced table'),
});

function utcRange(startMs, min) {
  return `${fmtUtc(startMs)} – ${fmtUtc(startMs + min * 60000)} UTC`;
}

// Riquadro FDP: effettivo, massimo, Cpt Discretion e margini, con l'ultimo decollo possibile
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
  const seg = d.crewLocked
    ? h('div', { class: 'muted', style: 'font-size:13px;margin:6px 0' }, tr('Piloti: 2 (standard) · riposo in volo non ammesso con Extension', 'Pilots: 2 (standard) · in-flight rest not allowed with Extension'))
    : h('div', { class: 'crewseg' }, h('span', { class: 'muted' }, tr('Piloti', 'Pilots')), h('div', { class: 'seg' }, [2, 3, 4].map((n) => h('button', { 'aria-pressed': String(d.crew === n), onclick: () => setCrew(n) }, n === 2 ? '2 (standard)' : String(n)))));
  const kindTxt = { basic: tr('tabella base', 'basic table'), ext: tr('con Extension', 'with Extension'), inflight: tr('con riposo in volo', 'with in-flight rest') }[d.limitKind] ?? tr('tabella base', 'basic table');
  const refTime = `${String(Math.floor(d.refMinute / 60)).padStart(2, '0')}:${String(d.refMinute % 60).padStart(2, '0')}`;
  const sub = tr(`${f.sectors} ${f.sectors === 1 ? 'settore' : 'settori'}, inizio ${refTime} ora di riferimento`, `${f.sectors} ${f.sectors === 1 ? 'sector' : 'sectors'}, start ${refTime} reference time`);
  const limitMin = stat === 'ext' ? L.ext : L.used;
  // ultimo decollo dell'ultimo settore che rispetta il limite (con la durata di blocco prevista di quel settore)
  const lastTakeoff = (limit) => {
    const t = times(f.startMs + (limit - f.lastBlockMin) * 60000, f.lastDepApt, day.date);
    return h('small', { class: 'lastto' }, `${tr('Ultimo decollo da', 'Latest take-off from')} ${f.lastDepApt}: `, h('b', {}, utcText(t)), t.loc ? ` (${locText(t)})` : '');
  };
  const limitRow = (label, limit, note) => h('div', { class: 'fdp-row' },
    h('span', {}, label, h('small', {}, `${tr('Block-in entro', 'Block-in by')} ${fmtUtc(f.startMs + limit * 60000)}Z${note ? ` · ${note}` : ''}`), lastTakeoff(limit)),
    h('b', {}, `${fmtHM(limit)} h`));
  // ultimo sblocco dal primo aeroporto: ritardo dopo la presentazione, voli e soste come da schedulato
  // (giallo = rispetta il massimo, rosso = rispetta la Cpt Discretion)
  const latestOffBlock = (limit, cls, label, note) => {
    if (limit == null || f.firstDepMs == null || f.schedSpanMin == null) return null;
    const ms = f.startMs + (limit - f.schedSpanMin) * 60000;
    const delay = Math.round((ms - f.firstDepMs) / 60000);
    const t = times(ms, f.firstDepApt, day.date);
    return h('div', { class: `offblock ${cls}` },
      h('span', {}, label, h('small', {}, delay >= 0 ? tr(`ritardo massimo ${fmtHM(delay)}`, `max delay ${fmtHM(delay)}`) : tr(`già oltre di ${fmtHM(-delay)} con lo schedulato`, `already over by ${fmtHM(-delay)} on schedule`)), note ? h('small', {}, note) : null),
      h('b', {}, utcText(t), t.loc ? h('small', {}, locText(t)) : null));
  };
  const offBlock = f.firstDepMs != null
    ? h('div', { class: 'offblocks' },
        h('div', { class: 'offblocks-title' }, `${tr('Ultimo sblocco da', 'Latest off-block from')} ${f.firstDepApt}`),
        latestOffBlock(limitMin, 'max', tr('Massimo', 'Maximum'), null),
        latestOffBlock(L.discretion, 'disc', 'Cpt Discretion', f.firstDepAtHub ? tr(`Da evitare a ${f.firstDepApt}: base/hub con riserve e stand-by (OMA 7.2.1)`, `To be avoided at ${f.firstDepApt}: base/hub with reserve and standby crew (OM-A 7.2.1)`) : null),
        h('small', { class: 'muted' }, tr('Per ritardi dopo la presentazione (se ti avvisano prima vale il delayed reporting, OMA 7.2.2).', 'For delays after reporting (if notified before, delayed reporting applies, OM-A 7.2.2).')))
    : null;
  const rows = [
    offBlock,
    h('div', { class: 'fdp-row' }, h('span', {}, tr('Effettivo', 'Actual'), h('small', {}, utcRange(f.startMs, f.min))), h('b', {}, `${fmtHM(f.min)} h`)),
    limitMin != null ? limitRow(tr('Massimo', 'Maximum'), limitMin, kindTxt) : h('div', { class: 'fdp-row' }, h('span', {}, tr('Massimo', 'Maximum')), h('b', {}, tr('n.d.', 'n/a'))),
    L.discretion != null ? limitRow('Cpt Discretion', L.discretion, null) : null,
    d.gapMin != null ? h('div', { class: `fdp-row gap ${stat}` }, h('span', {}, tr('Margine al massimo', 'Margin to maximum')), h('b', {}, `${d.gapMin < 0 ? '−' : ''}${fmtHM(Math.abs(d.gapMin))} h`)) : null,
    L.discretion != null ? h('div', { class: `fdp-row gap ${f.min > L.discretion ? 'over' : 'ok'}` }, h('span', {}, tr('Margine Cpt Discretion', 'Cpt Discretion margin')), h('b', {}, `${f.min > L.discretion ? '−' : ''}${fmtHM(Math.abs(L.discretion - f.min))} h`)) : null,
  ];
  const tags = d.tags.map((t) => h('span', { class: 'chip warn' }, { presto: tr('Inizio presto', 'Early start'), tardi: tr('Fine tardi', 'Late finish'), notte: tr('Servizio notturno', 'Night duty') }[t] ?? t));
  if (day.flags.includes('E_FDP')) tags.unshift(h('span', { class: 'chip ext' }, 'EXTENSION'));
  return h('div', { class: 'card' }, h('h2', {}, `FDP cockpit${d.dates[0] !== day.date ? ` · ${tr('servizio iniziato il', 'duty started on')} ${d.dates[0].slice(8)}/${d.dates[0].slice(5, 7)}` : ''}`),
    seg, rows,
    h('p', { class: 'muted', style: 'font-size:12.5px;margin-top:8px' }, `${sub} · ${STATE_TXT()[d.acclimatisation.state]}.`),
    d.notes.length ? h('ul', { class: 'ftl-notes' }, d.notes.map((n) => h('li', {}, n))) : null,
    tags.length ? h('div', { class: 'tagrow' }, tags) : null,
  );
}

function restCard(r) {
  const cls = r.status === 'over' ? 'over' : r.status === 'warn' ? 'warn' : 'ok';
  return h('div', { class: 'card' }, h('h2', {}, tr('Riposo prima di questo servizio', 'Rest before this duty')),
    h('div', { class: 'fdp-row' }, h('span', {}, tr('Effettivo', 'Actual'), h('small', {}, r.atBase ? tr('a base', 'at home base') : tr('fuori base', 'away from base'))), h('b', {}, `${fmtHM(r.restMin)} h`)),
    h('div', { class: 'fdp-row' }, h('span', {}, tr('Minimo richiesto', 'Minimum required'), h('small', {}, r.why.join(' · '))), h('b', {}, `${fmtHM(r.needMin)} h`)),
    h('div', { class: `fdp-row gap ${cls}` }, h('span', {}, tr('Margine', 'Margin')), h('b', {}, `${r.restMin < r.needMin ? '−' : ''}${fmtHM(Math.abs(r.restMin - r.needMin))} h`)));
}

function body(day) {
  const k = kindOf(day);
  const tl = buildDayTimeline(day);
  const ref = day.date;
  const parts = [];
  const isExt = day.flags.includes('E_FDP');
  const hero = h('div', { class: `hero ${k.cls}${isExt ? ' ext' : ''}` }, h('span', { class: 'pill' }, k.label), isExt ? h('span', { class: 'pill extpill' }, 'EXTENSION') : null,
    h('div', { class: 'big' }, day.kind === 'flight' || day.kind === 'transport' ? arrowRoute(day) : day.kind === 'sim' ? tr('Simulatore', 'Simulator') : day.kind === 'ground' ? tr('Attività a terra', 'Ground duty') : day.kind === 'off' ? 'OFF' : day.kind === 'vacation' ? tr('Ferie', 'Leave') : day.kind === 'rest' ? tr('Giorno X', 'Day X') : day.kind === 'standby' ? k.label : tr('Nessun servizio', 'No duty')),
    day.kind === 'standby' && tl.window ? h('div', {}, timeEl(times(tl.window.startMs, day.airport, ref)), ' → ', timeEl(times(tl.window.endMs, day.airport, ref))) : null);
  parts.push(hero);

  for (const t of tailLines(day.date)) parts.push(h('div', { class: 'card', style: 'padding:10px 14px' }, t));
  const pend = state.pending.get(day.date);
  if (pend) parts.push(h('div', { class: 'card changes' }, h('h2', {}, `${tr('Modificato dall’ultimo import', 'Changed since the last import')} (${{ added: tr('aggiunto', 'added'), removed: tr('tolto', 'removed'), changed: tr('cambiato', 'changed') }[pend.kind]})`), h('ul', {}, pend.lines.map((l) => h('li', {}, changeLine(l)))),
    h('button', { class: 'btn secondary', style: 'margin-top:10px', onclick: async () => { await markDaySeen(day.date); await actions.refresh(); showDetail(day.date); } }, tr('Visto: togli il pallino di questo giorno', 'Seen: clear this day’s marker'))));

  const cells = [];
  if (day.ft != null || day.dt != null) {
    cells.push(h('div', {}, h('small', { class: 'muted' }, 'FT'), h('b', {}, day.ft ?? '—'), h('div', { class: 'sub' }, tr('tempo di volo', 'flight time'))));
    cells.push(h('div', {}, h('small', { class: 'muted' }, 'DT'), h('b', {}, day.dt ?? '—'), h('div', { class: 'sub' }, 'duty time')));
  }
  if (day.simFt && day.simFt !== '0:00') cells.push(h('div', {}, h('small', { class: 'muted' }, 'SIM FT'), h('b', {}, day.simFt)));
  if (cells.length) parts.push(h('div', { class: 'grid4' }, cells));
  const first = day.seq?.[0];
  if (first && !['pickup', 'ci'].includes(first.t)) parts.push(h('p', { class: 'muted', style: 'margin:6px 4px 0;font-size:13px' }, tr('↤ Giorno X: contiene la parte finale del servizio iniziato il giorno prima.', '↤ Day X: contains the end of the duty that started the day before.')));

  // eventi nell'ordine del PDF: pick up, check-in, tratte, check-out
  const evRow = (label, apt, ms) => {
    const t = times(ms, apt, ref);
    return h('div', { class: 'ev' }, h('span', { class: 'lb' }, label, apt ? h('small', { class: 'muted' }, apt) : null),
      h('span', { class: 'tm' }, h('b', {}, t ? utcText(t) : '—'), h('div', { class: 'loc', style: 'font-size:13px' }, t ? (t.loc ? locText(t) : tr('ora locale n.d.', 'local time n/a')) : '')));
  };
  const geo = collectRoutes([day]);
  if (geo.routes.length) {
    const mini = h('div', { class: 'mapbox mini' });
    parts.push(mini);
    requestAnimationFrame(() => createMap(mini, { routes: geo.routes, airports: geo.airports, height: 170, interactive: false }));
  }
  const homeRow = (ciMs, apt, refDate) => {
    const t = times(ciMs - homeTravelMin() * 60000, apt, refDate);
    return h('div', { class: 'ev home' }, h('span', { class: 'lb' }, tr('🏠 Partenza da casa', '🏠 Leave home'), h('small', { class: 'muted' }, tr(`${homeTravelMin()} min prima`, `${homeTravelMin()} min before`))),
      h('span', { class: 'tm' }, h('b', {}, t ? utcText(t) : '—'), h('div', { class: 'loc', style: 'font-size:13px' }, t?.loc ? locText(t) : '')));
  };
  for (const e of tl.events) {
    if (e.t === 'leg') parts.push(legCard(e, day));
    else if (e.t === 'pickup') parts.push(evRow('Pick up', day.checkIn?.airport ?? day.airport, e.ms));
    else {
      if (e.t === 'ci' && e.airport === (state.data.pilot?.base ?? 'MXP')) parts.push(homeRow(e.ms, e.airport, ref));
      parts.push(evRow(eventName(e.label, e.t === 'ci' ? 'C/I' : 'C/O'), e.airport, e.ms));
    }
  }
  if (day.kind !== 'off' && day.kind !== 'blank' && tl.events.length && !tl.events.some((e) => e.t === 'co')) parts.push(h('p', { class: 'muted', style: 'margin:6px 4px 0;font-size:13px' }, tr('Il servizio continua il giorno dopo ↦', 'The duty continues the next day ↦')));

  if (day.hotel) {
    const hot = day.hotel;
    parts.push(h('div', { class: 'card hotel' }, h('h2', {}, `Hotel ${hot.code}${hot.airport ? ` · ${hot.airport}` : ''}`), h('div', {}, hot.name ?? hot.code), hot.phone ? h('div', {}, h('a', { href: `tel:${hot.phone.replace(/[^\d+]/g, '')}` }, hot.phone)) : null));
  }
  if (day.notes.length) parts.push(h('div', { class: 'card' }, h('h2', {}, tr('Note', 'Notes')), day.notes.map((n) => h('div', {}, n))));
  // giorno senza voli ma con hotel (pernottamento): meteo del luogo
  const stay = day.hotel?.airport;
  if (stay && !tl.legs.length) {
    const chip = wxChip(stay, Date.parse(day.date + 'T12:00:00Z'), { detail: true });
    if (chip) parts.push(h('div', { class: 'ev' }, h('span', { class: 'lb' }, tr('Meteo', 'Weather'), h('small', { class: 'muted' }, stay)), h('span', { class: 'tm' }, chip)));
  }
  const ftl = state.ftl?.byDate.get(day.date);
  for (const d of ftl?.duties ?? []) if (d.fdp) parts.push(fdpCard(d, day));
  for (const r of ftl?.rests ?? []) parts.push(restCard(r));
  if (day.kind === 'off' && !tl.events.length) parts.push(h('p', { class: 'muted', style: 'text-align:center;margin-top:30px' }, tr('Giorno OFF', 'Day OFF')));
  if (day.kind === 'blank') parts.push(h('p', { class: 'muted', style: 'text-align:center;margin-top:30px' }, tr('Nessun servizio indicato nel PDF', 'No duty shown in the PDF')));
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
      h('button', { onclick: () => actions.closeSheet(), 'aria-label': tr('Indietro', 'Back') }, tr('‹ Indietro', '‹ Back')),
      h('h1', {}, `${dowName(date)} ${fmtDayShort(date)} ${date.slice(0, 4)}`),
      h('button', { disabled: i <= 0, onclick: () => showDetail(all[i - 1]), 'aria-label': tr('Giorno precedente', 'Previous day') }, '‹'),
      h('button', { disabled: i >= all.length - 1, onclick: () => showDetail(all[i + 1]), 'aria-label': tr('Giorno successivo', 'Next day') }, '›')),
    h('div', { class: 'body' }, body(day)));
  el.style.animation = 'none';
  requestAnimationFrame(() => (el.style.animation = ''));
  showDetail.current = date;
}
