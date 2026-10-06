// Unisce le versioni importate in un unico quadro dei turni.
// Ogni import è: { id, importedAt, fileName, roster, changes, seen }.
// Per ogni data vale la versione importata più di recente che la contiene.
import { diffDays } from './diff.js';

export function mergeImports(imports) {
  const sorted = [...imports].sort((a, b) => a.importedAt.localeCompare(b.importedAt) || a.id - b.id);
  const days = new Map();
  const airports = {};
  const periods = [];
  let recurrent = [];
  let recurrentFrom = null;
  let pilot = null;
  for (const imp of sorted) {
    const r = imp.roster;
    for (const d of r.days) days.set(d.date, { ...d, importId: imp.id });
    Object.assign(airports, r.airports);
    periods.push({ importId: imp.id, start: r.meta.periodStart, end: r.meta.periodEnd, totals: r.totals, printedAt: r.meta.printedAt });
    const stamp = r.meta.printedAt ?? imp.importedAt;
    if (r.recurrent?.length && (!recurrentFrom || stamp >= recurrentFrom)) {
      recurrent = r.recurrent;
      recurrentFrom = stamp;
    }
    pilot = r.meta.pilotName ? { code: r.meta.pilotCode, name: r.meta.pilotName, base: r.meta.base } : pilot;
  }
  return { days, airports, periods, recurrent, pilot };
}

// Cosa cambia importando `newRoster` rispetto a ciò che c'è già.
export function changesFor(existingImports, newRoster) {
  const before = mergeImports(existingImports).days;
  const after = new Map(newRoster.days.map((d) => [d.date, d]));
  return diffDays(before, after);
}

// Le date modificate dall'ultimo import non ancora "viste", per segnarle in lista.
export function pendingChangeDates(imports) {
  const map = new Map();
  for (const imp of imports) {
    if (!imp.changes || imp.seen) continue;
    for (const kind of ['added', 'removed', 'changed']) {
      for (const c of imp.changes[kind]) {
        if (imp.seenDates?.includes(c.date)) continue; // già visto singolarmente
        map.set(c.date, { kind, lines: c.lines, importId: imp.id });
      }
    }
  }
  return map;
}

// Date con modifiche di un import (aggiunte, tolte, cambiate)
export const changeDatesOf = (imp) => (imp.changes ? ['added', 'removed', 'changed'].flatMap((k) => imp.changes[k].map((c) => c.date)) : []);

// Un import con tutte le date viste singolarmente conta come visto.
export function withDaySeen(imp, date) {
  const seenDates = [...new Set([...(imp.seenDates ?? []), date])];
  const seen = changeDatesOf(imp).every((d) => seenDates.includes(d));
  return { ...imp, seenDates, seen };
}
