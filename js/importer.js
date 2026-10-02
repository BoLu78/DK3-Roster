// Import del PDF: pdf.js (copiato in vendor/, niente CDN) + parser.
import { parsePdf, checkTotals } from '../src/parser.js';
import { changesFor } from '../src/merge.js';

let pdfjsPromise;
function loadPdfjs() {
  pdfjsPromise ??= import('../vendor/pdfjs/pdf.min.mjs').then((m) => {
    m.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
    return m;
  });
  return pdfjsPromise;
}

export class ImportError extends Error {}

// Legge il PDF e prepara il record da salvare. Non scrive nulla.
export async function readRoster(arrayBuffer, existingImports, fileName = '') {
  const pdfjs = await loadPdfjs();
  let roster;
  try {
    roster = await parsePdf(pdfjs, arrayBuffer);
  } catch (e) {
    throw new ImportError('Non riesco a leggere questo file: non sembra un PDF valido.');
  }
  if (!roster.meta.periodStart || !roster.meta.periodEnd || !roster.days.length || !roster.days.some((d) => d.kind !== 'blank')) {
    throw new ImportError('PDF non riconosciuto: non trovo il periodo e i turni di un "Individual duty plan" NetLine/Crew. Il formato potrebbe essere cambiato.');
  }
  const dup = existingImports.find((i) => i.roster.meta.printedAt && i.roster.meta.printedAt === roster.meta.printedAt && i.roster.meta.periodStart === roster.meta.periodStart && i.roster.meta.periodEnd === roster.meta.periodEnd);
  if (dup) throw new ImportError('Questo PDF è già stato importato (stessa data di stampa e stesso periodo).');
  const changes = changesFor(existingImports, roster);
  return {
    record: { importedAt: new Date().toISOString(), fileName, roster, changes: changes.count ? changes : null, seen: !changes.count },
    check: checkTotals(roster),
    changes,
  };
}
