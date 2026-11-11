// "Altro": import, cronologia, export .ics, backup, impostazioni.
import { h, fmtDayShort, fmtDayLong, fmtMonth, safeStorage } from './util.js';
import { state, actions, saveSettings, monthKeys, homeTravelMin } from './state.js';
import { checkTotals } from '../src/parser.js';
import { buildIcs } from '../src/ics.js';
import { buildFamilyIcs } from '../src/family.js';
import { deleteImport, clearImports, replaceImports, putImport, allImports } from './db.js';
import { VERSION } from './version.js';
import { refreshWeather, clearWeather } from './weather-ui.js';
import { markAllSeen } from './seen.js';
import { checkForUpdate, forceReload } from './update.js';
import { tr, setLang, locale } from '../src/i18n.js';
import { changeLine } from '../src/diff.js';

const sheet = () => document.getElementById('sheet');

function download(filename, text, type) {
  const blob = new Blob([text], { type });
  const file = new File([blob], filename, { type });
  if (navigator.canShare?.({ files: [file] })) {
    return navigator.share({ files: [file], title: filename }).catch((e) => {
      if (e?.name !== 'AbortError') throw e;
    });
  }
  const a = h('a', { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 2000);
}

// ---- schermata "risultato import" / dettaglio di un import
export function showImportSheet(imp, { fresh = false } = {}) {
  const r = imp.roster;
  const c = checkTotals(r);
  const el = sheet();
  el.hidden = false;
  const mark = (ok) => (ok == null ? '' : ok ? h('span', { class: 'ok' }, ' ✓') : h('span', { class: 'bad' }, tr(' ≠ diverso dal PDF', ' ≠ differs from PDF')));
  const ch = imp.changes;
  const group = (title, list) => list?.length
    ? h('div', { class: 'card' }, h('h2', {}, `${title} (${list.length})`), list.map((x) => h('button', { class: 'row', style: 'display:block;width:100%;text-align:left;padding:8px 0;border-top:1px solid var(--sep)', onclick: () => actions.openDay(x.date) }, h('b', {}, fmtDayLong(x.date)), h('ul', { style: 'margin:2px 0 0 18px;padding:0' }, x.lines.map((l) => h('li', { class: 'muted' }, changeLine(l)))))))
    : null;
  el.replaceChildren(
    h('header', {}, h('button', { onclick: () => { actions.closeSheet(); }, 'aria-label': tr('Chiudi', 'Close') }, tr('‹ Indietro', '‹ Back')), h('h1', {}, fresh ? tr('Import completato', 'Import complete') : 'Import'), h('span', { style: 'min-width:44px' })),
    h('div', { class: 'body' },
      h('div', { class: 'card' }, h('h2', {}, 'PDF'),
        h('div', {}, h('b', {}, `${fmtDayShort(r.meta.periodStart)} – ${fmtDayShort(r.meta.periodEnd)} ${r.meta.periodEnd.slice(0, 4)}`)),
        h('div', { class: 'muted' }, `${tr('Stampato', 'Printed')} ${r.meta.printedAt?.replace('T', ' ') ?? '—'} · ${tr('importato', 'imported')} ${imp.importedAt.slice(0, 16).replace('T', ' ')}`),
        h('div', { style: 'margin-top:8px' },
          h('div', { class: 'cmp' }, h('span', {}, 'FT'), h('span', {}, `${c.computed.ft} (PDF ${c.printed.ft ?? '—'})`, mark(c.ftOk))),
          h('div', { class: 'cmp' }, h('span', {}, 'DT'), h('span', {}, `${c.computed.dt} (PDF ${c.printed.dt ?? '—'})`, mark(c.dtOk))),
          h('div', { class: 'cmp' }, h('span', {}, tr('Giorni Off', 'Days off')), h('span', {}, `${c.computed.offDays} (PDF ${c.printed.offDays ?? '—'})`, mark(c.offOk)))),
        r.warnings?.length ? h('div', { class: 'bad', style: 'margin-top:8px' }, r.warnings.join(' · ')) : null),
      ch ? [h('div', { class: 'card changes' }, h('h2', {}, tr('Cosa è cambiato rispetto alla versione precedente', 'What changed since the previous version')), h('div', {}, tr(`${ch.count} giorn${ch.count === 1 ? 'o' : 'i'}: ${ch.added.length} aggiunt${ch.added.length === 1 ? 'o' : 'i'}, ${ch.removed.length} tolt${ch.removed.length === 1 ? 'o' : 'i'}, ${ch.changed.length} modificat${ch.changed.length === 1 ? 'o' : 'i'}`, `${ch.count} day${ch.count === 1 ? '' : 's'}: ${ch.added.length} added, ${ch.removed.length} removed, ${ch.changed.length} changed`))), group(tr('Aggiunti', 'Added'), ch.added), group(tr('Tolti', 'Removed'), ch.removed), group(tr('Modificati', 'Changed'), ch.changed),
        imp.seen && !state.pending.size ? null : h('button', { class: 'btn secondary', onclick: async () => { await markAllSeen(); await actions.refresh(); actions.toast(tr('Pallini tolti', 'Markers cleared')); showImportSheet(state.imports.find((i) => i.id === imp.id) ?? imp); } }, tr('Segna tutte come viste (toglie i pallini)', 'Mark all as seen (clears markers)'))]
        : h('div', { class: 'card' }, h('h2', {}, tr('Modifiche', 'Changes')), h('div', { class: 'muted' }, state.imports.length > 1 ? tr('Nessuna modifica rispetto alla versione precedente.', 'No changes since the previous version.') : tr('Primo import di questo periodo: niente da confrontare.', 'First import for this period: nothing to compare.'))),
      h('button', { class: 'btn', onclick: () => actions.closeSheet() }, fresh ? tr('Fine', 'Done') : tr('Chiudi', 'Close')),
      fresh ? null : h('button', { class: 'btn danger', onclick: async () => { if (confirm(tr('Eliminare questo import? I giorni tornano alla versione precedente.', 'Delete this import? The days go back to the previous version.'))) { await deleteImport(imp.id); actions.closeSheet(); await actions.refresh(); actions.toast(tr('Import eliminato', 'Import deleted')); } } }, tr('Elimina questo import', 'Delete this import'))));
}

// Hub della compagnia: partendo da qui la Cpt Discretion è da evitare (OMA 7.2.1)
const HUB_DEFAULT = ['MXP', 'VRN', 'FCO'];
function hubsCard(s) {
  const hubs = new Set(s.hubs ?? HUB_DEFAULT);
  const extra = [...hubs].filter((x) => !HUB_DEFAULT.includes(x));
  const save = (list) => {
    s.hubs = [...new Set(list)];
    saveSettings();
    actions.ftlChanged();
  };
  const boxes = HUB_DEFAULT.map((code) => {
    const cb = h('input', { type: 'checkbox', checked: hubs.has(code) });
    cb.addEventListener('change', () => save([...HUB_DEFAULT.filter((c) => c === code ? cb.checked : hubs.has(c)), ...extra]));
    return h('label', { class: 'field' }, h('span', {}, { MXP: 'MXP Malpensa', VRN: 'VRN Verona', FCO: 'FCO Fiumicino' }[code]), cb);
  });
  const other = h('input', { type: 'text', value: extra.join(', '), placeholder: tr('es. NAP', 'e.g. NAP'), autocapitalize: 'characters', style: 'width:8em' });
  other.addEventListener('change', () => {
    const list = other.value.toUpperCase().split(/[^A-Z]+/).filter((x) => /^[A-Z]{3}$/.test(x));
    save([...HUB_DEFAULT.filter((c) => hubs.has(c)), ...list]);
  });
  return h('div', { class: 'card' }, h('h2', {}, 'Hub (Cpt Discretion)'), boxes,
    h('label', { class: 'field' }, h('span', {}, tr('Altri hub', 'Other hubs')), other),
    h('p', { class: 'muted', style: 'font-size:13px;margin-top:8px' }, tr('Se il primo volo parte da un hub, nel riquadro FDP la Cpt Discretion compare con l’avviso “da evitare”: lì ci sono riserve e stand-by (OMA 7.2.1).', 'If the first flight departs from a hub, the FDP box shows Cpt Discretion with a “to be avoided” warning: reserve and standby crew are available there (OM-A 7.2.1).')));
}

// ---- export .ics: ricordo degli eventi già esportati (per aggiornarli e annullare quelli spariti)
const icsStore = safeStorage();
const icsKey = (format) => `dk3-ics-${format}`;
function loadExported(format) {
  try {
    return JSON.parse(icsStore.getItem(icsKey(format)) ?? '{}');
  } catch {
    return {};
  }
}
function saveExported(format, emitted) {
  try {
    icsStore.setItem(icsKey(format), JSON.stringify(emitted));
  } catch {
    // memoria piena o non disponibile: il prossimo export non potrà annullare i servizi spariti
  }
}
// versione del roster esportato: l'import più recente che copre il periodo
function rosterVersion(from, to) {
  const imps = state.imports.filter((i) => (!to || i.roster.meta.periodStart <= to) && (!from || i.roster.meta.periodEnd >= from));
  const p = imps.map((i) => i.roster.meta.printedAt).filter(Boolean).sort().at(-1);
  if (!p) return null;
  const [d, t] = p.split('T');
  return { text: tr(`Roster stampato il ${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)} alle ${t?.slice(0, 5) ?? ''}`, `Roster printed on ${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)} at ${t?.slice(0, 5) ?? ''}`), tag: `${d.slice(8, 10)}${d.slice(5, 7)}-${(t ?? '').slice(0, 5).replace(':', '')}` };
}

// ---- schermata Altro
export function renderMore(view) {
  const imports = [...state.imports].sort((a, b) => b.importedAt.localeCompare(a.importedAt));
  const s = state.settings;
  const parts = [];

  // lingua dell'app
  const en = h('input', { type: 'checkbox', checked: s.lang === 'en' });
  en.addEventListener('change', () => {
    s.lang = en.checked ? 'en' : 'it';
    saveSettings();
    setLang(s.lang);
    actions.ftlChanged(); // le note FTL si riscrivono nella nuova lingua, poi si ridisegna tutto
  });
  parts.push(h('div', { class: 'card' }, h('h2', {}, 'Lingua / Language'),
    h('label', { class: 'field' }, h('span', {}, 'App in inglese / English'), en),
    h('p', { class: 'muted', style: 'font-size:13px;margin-top:8px' }, tr('Menu, pulsanti, note FTL ed export del calendario in inglese. I testi del PDF (hotel, note) restano come sono.', 'Menus, buttons, FTL notes and calendar export in English. Text from the PDF (hotels, remarks) stays as it is.'))));

  parts.push(h('div', { class: 'card' }, h('h2', {}, tr('Importa', 'Import')),
    h('button', { class: 'btn', onclick: () => actions.pickPdf() }, tr('Importa PDF dei turni', 'Import roster PDF')),
    h('p', { class: 'muted', style: 'font-size:13px;margin-top:8px' }, tr('Scegli il file “Individual duty plan” da File o Mail. Il PDF viene letto sul telefono e non viene inviato da nessuna parte.', 'Choose the “Individual duty plan” file from Files or Mail. The PDF is read on the phone and never sent anywhere.'))));

  if (state.pending.size) {
    parts.push(h('div', { class: 'card' }, h('h2', {}, tr('Modifiche da vedere', 'Changes to review')),
      h('div', {}, tr(`${state.pending.size} giorn${state.pending.size === 1 ? 'o ha' : 'i hanno'} il pallino delle modifiche.`, `${state.pending.size} day${state.pending.size === 1 ? ' has' : 's have'} a change marker.`)),
      h('button', { class: 'btn secondary', style: 'margin-top:8px', onclick: async () => { await markAllSeen(); await actions.refresh(); actions.toast(tr('Pallini tolti', 'Markers cleared')); } }, tr('Togli tutti i pallini', 'Clear all markers'))));
  }
  if (imports.length) {
    // si vedono gli ultimi 2 import; gli altri restano salvati (contengono i mesi precedenti)
    const shown = view.allImports ? imports : imports.slice(0, 2);
    parts.push(h('div', { class: 'card list' }, h('h2', {}, tr('Cronologia import', 'Import history')), shown.map((imp) => {
      const r = imp.roster;
      return h('button', { onclick: () => showImportSheet(imp) },
        h('span', {}, h('b', {}, `${fmtDayShort(r.meta.periodStart)} – ${fmtDayShort(r.meta.periodEnd)}`), h('div', { class: 'muted', style: 'font-size:13px' }, `${tr('Stampato', 'Printed')} ${r.meta.printedAt?.replace('T', ' ') ?? '—'}${imp.changes ? ` · ${imp.changes.count} ${tr('modifiche', 'changes')}${imp.seen ? '' : ' 🔄'}` : ''}`)),
        h('span', { class: 'chev' }, '›'));
    }), imports.length > 2 ? h('button', { class: 'more-link', onclick: () => { view.allImports = !view.allImports; actions.refresh(); } }, view.allImports ? tr('Mostra solo gli ultimi 2', 'Show only the last 2') : tr(`Mostra tutti (${imports.length})`, `Show all (${imports.length})`)) : null));
  }

  // export .ics (un'unica scheda: formato completo oppure semplice per la famiglia)
  const keys = monthKeys();
  if (keys.length) {
    const format = h('select', {}, h('option', { value: 'full', selected: s.icsFormat !== 'family' }, tr('Completo (con i dettagli del servizio)', 'Full (with duty details)')), h('option', { value: 'family', selected: s.icsFormat === 'family' }, tr('Famiglia (casa, rotta, notti)', 'Family (home, route, nights)')));
    const scope = h('select', {}, h('option', { value: 'all', selected: s.icsScope === 'all' }, tr('Voli, trasferimenti, sim, stand-by', 'Flights, positioning, sim, standby')), h('option', { value: 'flights', selected: s.icsScope === 'flights' }, tr('Solo voli', 'Flights only')));
    const month = h('select', {}, h('option', { value: '' }, tr('Tutti i mesi', 'All months')), keys.map((k) => h('option', { value: k, selected: k === state.month }, fmtMonth(k))));
    const alarm = h('select', {}, [[0, tr('Nessuno', 'None')], [60, tr('1 ora prima', '1 hour before')], [120, tr('2 ore prima', '2 hours before')], [180, tr('3 ore prima', '3 hours before')], [720, tr('12 ore prima', '12 hours before')]].map(([v, l]) => h('option', { value: v, selected: s.icsAlarm === v }, l)));
    const fnum = h('input', { type: 'checkbox', checked: s.familyFlightNumbers });
    const rowScope = h('label', { class: 'field' }, h('span', {}, tr('Cosa', 'What')), scope);
    const rowAlarm = h('label', { class: 'field' }, h('span', {}, tr('Promemoria', 'Reminder')), alarm);
    const rowNum = h('label', { class: 'field' }, h('span', {}, tr('Mostra i numeri di volo', 'Show flight numbers')), fnum);
    const note = h('p', { class: 'muted', style: 'font-size:13px;margin-top:8px' });
    const sync = () => {
      const fam = format.value === 'family';
      rowScope.hidden = rowAlarm.hidden = fam;
      rowNum.hidden = !fam;
      note.textContent = fam
        ? tr('Per chi vive con te: “🏠 A casa” nei giorni liberi, “✈ MXP → FUE → MXP” con gli orari, “🛏 Notte a …” fuori casa. Nessun dato di lavoro.', 'For the people you live with: “🏠 Home” on days off, “✈ MXP → FUE → MXP” with times, “🛏 Night in …” away. No work data.')
        : tr('Gli eventi vanno dal check-in al check-out in orario UTC: il Calendario li mostra nell’ora locale del telefono. Nelle note ci sono orari UTC e locali, FT, DT e hotel.', 'Events run from check-in to check-out in UTC: Calendar shows them in the phone’s local time. Notes include UTC and local times, FT, DT and hotel.');
    };
    format.addEventListener('change', sync);
    sync();
    parts.push(h('div', { class: 'card' }, h('h2', {}, tr('Esporta nel Calendario (.ics)', 'Export to Calendar (.ics)')),
      h('label', { class: 'field' }, h('span', {}, tr('Formato', 'Format')), format), rowScope, h('label', { class: 'field' }, h('span', {}, tr('Periodo', 'Period')), month), rowAlarm, rowNum,
      h('button', { class: 'btn', onclick: () => {
        s.icsFormat = format.value;
        s.icsScope = scope.value;
        s.icsAlarm = Number(alarm.value);
        s.familyFlightNumbers = fnum.checked;
        saveSettings();
        const m = month.value;
        const days = [...state.data.days.values()].sort((a, b) => a.date.localeCompare(b.date));
        const range = { from: m ? `${m}-01` : null, to: m ? `${m}-31` : null };
        const fam = format.value === 'family';
        const ver = rosterVersion(range.from, range.to);
        const common = { ...range, version: ver?.text ?? '', previous: loadExported(format.value) };
        const { text, count, emitted, cancelled } = fam
          ? buildFamilyIcs(days, state.data.airports, { base: state.data.pilot?.base ?? 'MXP', ...common, flightNumbers: fnum.checked })
          : buildIcs(days, state.data.airports, { scope: scope.value, ...common, alarmMinutes: Number(alarm.value) });
        if (!count && !cancelled) return actions.toast(tr('Niente da esportare', 'Nothing to export'));
        download(`${fam ? tr('Turni-famiglia', 'Roster-family') : 'DK3-Roster'}${m ? '-' + m : ''}${ver ? tr('-stampato-', '-printed-') + ver.tag : ''}.ics`, text, 'text/calendar');
        saveExported(format.value, emitted);
        actions.toast(tr(`${count} eventi pronti${cancelled ? ` · ${cancelled} annullat${cancelled === 1 ? 'o' : 'i'}` : ''}`, `${count} events ready${cancelled ? ` · ${cancelled} cancelled` : ''}`));
      } }, tr('Esporta .ics', 'Export .ics')),
      note,
      h('p', { class: 'muted', style: 'font-size:13px' }, tr('Per metterlo nel Calendario: scegli “Mail” e invia il file a te stesso, apri l’allegato e tocca “Aggiungi tutti” scegliendo il calendario.', 'To add it to Calendar: choose “Mail” and send the file to yourself, open the attachment and tap “Add All”, choosing the calendar.')),
      h('details', { class: 'howto' }, h('summary', {}, tr('Aggiornare il calendario senza doppioni', 'Updating the calendar without duplicates')),
        h('p', {}, tr('Un file .ics può aggiungere e aggiornare eventi, ma il Calendario non cancella mai da solo quelli vecchi. Il modo sicuro al 100% è un calendario dedicato ai turni, da rifare a ogni nuova versione:', 'An .ics file can add and update events, but Calendar never deletes old ones by itself. The 100% safe way is a calendar dedicated to the roster, recreated for every new version:')),
        h('ol', {},
          h('li', {}, h('b', {}, tr('La prima volta: ', 'The first time: ')), tr('crea un calendario nuovo solo per i turni (es. “Turni Luca”) e importa il file lì dentro.', 'create a new calendar just for the roster (e.g. “Luca roster”) and import the file into it.')),
          h('li', {}, h('b', {}, tr('A ogni nuova versione: ', 'For every new version: ')), tr('cancella quel calendario (sparisce tutto il vecchio in un colpo), creane uno con lo stesso nome e importa il file nuovo.', 'delete that calendar (everything old disappears at once), create one with the same name and import the new file.'))),
        h('p', {}, h('b', {}, 'iPhone: '), tr('Calendario → Calendari → “Aggiungi calendario”; per cancellarlo: tocca la “i” accanto al nome → “Elimina calendario”. Aprendo il file .ics scegli quel calendario prima di “Aggiungi tutti”.', 'Calendar → Calendars → “Add Calendar”; to delete it: tap the “i” next to its name → “Delete Calendar”. When opening the .ics file, choose that calendar before “Add All”.')),
        h('p', {}, h('b', {}, tr('Google Calendar (dal computer): ', 'Google Calendar (on a computer): ')), tr('Impostazioni → “Aggiungi calendario” → “Crea nuovo calendario”; poi “Importa ed esporta” → scegli il file e il calendario dei turni. Per cancellarlo: Impostazioni del calendario → “Elimina”.', 'Settings → “Add calendar” → “Create new calendar”; then “Import & export” → choose the file and the roster calendar. To delete it: calendar settings → “Delete”.')),
        h('p', {}, tr('Se non lo rifai, l’app aiuta comunque: ogni giorno ha il suo evento fisso (un giorno diventato libero diventa “OFF”), i servizi spariti arrivano come “Annullato” e in ogni evento c’è la data di stampa del roster. Apple Calendar di solito aggiorna gli eventi; Google spesso tiene la versione vecchia: lì serve il calendario dedicato.', 'If you don’t recreate it, the app still helps: every day has its own fixed event (a day that becomes free turns into “OFF”), removed duties arrive as “Cancelled” and every event shows the roster print date. Apple Calendar usually updates events; Google often keeps the old version: there the dedicated calendar is needed.')))));
  }

  // partenza da casa
  const travel = h('input', { type: 'number', min: 0, max: 600, step: 5, value: homeTravelMin(), inputmode: 'numeric' });
  travel.addEventListener('change', () => {
    s.homeTravelMin = Math.min(600, Math.max(0, Math.round(Number(travel.value) || 0)));
    saveSettings();
    actions.refresh();
  });
  parts.push(h('div', { class: 'card' }, h('h2', {}, tr('Partenza da casa', 'Leaving home')),
    h('label', { class: 'field' }, h('span', {}, tr('Minuti prima della presentazione', 'Minutes before reporting')), travel),
    h('p', { class: 'muted', style: 'font-size:13px' }, tr('Quando ti presenti alla base, l’app mostra a che ora partire da casa (presentazione meno questi minuti). Cambia il valore se cambi casa.', 'When you report at base, the app shows when to leave home (reporting time minus these minutes). Change the value if you move house.'))));

  // meteo (opzionale)
  const wx = h('input', { type: 'checkbox', checked: s.weatherOn });
  wx.addEventListener('change', async () => {
    s.weatherOn = wx.checked;
    saveSettings();
    if (wx.checked) {
      actions.toast(tr('Scarico il meteo…', 'Downloading weather…'));
      await refreshWeather({ force: true });
    } else clearWeather();
    actions.refresh();
  });
  const wAt = state.weather?.at;
  parts.push(h('div', { class: 'card' }, h('h2', {}, tr('Meteo', 'Weather')),
    h('label', { class: 'field' }, h('span', {}, tr('Mostra il meteo (usa internet)', 'Show weather (uses internet)')), wx),
    s.weatherOn ? h('div', { class: 'muted', style: 'font-size:13px' }, wAt ? `${tr('Ultimo aggiornamento', 'Last update')}: ${new Date(wAt).toLocaleString(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : tr('Ancora nessun aggiornamento.', 'No update yet.')) : null,
    state.weather?.error ? h('div', { class: 'bad', style: 'font-size:13px' }, state.weather.error) : null,
    s.weatherOn ? h('button', { class: 'btn secondary', style: 'margin-top:8px', onclick: async () => { actions.toast(tr('Aggiorno il meteo…', 'Updating weather…')); await refreshWeather({ force: true }); actions.refresh(); } }, tr('Aggiorna ora', 'Update now')) : null,
    h('p', { class: 'muted', style: 'font-size:13px;margin-top:8px' }, tr('Spento di default. Se acceso, l’app chiede a Open-Meteo (gratuito, senza account) la previsione per i luoghi dei tuoi servizi dei prossimi 15 giorni. Nella richiesta ci sono solo le coordinate degli aeroporti e le date: nessun dato del roster. Non sostituisce METAR e TAF.', 'Off by default. When on, the app asks Open-Meteo (free, no account) for the forecast at your duty locations for the next 15 days. The request contains only airport coordinates and dates: no roster data. It does not replace METAR and TAF.'))));

  // soglie scadenze
  const warn = h('input', { type: 'number', min: 1, max: 365, value: s.warn, inputmode: 'numeric' });
  const crit = h('input', { type: 'number', min: 1, max: 365, value: s.critical, inputmode: 'numeric' });
  const inc = h('input', { type: 'checkbox', checked: s.include787 });
  const apply = () => {
    s.warn = Math.max(1, Number(warn.value) || 90);
    s.critical = Math.min(s.warn, Math.max(1, Number(crit.value) || 30));
    s.include787 = inc.checked;
    saveSettings();
    actions.refresh();
  };
  [warn, crit, inc].forEach((e) => e.addEventListener('change', apply));
  parts.push(hubsCard(s));
  parts.push(h('div', { class: 'card' }, h('h2', {}, tr('Avvisi scadenze', 'Expiry alerts')),
    h('label', { class: 'field' }, h('span', {}, tr('Avviso (giorni prima)', 'Warning (days before)')), warn), h('label', { class: 'field' }, h('span', {}, tr('Urgente (giorni prima)', 'Urgent (days before)')), crit),
    h('label', { class: 'field' }, h('span', {}, tr('Conta anche le scadenze B787', 'Also count B787 expiries')), inc)));

  // backup
  parts.push(h('div', { class: 'card' }, h('h2', {}, 'Backup'),
    h('button', { class: 'btn secondary', disabled: !imports.length, onclick: async () => {
      const list = await allImports();
      download(`DK3-Roster-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ app: 'dk3-roster', version: 1, exportedAt: new Date().toISOString(), imports: list }), 'application/json');
    } }, tr('Salva backup dei dati', 'Save data backup')),
    h('button', { class: 'btn secondary', onclick: () => document.getElementById('restore').click() }, tr('Ripristina da backup', 'Restore from backup')),
    h('p', { class: 'muted', style: 'font-size:13px;margin-top:8px' }, tr('Il backup contiene i tuoi turni: tienilo solo su dispositivi tuoi (iCloud Drive, File).', 'The backup contains your roster: keep it only on your own devices (iCloud Drive, Files).'))));

  parts.push(h('div', { class: 'card' }, h('h2', {}, tr('Informazioni', 'About')),
    h('div', { class: 'cmp' }, h('span', {}, tr('Versione', 'Version')), h('b', {}, VERSION)),
    h('button', { class: 'btn secondary', style: 'margin-top:10px', onclick: async () => {
      actions.toast(tr('Cerco aggiornamenti…', 'Checking for updates…'));
      try {
        const r = await checkForUpdate();
        if (r === 'current') actions.toast(tr(`L’app è già aggiornata (versione ${VERSION})`, `The app is up to date (version ${VERSION})`));
        else if (r === 'dev') actions.toast(tr('In prova locale non ci sono aggiornamenti', 'No updates in local testing'));
        else if (r === 'unsupported') alert(tr('Questo dispositivo non supporta l’aggiornamento automatico. Chiudi e riapri l’app due volte.', 'This device does not support automatic updates. Close and reopen the app twice.'));
        else actions.toast(tr('Aggiornamento installato…', 'Update installed…'));
      } catch (e) {
        alert(tr(`Non riesco a controllare gli aggiornamenti: ${e.message ?? e}`, `Cannot check for updates: ${e.message ?? e}`));
      }
    } }, tr('Cerca aggiornamenti', 'Check for updates')),
    h('button', { class: 'btn secondary', onclick: async () => {
      if (!confirm(tr('Riscaricare l’app da zero? I tuoi turni e le impostazioni restano. Serve internet.', 'Download the app again from scratch? Your roster and settings are kept. Internet is needed.'))) return;
      try {
        await forceReload();
      } catch (e) {
        alert(e.message ?? String(e));
      }
    } }, tr('Forza il riscaricamento dell’app', 'Force app re-download')),
    imports.length ? h('button', { class: 'btn danger', style: 'margin-top:10px', onclick: async () => { if (confirm(tr('Cancellare TUTTI i turni salvati su questo dispositivo?', 'Delete ALL rosters saved on this device?'))) { await clearImports(); await actions.refresh(); actions.toast(tr('Dati cancellati', 'Data deleted')); } } }, tr('Cancella tutti i dati', 'Delete all data')) : null));
  view.replaceChildren(...parts);
}

export async function restoreBackup(file) {
  const data = JSON.parse(await file.text());
  if (data.app !== 'dk3-roster' || !Array.isArray(data.imports)) throw new Error(tr('Questo file non è un backup di DK3 Roster.', 'This file is not a DK3 Roster backup.'));
  if (!confirm(tr(`Ripristinare il backup (${data.imports.length} import)? I dati attuali verranno sostituiti.`, `Restore the backup (${data.imports.length} imports)? Current data will be replaced.`))) return false;
  await replaceImports(data.imports.map(({ id, ...rest }) => rest));
  return true;
}
