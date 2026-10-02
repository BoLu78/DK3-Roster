// Scadenze Recurrent Training / Checks.
import { h, fmtDayShort, todayIso } from './util.js';
import { state } from './state.js';
import { evaluateRecurrent } from '../src/recurrent.js';

const STATUS_TXT = { expired: 'Scaduto', critical: 'Urgente', warning: 'In scadenza', ok: 'Valido' };

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
  if (r.daysLeft < 0) return `${-r.daysLeft} gg fa`;
  if (r.daysLeft === 0) return 'oggi';
  if (r.daysLeft < 100) return `tra ${r.daysLeft} gg`;
  const m = Math.round(r.daysLeft / 30.4);
  return `tra ${m} mesi`;
}

function row(r) {
  const [y, m, d] = r.expiry.split('-');
  return h('div', { class: 'exp' },
    h('div', { class: 'nm' }, h('b', {}, r.name), h('small', { class: 'muted' }, `${r.code}${r.aircraft ? ` · ${r.aircraft}` : ''}`)),
    h('div', { class: 'when' }, h('b', {}, `${d}/${m}/${y}`), h('small', { class: 'muted' }, when(r))),
    h('span', { class: `st ${r.status}` }, STATUS_TXT[r.status]));
}

export function renderRecurrent(view) {
  const all = evaluated();
  if (!all.length) {
    view.replaceChildren(h('div', { class: 'empty-state' }, h('div', { class: 'ico' }, '📋'), h('h2', {}, 'Nessuna scadenza'), h('p', {}, 'Importa un PDF: le scadenze sono nell’ultima pagina.')));
    return;
  }
  const main = all.filter((r) => r.aircraft !== 'B787');
  const old = all.filter((r) => r.aircraft === 'B787');
  const urgent = main.filter((r) => r.status !== 'ok');
  const parts = [];
  parts.push(h('div', { class: 'card' }, h('h2', {}, 'Riepilogo'),
    urgent.length
      ? h('div', {}, h('b', { class: 'bad' }, `${urgent.length} da tenere d'occhio`), h('div', { class: 'muted' }, `Soglie: avviso a ${state.settings.warn} giorni, urgente a ${state.settings.critical}. Prossima: ${urgent[0].name} (${fmtDayShort(urgent[0].expiry)}).`))
      : h('div', {}, h('b', { class: 'ok' }, 'Tutto in regola'), h('div', { class: 'muted' }, `Prossima scadenza: ${main[0]?.name ?? '—'} (${main[0] ? fmtDayShort(main[0].expiry) : ''}, ${main[0] ? when(main[0]) : ''})`))));
  parts.push(h('div', { class: 'card' }, h('h2', {}, 'Scadenze (per data)'), main.map(row)));
  if (old.length) {
    parts.push(h('div', { class: 'card' }, h('details', {}, h('summary', { class: 'muted', style: 'cursor:pointer;font-weight:600' }, `B787 (${old.length}) — ${state.settings.include787 ? 'incluse' : 'non contate'} negli avvisi`), h('div', { style: 'margin-top:8px' }, old.map(row)))));
  }
  view.replaceChildren(...parts);
}
