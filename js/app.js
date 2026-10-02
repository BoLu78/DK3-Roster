// DK3 Roster - avvio, navigazione e import.
import { h, fmtMonth, todayIso } from './util.js';
import { state, actions, hasData, monthKeys } from './state.js';
import { allImports, addImport } from './db.js';
import { mergeImports, pendingChangeDates } from '../src/merge.js';
import { analyze } from '../src/ftl.js';
import { readRoster, ImportError } from './importer.js';
import { renderList, monthStep } from './views-list.js';
import { renderCalendar } from './views-calendar.js';
import { renderStats } from './views-stats.js';
import { renderRecurrent, alertCount } from './views-recurrent.js';
import { renderMore, showImportSheet, restoreBackup } from './views-more.js';
import { renderMap } from './views-map.js';
import { loadWeather, refreshWeather } from './weather-ui.js';
import { showDetail } from './views-detail.js';

const $ = (id) => document.getElementById(id);
const view = $('view');

const ICONS = {
  list: '<path d="M4 6h16M4 12h16M4 18h10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  cal: '<rect x="3.5" y="5" width="17" height="15" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3.5 10h17M8 3v4M16 3v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  map: '<path d="M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20z M9 4v13.5 M15 6.5V20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/>',
  stats: '<path d="M5 20V11M12 20V4M19 20v-6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
  exp: '<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7v5l3.2 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  more: '<circle cx="5" cy="12" r="1.8" fill="currentColor"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/><circle cx="19" cy="12" r="1.8" fill="currentColor"/>',
};
const TABS = [['list', 'Turni'], ['cal', 'Calendario'], ['map', 'Mappa'], ['stats', 'Statistiche'], ['exp', 'Scadenze'], ['more', 'Altro']];

// ---------------------------------------------------------------- dati
function computeFtl() {
  try {
    state.ftl = analyze([...state.data.days.values()], { base: state.data.pilot?.base ?? 'MXP', airports: state.data.airports, crewByDuty: state.settings.ftlCrew ?? {} });
  } catch (e) {
    console.error('Controllo FTL non riuscito', e);
    state.ftl = null;
  }
}
actions.ftlChanged = (date) => {
  computeFtl();
  if (date) showDetail(date);
  render();
};

async function load() {
  state.imports = await allImports();
  state.data = mergeImports(state.imports);
  state.pending = pendingChangeDates(state.imports);
  computeFtl();
  const keys = monthKeys();
  if (!keys.includes(state.month)) {
    const t = todayIso().slice(0, 7);
    state.month = keys.includes(t) ? t : keys.at(-1) ?? null;
  }
}

// ---------------------------------------------------------------- interfaccia
function renderTabs() {
  const n = alertCount();
  $('tabs').replaceChildren(...TABS.map(([id, label]) => h('button', { 'aria-current': state.tab === id ? 'page' : null, onclick: () => actions.go(id) },
    h('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', html: ICONS[id] }), label, id === 'exp' && n ? h('span', { class: 'badge' }, n) : null)));
}

function renderTop() {
  const top = $('topbar');
  const monthly = ['list', 'cal', 'map', 'stats'].includes(state.tab) && hasData();
  if (monthly) {
    const keys = monthKeys();
    const i = keys.indexOf(state.month);
    top.replaceChildren(
      h('button', { class: 'nav', disabled: i <= 0, onclick: () => { monthStep(-1); render(); }, 'aria-label': 'Mese precedente' }, '‹'),
      h('h1', {}, fmtMonth(state.month)),
      h('button', { class: 'nav', disabled: i >= keys.length - 1, onclick: () => { monthStep(1); render(); }, 'aria-label': 'Mese successivo' }, '›'),
      keys.includes(todayIso().slice(0, 7)) && state.month !== todayIso().slice(0, 7) ? h('button', { class: 'action', onclick: () => { state.month = todayIso().slice(0, 7); render(); } }, 'Oggi') : h('button', { class: 'action', onclick: () => actions.pickPdf(), 'aria-label': 'Importa PDF' }, '＋ PDF'));
  } else {
    top.replaceChildren(h('h1', {}, { exp: 'Scadenze', more: 'Altro' }[state.tab] ?? 'DK3 Roster'));
  }
}

function emptyState() {
  return h('div', { class: 'empty-state' }, h('div', { class: 'ico' }, '✈️'), h('h2', {}, 'DK3 Roster'),
    h('p', {}, 'Importa il PDF “Individual duty plan” esportato da NetLine/Crew. La lettura avviene sul tuo telefono: i turni non vengono inviati da nessuna parte.'),
    h('button', { class: 'btn', onclick: () => actions.pickPdf() }, 'Importa PDF'));
}

function render() {
  renderTabs();
  renderTop();
  const needsData = ['list', 'cal', 'map', 'stats'].includes(state.tab);
  if (needsData && !hasData()) view.replaceChildren(emptyState());
  else if (state.tab === 'list') renderList(view);
  else if (state.tab === 'cal') renderCalendar(view);
  else if (state.tab === 'map') renderMap(view);
  else if (state.tab === 'stats') renderStats(view);
  else if (state.tab === 'exp') renderRecurrent(view);
  else renderMore(view);
}

let toastTimer;
actions.toast = (msg) => {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3200);
};
actions.go = (tab) => {
  actions.closeSheet();
  state.tab = tab;
  render();
  view.scrollTop = 0;
};
actions.openDay = (date) => {
  showDetail(date);
};
actions.closeSheet = () => {
  $('sheet').hidden = true;
  $('sheet').replaceChildren();
};
actions.refresh = async () => {
  await load();
  render();
};
actions.pickPdf = () => $('file').click();

// ---------------------------------------------------------------- import
function busy(msg) {
  const t = $('toast');
  t.replaceChildren(h('span', { class: 'spinner' }), msg);
  t.hidden = false;
}

export async function importBuffer(buffer, fileName) {
  busy('Leggo il PDF…');
  try {
    const { record } = await readRoster(buffer, state.imports, fileName);
    record.id = await addImport(record);
    await load();
    state.month = record.roster.meta.periodStart.slice(0, 7);
    $('toast').hidden = true;
    render();
    showImportSheet(state.imports.find((i) => i.id === record.id), { fresh: true });
  } catch (e) {
    $('toast').hidden = true;
    const msg = e instanceof ImportError ? e.message : `Errore durante l'import: ${e?.message ?? e}`;
    if (!(e instanceof ImportError)) console.error(e);
    alert(msg);
  }
}

$('file').addEventListener('change', async (ev) => {
  const f = ev.target.files?.[0];
  ev.target.value = '';
  if (f) await importBuffer(await f.arrayBuffer(), f.name);
});
$('restore').addEventListener('change', async (ev) => {
  const f = ev.target.files?.[0];
  ev.target.value = '';
  if (!f) return;
  try {
    if (await restoreBackup(f)) {
      await actions.refresh();
      actions.toast('Backup ripristinato');
    }
  } catch (e) {
    alert(e.message ?? String(e));
  }
});
window.addEventListener('popstate', () => actions.closeSheet());
async function updateWeather(force = false) {
  if (await refreshWeather({ force })) {
    const open = !$('sheet').hidden;
    const body = $('sheet').querySelector('.body');
    const top = body?.scrollTop ?? 0;
    render();
    if (open && showDetail.current) {
      showDetail(showDetail.current);
      const b = $('sheet').querySelector('.body');
      if (b) b.scrollTop = top;
    }
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && hasData()) {
    render(); // aggiorna "oggi" e le scadenze
    updateWeather(); // il meteo si riscarica se ha più di 3 ore
  }
});

// ---------------------------------------------------------------- avvio
window.__dk3 = { state, importBuffer, actions };
loadWeather();
try {
  await load();
} catch (e) {
  console.error(e);
  actions.toast('Archivio non disponibile: i dati non verranno salvati');
}
render();
updateWeather();
navigator.storage?.persist?.().catch(() => {});

// in sviluppo (localhost) il service worker è spento, per vedere subito le modifiche; si prova con ?sw
const dev = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && !location.search.includes('sw');
if ('serviceWorker' in navigator && !dev) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service worker non attivo', e));
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) location.reload(); // nuova versione dell'app
  });
}
