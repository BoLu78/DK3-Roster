// Rotazioni (trip): una o più giornate di servizio consecutive da base a base,
// come la barra continua nella vista mensile di NetLine.
import { buildDuties } from './timeline.js';

const isoDate = (ms) => new Date(ms).toISOString().slice(0, 10);

function finish(duties, base) {
  const first = duties[0];
  const last = duties.at(-1);
  const legs = duties.flatMap((d) => d.legs.map((l) => l.leg));
  const stops = [];
  for (const l of legs) for (const a of [l.dep, l.arr]) if (a && a !== base && !stops.includes(a)) stops.push(a);
  const kind = legs.some((l) => l.kind === 'flight') ? 'flight' : legs.some((l) => l.kind === 'ground') ? 'sim' : 'transport';
  return { duties, kind, startMs: first.startMs, endMs: last.endMs, startDate: isoDate(first.startMs), endDate: isoDate(last.endMs), stops };
}

// days: tutti i giorni in ordine di data; base: aeroporto base (es. MXP)
export function buildTrips(days, base) {
  const trips = [];
  let cur = [];
  for (const d of buildDuties(days)) {
    cur.push(d);
    const end = d.co?.airport ?? d.legs.at(-1)?.leg.arr;
    if (!base || end === base) {
      trips.push(finish(cur, base));
      cur = [];
    }
  }
  if (cur.length) trips.push(finish(cur, base));
  return trips;
}
