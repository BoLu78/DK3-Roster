// Statistiche FT / DT e riepiloghi.
import { hhmmToMinutes, minutesToHhmm } from './parser.js';

export { hhmmToMinutes, minutesToHhmm };

// Limiti di riferimento (EASA ORO.FTL.210), mostrati come promemoria.
export const LIMITS = {
  ft28: 100 * 60,
  dt7: 60 * 60,
  dt14: 110 * 60,
  dt28: 190 * 60,
};

export function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function monthSummary(days) {
  const s = { ft: 0, dt: 0, simFt: 0, flightDays: 0, sectors: 0, standbyDays: 0, reserveDays: 0, simDays: 0, transportDays: 0, offDays: 0, nights: 0, blankDays: 0 };
  for (const d of days) {
    s.ft += hhmmToMinutes(d.ft);
    s.dt += hhmmToMinutes(d.dt);
    s.simFt += hhmmToMinutes(d.simFt);
    s.sectors += d.legs.filter((l) => l.kind === 'flight').length;
    if (d.hotel) s.nights++;
    if (d.kind === 'flight') s.flightDays++;
    else if (d.kind === 'standby') d.code === 'RESERVE' ? s.reserveDays++ : s.standbyDays++;
    else if (d.kind === 'sim') s.simDays++;
    else if (d.kind === 'transport') s.transportDays++;
    else if (d.kind === 'off') s.offDays++;
    else s.blankDays++;
  }
  return s;
}

// Somma FT e DT negli ultimi n giorni che finiscono a endIso (compreso).
export function rolling(daysByDate, endIso, n) {
  let ft = 0;
  let dt = 0;
  for (let i = 0; i < n; i++) {
    const d = daysByDate.get(addDays(endIso, -i));
    if (!d) continue;
    ft += hhmmToMinutes(d.ft);
    dt += hhmmToMinutes(d.dt);
  }
  return { ft, dt };
}

export function monthKey(iso) {
  return iso.slice(0, 7);
}
