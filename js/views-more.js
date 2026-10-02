// "Altro": import, cronologia, export .ics, backup, impostazioni.
import { h, fmtDayShort, fmtDayLong, fmtMonth, titleCase } from './util.js';
import { state, actions, saveSettings, monthKeys } from './state.js';
import { checkTotals } from '../src/parser.js';
import { buildIcs } from '../src/ics.js';
import { deleteImport, clearImports, replaceImports, putImport, allImports } from './db.js';
import { VERSION } from './version.js';

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
  const mark = (ok) => (ok == null ? '' : ok ? h('span', { class: 'ok' }, ' ✓') : h('span', { class: 'bad' }, ' ≠ diverso dal PDF'));
  const ch = imp.changes;
  const group = (title, list) => list?.length
    ? h('div', { class: 'card' }, h('h2', {}, `${title} (${list.length})`), list.map((x) => h('button', { class: 'row', style: 'display:block;width:100%;text-align:left;padding:8px 0;border-top:1px solid var(--sep)', onclick: () => actions.openDay(x.date) }, h('b', {}, fmtDayLong(x.date)), h('ul', { style: 'margin:2px 0 0 18px;padding:0' }, x.lines.map((l) => h('li', { class: 'muted' }, l))))))
    : null;
  el.replaceChildren(
    h('header', {}, h('button', { onclick: () => { actions.closeSheet(); }, 'aria-label': 'Chiudi' }, '‹ Indietro'), h('h1', {}, fresh ? 'Import completato' : 'Import'), h('span', { style: 'min-width:44px' })),
    h('div', { class: 'body' },
      h('div', { class: 'card' }, h('h2', {}, 'PDF'),
        h('div', {}, h('b', {}, `${fmtDayShort(r.meta.periodStart)} – ${fmtDayShort(r.meta.periodEnd)} ${r.meta.periodEnd.slice(0, 4)}`)),
        h('div', { class: 'muted' }, `Stampato ${r.meta.printedAt?.replace('T', ' ') ?? '—'} · importato ${imp.importedAt.slice(0, 16).replace('T', ' ')}`),
        h('div', { style: 'margin-top:8px' },
          h('div', { class: 'cmp' }, h('span', {}, 'FT'), h('span', {}, `${c.computed.ft} (PDF ${c.printed.ft ?? '—'})`, mark(c.ftOk))),
          h('div', { class: 'cmp' }, h('span', {}, 'DT'), h('span', {}, `${c.computed.dt} (PDF ${c.printed.dt ?? '—'})`, mark(c.dtOk))),
          h('div', { class: 'cmp' }, h('span', {}, 'Giorni Off'), h('span', {}, `${c.computed.offDays} (PDF ${c.printed.offDays ?? '—'})`, mark(c.offOk)))),
        r.warnings?.length ? h('div', { class: 'bad', style: 'margin-top:8px' }, r.warnings.join(' · ')) : null),
      ch ? [h('div', { class: 'card changes' }, h('h2', {}, 'Cosa è cambiato rispetto alla versione precedente'), h('div', {}, `${ch.count} giorn${ch.count === 1 ? 'o' : 'i'}: ${ch.added.length} aggiunt${ch.added.length === 1 ? 'o' : 'i'}, ${ch.removed.length} tolt${ch.removed.length === 1 ? 'o' : 'i'}, ${ch.changed.length} modificat${ch.changed.length === 1 ? 'o' : 'i'}`)), group('Aggiunti', ch.added), group('Tolti', ch.removed), group('Modificati', ch.changed),
        imp.seen ? null : h('button', { class: 'btn secondary', onclick: async () => { imp.seen = true; await putImport(imp); await actions.refresh(); actions.toast('Modifiche segnate come viste'); } }, 'Segna come viste (toglie i pallini)')]
        : h('div', { class: 'card' }, h('h2', {}, 'Modifiche'), h('div', { class: 'muted' }, state.imports.length > 1 ? 'Nessuna modifica rispetto alla versione precedente.' : 'Primo import di questo periodo: niente da confrontare.')),
      h('button', { class: 'btn', onclick: () => actions.closeSheet() }, fresh ? 'Fine' : 'Chiudi'),
      fresh ? null : h('button', { class: 'btn danger', onclick: async () => { if (confirm('Eliminare questo import? I giorni tornano alla versione precedente.')) { await deleteImport(imp.id); actions.closeSheet(); await actions.refresh(); actions.toast('Import eliminato'); } } }, 'Elimina questo import')));
}

// ---- schermata Altro
export function renderMore(view) {
  const imports = [...state.imports].sort((a, b) => b.importedAt.localeCompare(a.importedAt));
  const s = state.settings;
  const parts = [];

  parts.push(h('div', { class: 'card' }, h('h2', {}, 'Importa'),
    h('button', { class: 'btn', onclick: () => actions.pickPdf() }, 'Importa PDF dei turni'),
    h('p', { class: 'muted', style: 'font-size:13px;margin-top:8px' }, 'Scegli il file “Individual duty plan” da File o Mail. Il PDF viene letto sul telefono e non viene inviato da nessuna parte.')));

  if (imports.length) {
    parts.push(h('div', { class: 'card list' }, h('h2', {}, 'Cronologia import'), imports.map((imp) => {
      const r = imp.roster;
      return h('button', { onclick: () => showImportSheet(imp) },
        h('span', {}, h('b', {}, `${fmtDayShort(r.meta.periodStart)} – ${fmtDayShort(r.meta.periodEnd)}`), h('div', { class: 'muted', style: 'font-size:13px' }, `Stampato ${r.meta.printedAt?.replace('T', ' ') ?? '—'}${imp.changes ? ` · ${imp.changes.count} modifiche${imp.seen ? '' : ' 🔄'}` : ''}`)),
        h('span', { class: 'chev' }, '›'));
    })));
  }

  // export .ics
  const keys = monthKeys();
  if (keys.length) {
    const scope = h('select', { id: 'ics-scope' }, h('option', { value: 'all', selected: s.icsScope === 'all' }, 'Voli, trasferimenti, sim, stand-by'), h('option', { value: 'flights', selected: s.icsScope === 'flights' }, 'Solo voli'));
    const month = h('select', { id: 'ics-month' }, h('option', { value: '' }, 'Tutti i mesi'), keys.map((k) => h('option', { value: k, selected: k === state.month }, fmtMonth(k))));
    const alarm = h('select', { id: 'ics-alarm' }, [[0, 'Nessuno'], [60, '1 ora prima'], [120, '2 ore prima'], [180, '3 ore prima'], [720, '12 ore prima']].map(([v, l]) => h('option', { value: v, selected: s.icsAlarm === v }, l)));
    parts.push(h('div', { class: 'card' }, h('h2', {}, 'Esporta nel Calendario (.ics)'),
      h('label', { class: 'field' }, h('span', {}, 'Cosa'), scope), h('label', { class: 'field' }, h('span', {}, 'Periodo'), month), h('label', { class: 'field' }, h('span', {}, 'Promemoria'), alarm),
      h('button', { class: 'btn', onclick: () => {
        s.icsScope = scope.value;
        s.icsAlarm = Number(alarm.value);
        saveSettings();
        const m = month.value;
        const days = [...state.data.days.values()].sort((a, b) => a.date.localeCompare(b.date));
        const { text, count } = buildIcs(days, state.data.airports, { scope: scope.value, from: m ? `${m}-01` : null, to: m ? `${m}-31` : null, alarmMinutes: Number(alarm.value) });
        if (!count) return actions.toast('Nessun servizio da esportare');
        download(`DK3-Roster${m ? '-' + m : ''}.ics`, text, 'text/calendar');
        actions.toast(`${count} eventi pronti`);
      } }, 'Esporta .ics'),
      h('p', { class: 'muted', style: 'font-size:13px;margin-top:8px' }, 'Gli eventi vanno da C/I a C/O in orario UTC: il Calendario li mostra nell’ora locale del telefono. L’elenco dei dettagli (orari UTC e locali, FT, DT, hotel) è nelle note.')));
  }

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
  parts.push(h('div', { class: 'card' }, h('h2', {}, 'Avvisi scadenze'),
    h('label', { class: 'field' }, h('span', {}, 'Avviso (giorni prima)'), warn), h('label', { class: 'field' }, h('span', {}, 'Urgente (giorni prima)'), crit),
    h('label', { class: 'field' }, h('span', {}, 'Conta anche le scadenze B787'), inc)));

  // backup
  parts.push(h('div', { class: 'card' }, h('h2', {}, 'Backup'),
    h('button', { class: 'btn secondary', disabled: !imports.length, onclick: async () => {
      const list = await allImports();
      download(`DK3-Roster-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ app: 'dk3-roster', version: 1, exportedAt: new Date().toISOString(), imports: list }), 'application/json');
    } }, 'Salva backup dei dati'),
    h('button', { class: 'btn secondary', onclick: () => document.getElementById('restore').click() }, 'Ripristina da backup'),
    h('p', { class: 'muted', style: 'font-size:13px;margin-top:8px' }, 'Il backup contiene i tuoi turni: tienilo solo su dispositivi tuoi (iCloud Drive, File).')));

  parts.push(h('div', { class: 'card' }, h('h2', {}, 'Informazioni'),
    h('div', { class: 'cmp' }, h('span', {}, 'Versione'), h('b', {}, VERSION)),
    state.data.pilot ? h('div', { class: 'cmp' }, h('span', {}, 'Pilota'), h('b', {}, `${state.data.pilot.code} · ${titleCase(state.data.pilot.name)}`)) : null,
    h('p', { class: 'muted', style: 'font-size:13px;margin-top:8px' }, 'Tutti gli orari nel PDF sono UTC (Z); l’ora locale (LT) è quella dell’aeroporto, calcolata dall’app. Nessun dato lascia questo dispositivo: niente account, niente server.'),
    imports.length ? h('button', { class: 'btn danger', style: 'margin-top:10px', onclick: async () => { if (confirm('Cancellare TUTTI i turni salvati su questo dispositivo?')) { await clearImports(); await actions.refresh(); actions.toast('Dati cancellati'); } } }, 'Cancella tutti i dati') : null));
  view.replaceChildren(...parts);
}

export async function restoreBackup(file) {
  const data = JSON.parse(await file.text());
  if (data.app !== 'dk3-roster' || !Array.isArray(data.imports)) throw new Error('Questo file non è un backup di DK3 Roster.');
  if (!confirm(`Ripristinare il backup (${data.imports.length} import)? I dati attuali verranno sostituiti.`)) return false;
  await replaceImports(data.imports.map(({ id, ...rest }) => rest));
  return true;
}
