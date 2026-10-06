// Toglie i pallini delle modifiche: tutti insieme o un giorno alla volta.
import { state } from './state.js';
import { putImport } from './db.js';
import { changeDatesOf, withDaySeen } from '../src/merge.js';

// Tutti gli import con modifiche non ancora viste (non solo l'ultimo)
export async function markAllSeen() {
  for (const imp of state.imports) {
    if (imp.changes && !imp.seen) await putImport({ ...imp, seen: true });
  }
}

// Un solo giorno: toglie il pallino da quella data in tutti gli import che la segnalano
export async function markDaySeen(date) {
  for (const imp of state.imports) {
    if (imp.changes && !imp.seen && changeDatesOf(imp).includes(date)) await putImport(withDaySeen(imp, date));
  }
}

export const hasPending = () => state.pending.size > 0;
