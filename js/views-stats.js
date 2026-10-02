// Statistiche FT / DT e confronto con i totali stampati nel PDF.
import { h, fmtMonth, mmToHm, todayIso, fmtDayShort, daysInMonth } from './util.js';
import { state, saveSettings, monthDays, monthKeys } from './state.js';
import { monthSummary, rolling, LIMITS } from '../src/stats.js';
import { checkTotals } from '../src/parser.js';

function meter(value, limit) {
  const pct = Math.min(100, (value / limit) * 100);
  return h('div', { class: 'meter' }, h('i', { class: value > limit ? 'over' : pct > 85 ? 'warn' : '', style: `width:${pct}%` }));
}

function limitRow(label, value, limit) {
  return h('div', { style: 'margin:10px 0' }, h('div', { class: 'row spread' }, h('span', {}, label), h('span', {}, h('b', {}, mmToHm(value)), h('span', { class: 'muted' }, ` / ${mmToHm(limit)}`))), meter(value, limit));
}

export function renderStats(view) {
  const key = state.month;
  const days = monthDays(key);
  const s = monthSummary(days);
  const today = todayIso();
  const monthEnd = `${key}-${String(daysInMonth(key)).padStart(2, '0')}`;
  const inMonth = today.startsWith(key);
  const mode = state.settings.statsUntil === 'auto' ? (inMonth ? 'today' : 'end') : state.settings.statsUntil;
  const refDate = mode === 'today' && inMonth ? today : monthEnd;
  const parts = [];

  parts.push(h('div', { class: 'card' }, h('h2', {}, `Mese · ${fmtMonth(key)}`),
    h('div', { class: 'row spread' },
      h('div', {}, h('div', { class: 'big-num' }, mmToHm(s.ft)), h('small', {}, 'Flight time (FT)')),
      h('div', { style: 'text-align:right' }, h('div', { class: 'big-num' }, mmToHm(s.dt)), h('small', {}, 'Duty time (DT)'))),
    h('div', { style: 'margin-top:12px' },
      [['Giorni di volo', s.flightDays], ['Settori', s.sectors], ['Notti in hotel', s.nights], ['Trasferimenti', s.transportDays], ['Stand-by', s.standbyDays], ['Reserve', s.reserveDays], ['Simulatore', `${s.simDays}${s.simFt ? ` (${mmToHm(s.simFt)} SIM FT)` : ''}`], ['Riposi', s.offDays]]
        .filter(([, v]) => v !== 0 && v !== '0')
        .map(([l, v]) => h('div', { class: 'cmp' }, h('span', {}, l), h('b', {}, v))))));

  // confronto con i totali stampati nei PDF che coprono questo mese
  const imports = state.imports.filter((i) => i.roster.meta.periodStart?.startsWith(key) || i.roster.meta.periodEnd?.startsWith(key)).sort((a, b) => b.importedAt.localeCompare(a.importedAt));
  if (imports.length) {
    const cards = imports.slice(0, 2).map((imp) => {
      const c = checkTotals(imp.roster);
      const line = (label, comp, printed, ok) => h('div', { class: 'cmp' }, h('span', {}, label), h('span', {}, `calcolato ${comp} · PDF ${printed ?? '—'} `, ok == null ? '' : ok ? h('span', { class: 'ok' }, '✓') : h('span', { class: 'bad' }, '≠')));
      return h('div', { style: 'margin-top:6px' },
        h('small', { class: 'muted' }, `PDF stampato ${imp.roster.meta.printedAt?.replace('T', ' ') ?? ''} · ${fmtDayShort(imp.roster.meta.periodStart)}–${fmtDayShort(imp.roster.meta.periodEnd)}`),
        line('FT', c.computed.ft, c.printed.ft, c.ftOk), line('DT', c.computed.dt, c.printed.dt, c.dtOk), line('Giorni Off', c.computed.offDays, c.printed.offDays, c.offOk));
    });
    parts.push(h('div', { class: 'card' }, h('h2', {}, 'Confronto con i totali del PDF'), cards));
  }

  // finestre mobili
  const seg = h('div', { class: 'seg' },
    [['today', 'Fino a oggi'], ['end', 'Fine mese']].map(([v, l]) => h('button', { 'aria-pressed': String(mode === v), onclick: () => { state.settings.statsUntil = v; saveSettings(); renderStats(view); } }, l)));
  const r7 = rolling(state.data.days, refDate, 7);
  const r14 = rolling(state.data.days, refDate, 14);
  const r28 = rolling(state.data.days, refDate, 28);
  parts.push(h('div', { class: 'card' }, h('h2', {}, `Periodi mobili al ${fmtDayShort(refDate)}`), seg,
    limitRow('FT ultimi 28 giorni', r28.ft, LIMITS.ft28), limitRow('DT ultimi 7 giorni', r7.dt, LIMITS.dt7), limitRow('DT ultimi 14 giorni', r14.dt, LIMITS.dt14), limitRow('DT ultimi 28 giorni', r28.dt, LIMITS.dt28),
    h('p', { class: 'muted', style: 'font-size:12px;margin-top:8px' }, 'Limiti indicativi EASA ORO.FTL.210. Contano solo i giorni presenti nei PDF importati: se mancano mesi precedenti il valore è sottostimato.')));

  // andamento mesi
  const keys = monthKeys();
  if (keys.length > 1) {
    const vals = keys.map((k) => ({ k, ft: monthSummary(monthDays(k)).ft }));
    const max = Math.max(...vals.map((v) => v.ft), 1);
    parts.push(h('div', { class: 'card' }, h('h2', {}, 'FT per mese'), h('div', { class: 'bars' }, vals.slice(-12).map((v) => h('div', {}, h('b', {}, mmToHm(v.ft)), h('i', { style: `height:${(v.ft / max) * 80}%` }), h('span', {}, fmtMonth(v.k).slice(0, 3)))))));
  }
  view.replaceChildren(...parts);
}
