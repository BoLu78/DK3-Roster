// Import del PDF: pdf.js (copiato in vendor/, niente CDN) + parser.
import './polyfills.js';
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

const describe = (e) => `${e?.name ?? 'Errore'}: ${String(e?.message ?? e).slice(0, 160)}`;

// Legge il PDF e prepara il record da salvare. Non scrive nulla.
export async function readRoster(arrayBuffer, existingImports, fileName = '') {
  let pdfjs;
  try {
    pdfjs = await loadPdfjs();
  } catch (e) {
    pdfjsPromise = undefined;
    throw new ImportError(`Non riesco ad avviare il lettore PDF (${describe(e)}).`);
  }
  let roster;
  try {
    roster = await parsePdf(pdfjs, arrayBuffer);
  } catch (e) {
    console.error(e);
    const bad = /Invalid PDF|InvalidPDF|header/i.test(`${e?.name} ${e?.message}`);
    throw new ImportError(bad ? 'Questo file non sembra un PDF valido.' : `Non riesco a leggere il PDF (${describe(e)}).`);
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
