// Statistiche FT / DT e confronto con i totali stampati nel PDF.
import { h, fmtMonth, mmToHm, todayIso, fmtDayShort, daysInMonth } from './util.js';
import { state, saveSettings, monthDays, monthKeys } from './state.js';
import { monthSummary, rolling, LIMITS } from '../src/stats.js';
import { checkTotals } from '../src/parser.js';
import { fmtHM as hmm } from '../src/ftl.js';
import { actions } from './state.js';
import { tr } from '../src/i18n.js';

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

  const ftl = state.ftl;
  if (ftl) {
    const mine = ftl.issues.filter((i) => i.date.startsWith(key) && i.severity !== 'info');
    const bad = mine.filter((i) => i.severity === 'bad').length;
    const free = ftl.freeByMonth[key];
    const peak = (k, label) => {
      const c = ftl.cumulative[k];
      return h('div', { style: 'margin:8px 0' }, h('div', { class: 'row spread' }, h('span', {}, label), h('span', {}, h('b', {}, hmm(c.min)), h('span', { class: 'muted' }, ` / ${hmm(c.limit)}`))), meter(c.min, c.limit));
    };
    parts.push(h('div', { class: 'card' }, h('h2', {}, tr('Controllo FTL (OMA-A cap. 7)', 'FTL check (OM-A ch. 7)')),
      h('div', { style: 'margin-bottom:6px' }, mine.length ? h('b', { class: bad ? 'bad' : '', style: bad ? '' : 'color:var(--warn)' }, tr(`${bad} da correggere · ${mine.length - bad} da osservare`, `${bad} to fix · ${mine.length - bad} to watch`)) : h('b', { class: 'ok' }, tr('Nessun problema trovato', 'No issues found')), h('span', { class: 'muted' }, tr(' in questo mese', ' this month'))),
      mine.map((i) => h('button', { class: `issue ${i.severity}`, onclick: () => actions.openDay(i.date) }, h('span', { class: 'dot' }), h('span', {}, i.text, h('small', {}, i.date.split('-').reverse().join('/'))))),
      free ? h('div', { class: 'cmp' }, h('span', {}, tr('Giorni liberi (minimo 7 al mese)', 'Days off (minimum 7 per month)')), h('b', { class: free.free >= 7 ? 'ok' : 'bad' }, `${free.free}`)) : null,
      h('div', { style: 'margin-top:10px' }, peak('duty7', tr('Duty 7 giorni (picco)', 'Duty 7 days (peak)')), peak('duty14', tr('Duty 14 giorni (picco)', 'Duty 14 days (peak)')), peak('duty28', tr('Duty 28 giorni (picco)', 'Duty 28 days (peak)'))),
      h('p', { class: 'muted', style: 'font-size:12px;margin-top:8px' }, tr('Il duty è dal check-in al check-out (stand-by al 25%, reserve esclusa). Il controllo copre i PDF importati e non sostituisce il manuale.', 'Duty runs from check-in to check-out (standby at 25%, reserve excluded). The check covers the imported PDFs and does not replace the manual.'))));
  }
  parts.push(h('div', { class: 'card' }, h('h2', {}, `${tr('Mese', 'Month')} · ${fmtMonth(key)}`),
    h('div', { class: 'row spread' },
      h('div', {}, h('div', { class: 'big-num' }, mmToHm(s.ft)), h('small', {}, 'Flight time (FT)')),
      h('div', { style: 'text-align:right' }, h('div', { class: 'big-num' }, mmToHm(s.dt)), h('small', {}, 'Duty time (DT)'))),
    h('div', { style: 'margin-top:12px' },
      [[tr('Giorni di volo', 'Flight days'), s.flightDays], [tr('Settori', 'Sectors'), s.sectors], [tr('Notti in hotel', 'Hotel nights'), s.nights], [tr('Trasferimenti', 'Positioning'), s.transportDays], ['Stand-by', s.standbyDays], ['Reserve', s.reserveDays], [tr('Simulatore', 'Simulator'), `${s.simDays}${s.simFt ? ` (${mmToHm(s.simFt)} SIM FT)` : ''}`], [tr('Attività a terra', 'Ground duty'), s.groundDays], [tr('Riposi', 'Days off'), s.offDays], [tr('Ferie', 'Leave'), s.vacDays], [tr('Giorni X', 'X days'), s.restDays]]
        .filter(([, v]) => v !== 0 && v !== '0')
        .map(([l, v]) => h('div', { class: 'cmp' }, h('span', {}, l), h('b', {}, v))))));

  // confronto con i totali stampati nei PDF che coprono questo mese
  const imports = state.imports.filter((i) => i.roster.meta.periodStart?.startsWith(key) || i.roster.meta.periodEnd?.startsWith(key)).sort((a, b) => b.importedAt.localeCompare(a.importedAt));
  if (imports.length) {
    const cards = imports.slice(0, 2).map((imp) => {
      const c = checkTotals(imp.roster);
      const line = (label, comp, printed, ok) => h('div', { class: 'cmp' }, h('span', {}, label), h('span', {}, `${tr('calcolato', 'computed')} ${comp} · PDF ${printed ?? '—'} `, ok == null ? '' : ok ? h('span', { class: 'ok' }, '✓') : h('span', { class: 'bad' }, '≠')));
      return h('div', { style: 'margin-top:6px' },
        h('small', { class: 'muted' }, `${tr('PDF stampato', 'PDF printed')} ${imp.roster.meta.printedAt?.replace('T', ' ') ?? ''} · ${fmtDayShort(imp.roster.meta.periodStart)}–${fmtDayShort(imp.roster.meta.periodEnd)}`),
        line('FT', c.computed.ft, c.printed.ft, c.ftOk), line('DT', c.computed.dt, c.printed.dt, c.dtOk), line(tr('Giorni Off', 'Days off'), c.computed.offDays, c.printed.offDays, c.offOk));
    });
    parts.push(h('div', { class: 'card' }, h('h2', {}, tr('Confronto con i totali del PDF', 'Comparison with PDF totals')), cards));
  }

  // finestre mobili
  const seg = h('div', { class: 'seg' },
    [['today', tr('Fino a oggi', 'Up to today')], ['end', tr('Fine mese', 'End of month')]].map(([v, l]) => h('button', { 'aria-pressed': String(mode === v), onclick: () => { state.settings.statsUntil = v; saveSettings(); renderStats(view); } }, l)));
  const r7 = rolling(state.data.days, refDate, 7);
  const r14 = rolling(state.data.days, refDate, 14);
  const r28 = rolling(state.data.days, refDate, 28);
  parts.push(h('div', { class: 'card' }, h('h2', {}, tr(`Periodi mobili al ${fmtDayShort(refDate)}`, `Rolling periods to ${fmtDayShort(refDate)}`)), seg,
    limitRow(tr('FT ultimi 28 giorni', 'FT last 28 days'), r28.ft, LIMITS.ft28), limitRow(tr('DT ultimi 7 giorni', 'DT last 7 days'), r7.dt, LIMITS.dt7), limitRow(tr('DT ultimi 14 giorni', 'DT last 14 days'), r14.dt, LIMITS.dt14), limitRow(tr('DT ultimi 28 giorni', 'DT last 28 days'), r28.dt, LIMITS.dt28),
    h('p', { class: 'muted', style: 'font-size:12px;margin-top:8px' }, tr('Limiti indicativi EASA ORO.FTL.210. Contano solo i giorni presenti nei PDF importati: se mancano mesi precedenti il valore è sottostimato.', 'Indicative EASA ORO.FTL.210 limits. Only days in the imported PDFs count: if earlier months are missing the value is underestimated.'))));

  // andamento mesi
  const keys = monthKeys();
  if (keys.length > 1) {
    const vals = keys.map((k) => ({ k, ft: monthSummary(monthDays(k)).ft }));
    const max = Math.max(...vals.map((v) => v.ft), 1);
    parts.push(h('div', { class: 'card' }, h('h2', {}, tr('FT per mese', 'FT per month')), h('div', { class: 'bars' }, vals.slice(-12).map((v) => h('div', {}, h('b', {}, mmToHm(v.ft)), h('i', { style: `height:${(v.ft / max) * 80}%` }), h('span', {}, fmtMonth(v.k).slice(0, 3)))))));
  }
  view.replaceChildren(...parts);
}
