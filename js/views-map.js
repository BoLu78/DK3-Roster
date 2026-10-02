// Scheda "Mappa": tratte volate e aeroporti, per mese / anno / tutto.
import { h, fmtMonth, titleCase } from './util.js';
import { state } from './state.js';
import { collectRoutes } from '../src/geo.js';
import { createMap } from './map.js';

let range = 'month'; // month | year | all
let selected = null;

const nf = (n) => n.toLocaleString('it-IT');

function pick() {
  const all = [...state.data.days.values()];
  if (range === 'all') return all;
  if (range === 'year') return all.filter((d) => d.date.startsWith(state.month.slice(0, 4)));
  return all.filter((d) => d.date.startsWith(state.month));
}

export function renderMap(view) {
  const days = pick();
  const info = collectRoutes(days);
  const seg = h('div', { class: 'seg' }, [['month', fmtMonth(state.month)], ['year', state.month.slice(0, 4)], ['all', 'Tutto']].map(([v, l]) =>
    h('button', { 'aria-pressed': String(range === v), onclick: () => { range = v; selected = null; renderMap(view); } }, l)));
  const parts = [seg];

  if (!info.routes.length) {
    parts.push(h('div', { class: 'empty-state' }, h('div', { class: 'ico' }, '🗺️'), h('h2', {}, 'Nessuna tratta'), h('p', {}, 'In questo periodo non ci sono voli con aeroporti noti.')));
    if (info.missing.length) parts.push(missingNote(info));
    view.replaceChildren(...parts);
    return;
  }

  const box = h('div', { class: 'mapbox' });
  const ctl = h('div', { class: 'mapctl' });
  parts.push(box);
  const countries = new Set([...info.airports.keys()].map((c) => state.data.airports[c]?.country).filter(Boolean));
  parts.push(h('div', { class: 'summary', style: 'grid-template-columns:repeat(4,1fr)' },
    h('div', {}, h('b', {}, info.sectors), h('small', {}, 'Settori')),
    h('div', {}, h('b', {}, info.airports.size), h('small', {}, 'Aeroporti')),
    h('div', {}, h('b', {}, countries.size || '—'), h('small', {}, 'Paesi')),
    h('div', {}, h('b', {}, nf(info.km)), h('small', {}, 'Km'))));
  const detail = h('div', {});
  parts.push(detail);

  const list = [...info.airports.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const showAirport = (code) => {
    selected = code;
    const a = state.data.airports[code];
    const legs = info.routes.filter((r) => r.from === code || r.to === code).sort((a2, b) => b.count - a2.count);
    detail.replaceChildren(h('div', { class: 'card' }, h('h2', {}, `${code}${a?.name ? ` · ${titleCase(a.name.replace(/\s+APT$/i, ''))}` : ''}`),
      h('div', {}, `${info.airports.get(code)} ${info.airports.get(code) === 1 ? 'volo' : 'voli'} (arrivi + partenze)${a?.country ? ` · ${titleCase(a.country)}` : ''}`),
      h('div', { class: 'muted', style: 'margin-top:6px' }, legs.map((r) => `${r.from === code ? r.to : r.from}${r.count > 1 ? ` ×${r.count}` : ''}`).join(' · '))));
  };
  detail.append(h('div', { class: 'card' }, h('h2', {}, 'Aeroporti'), list.map(([code, n]) => h('button', { class: 'ap', onclick: () => showAirport(code) },
    h('b', {}, code), h('span', { class: 'muted' }, ` ${titleCase((state.data.airports[code]?.name ?? '').replace(/\s+APT$/i, ''))}`), h('span', { class: 'cnt' }, n)))));
  if (info.missing.length) detail.append(missingNote(info));

  view.replaceChildren(...parts);
  // la mappa si misura sul contenitore già nella pagina
  const map = createMap(box, { routes: info.routes, airports: info.airports, height: Math.round(Math.min(window.innerHeight * 0.42, 380)), onSelect: showAirport });
  ctl.append(h('button', { onclick: () => map.zoomIn(), 'aria-label': 'Ingrandisci' }, '＋'), h('button', { onclick: () => map.zoomOut(), 'aria-label': 'Riduci' }, '－'), h('button', { onclick: () => map.reset(), 'aria-label': 'Mostra tutto' }, '⤢'));
  box.append(ctl);
  if (selected && info.airports.has(selected)) showAirport(selected);
}

function missingNote(info) {
  return h('p', { class: 'muted', style: 'font-size:13px;margin:8px 4px' }, `Aeroporti senza coordinate (tratte non disegnate): ${info.missing.join(', ')}. Si aggiungono in src/airports-geo.js.`);
}
