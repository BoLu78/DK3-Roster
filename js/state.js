// Stato condiviso dell'app e collegamenti tra le schermate.
import { safeStorage } from './util.js';
import { DEFAULT_THRESHOLDS } from '../src/recurrent.js';

const storage = safeStorage();
const SETTINGS_KEY = 'dk3-settings';

export const state = {
  imports: [],
  data: { days: new Map(), airports: {}, periods: [], recurrent: [], pilot: null },
  pending: new Map(), // date -> modifica non ancora vista
  tails: new Map(), // data locale -> fine di servizi iniziati il giorno prima
  ftl: null, // risultato del controllo FTL (src/ftl.js)
  weather: { cache: {}, at: 0, error: null, busy: false }, // previsioni salvate sul telefono
  tab: 'list',
  month: null,
  settings: loadSettings(),
};

// Le schermate chiamano queste funzioni; app.js le collega.
export const actions = { ftlChanged() {}, go() {}, openDay() {}, closeSheet() {}, refresh() {}, toast() {}, pickPdf() {}, showImportResult() {} };

function loadSettings() {
  const base = { warn: DEFAULT_THRESHOLDS.warn, critical: DEFAULT_THRESHOLDS.critical, include787: false, icsScope: 'all', icsAlarm: 0, statsUntil: 'auto', ftlCrew: {}, homeTravelMin: 90, weatherOn: false, briefingOn: false, familyFlightNumbers: true, icsFormat: 'full' };
  try {
    return { ...base, ...JSON.parse(storage.getItem(SETTINGS_KEY) ?? '{}') };
  } catch {
    return base;
  }
}

export function saveSettings() {
  storage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
}

export const hasData = () => state.data.days.size > 0;
export const monthDays = (key) => [...state.data.days.values()].filter((d) => d.date.startsWith(key)).sort((a, b) => a.date.localeCompare(b.date));
export const monthKeys = () => [...new Set([...state.data.days.keys()].map((d) => d.slice(0, 7)))].sort();

// minuti tra la partenza da casa e la presentazione (impostabile in Altro)
export const homeTravelMin = () => {
  const n = Number(state.settings.homeTravelMin);
  return Number.isFinite(n) && n >= 0 && n <= 600 ? Math.round(n) : 90;
};
