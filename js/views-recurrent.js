// Scadenze Recurrent Training / Checks.
import { h, fmtDayShort, todayIso } from './util.js';
import { state } from './state.js';
import { evaluateRecurrent } from '../src/recurrent.js';
import { tr } from '../src/i18n.js';

const STATUS_TXT = () => ({ expired: tr('Scaduto', 'Expired'), critical: tr('Urgente', 'Urgent'), warning: tr('In scadenza', 'Due soon'), ok: tr('Valido', 'Valid') });

export function thresholds() {
  return { warn: state.settings.warn, critical: state.settings.critical };
}

export function evaluated() {
  return evaluateRecurrent(state.data.recurrent, todayIso(), thresholds());
}

// quante scadenze richiedono attenzione (per il badge sulla barra)
export function alertCount() {
  return evaluated().filter((r) => (state.settings.include787 || r.aircraft !== 'B787') && r.status !== 'ok').length;
}

function when(r) {
  if (r.daysLeft < 0) return tr(`${-r.daysLeft} gg fa`, `${-r.daysLeft} d ago`);
  if (r.daysLeft === 0) return tr('oggi', 'today');
  if (r.daysLeft < 100) return tr(`tra ${r.daysLeft} gg`, `in ${r.daysLeft} d`);
  const m = Math.round(r.daysLeft / 30.4);
  return tr(`tra ${m} mesi`, `in ${m} months`);
}

function row(r) {
  const [y, m, d] = r.expiry.split('-');
  return h('div', { class: 'exp' },
    h('div', { class: 'nm' }, h('b', {}, r.name), h('small', { class: 'muted' }, `${r.code}${r.aircraft ? ` · ${r.aircraft}` : ''}`)),
    h('div', { class: 'when' }, h('b', {}, `${d}/${m}/${y}`), h('small', { class: 'muted' }, when(r))),
    h('span', { class: `st ${r.status}` }, STATUS_TXT()[r.status]));
}

export function renderRecurrent(view) {
  const all = evaluated();
  if (!all.length) {
    view.replaceChildren(h('div', { class: 'empty-state' }, h('div', { class: 'ico' }, '📋'), h('h2', {}, tr('Nessuna scadenza', 'No expiries')), h('p', {}, tr('Importa un PDF: le scadenze sono nell’ultima pagina.', 'Import a PDF: expiries are on its last page.'))));
    return;
  }
  const main = all.filter((r) => r.aircraft !== 'B787');
  const old = all.filter((r) => r.aircraft === 'B787');
  const urgent = main.filter((r) => r.status !== 'ok');
  const parts = [];
  parts.push(h('div', { class: 'card' }, h('h2', {}, tr('Riepilogo', 'Summary')),
    urgent.length
      ? h('div', {}, h('b', { class: 'bad' }, tr(`${urgent.length} da tenere d'occhio`, `${urgent.length} to keep an eye on`)), h('div', { class: 'muted' }, tr(`Soglie: avviso a ${state.settings.warn} giorni, urgente a ${state.settings.critical}. Prossima: ${urgent[0].name} (${fmtDayShort(urgent[0].expiry)}).`, `Thresholds: warning at ${state.settings.warn} days, urgent at ${state.settings.critical}. Next: ${urgent[0].name} (${fmtDayShort(urgent[0].expiry)}).`)))
      : h('div', {}, h('b', { class: 'ok' }, tr('Tutto in regola', 'All valid')), h('div', { class: 'muted' }, `${tr('Prossima scadenza', 'Next expiry')}: ${main[0]?.name ?? '—'} (${main[0] ? fmtDayShort(main[0].expiry) : ''}, ${main[0] ? when(main[0]) : ''})`))));
  parts.push(h('div', { class: 'card' }, h('h2', {}, tr('Scadenze (per data)', 'Expiries (by date)')), main.map(row)));
  if (old.length) {
    parts.push(h('div', { class: 'card' }, h('details', {}, h('summary', { class: 'muted', style: 'cursor:pointer;font-weight:600' }, `B787 (${old.length}) — ${state.settings.include787 ? tr('incluse negli avvisi', 'included in alerts') : tr('non contate negli avvisi', 'not counted in alerts')}`), h('div', { style: 'margin-top:8px' }, old.map(row)))));
  }
  view.replaceChildren(...parts);
}
