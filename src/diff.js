// Confronto tra due versioni dello stesso turno (re-import).
// Le frasi si salvano in italiano insieme all'import; changeLine() le mostra nella lingua scelta.
import { isEn } from './i18n.js';

const EN_LINE = [
  [/^Tipo: /, 'Type: '], [/^Orario: /, 'Times: '], [/^Tratta aggiunta: /, 'Leg added: '], [/^Tratta tolta: /, 'Leg removed: '],
  [/ partenza: /, ' departure: '], [/ arrivo: /, ' arrival: '], [/: equipaggio cambiato$/, ': crew changed'],
  [/\bAttività a terra\b/g, 'Ground duty'], [/\bTrasferimento\b/g, 'Positioning'], [/\bSimulatore\b/g, 'Simulator'], [/\bNessun servizio\b/g, 'No duty'],
  [/\bGiorno X\b/g, 'Day X'], [/\bFerie\b/g, 'Leave'], [/\bVolo\b/g, 'Flight'], [/\bAltro\b/g, 'Other'],
];
export const changeLine = (line) => (isEn() ? EN_LINE.reduce((s, [re, en]) => s.replace(re, en), line) : line);

const hasDuty = (d) => d && d.kind !== 'off' && d.kind !== 'blank';

const legKey = (l) => (l.kind === 'flight' ? `${l.airline}${l.number}` : l.code ?? l.kind);
const crewKey = (l) => (l.crew ? [...(l.crew.cockpit ?? []), ...(l.crew.cabin ?? []), ...(l.crew.other ?? [])].map((c) => c.code).join(',') : '');

const fmtTime = (t) => (t ? `${t.slice(0, 2)}:${t.slice(2)}` : '—');

const KIND_LABEL = { flight: 'Volo', transport: 'Trasferimento', standby: 'Stand-by', sim: 'Simulatore', ground: 'Attività a terra', off: 'OFF', vacation: 'Ferie', rest: 'Giorno X', blank: 'Nessun servizio', other: 'Altro' };
const dayLabel = (d) => (d.kind === 'standby' && d.code === 'RESERVE' ? 'Reserve' : KIND_LABEL[d.kind] ?? d.kind);

// Elenco di frasi che descrivono cosa è cambiato tra due giorni.
export function describeChange(a, b) {
  const lines = [];
  if (a.kind !== b.kind || a.code !== b.code) lines.push(`Tipo: ${dayLabel(a)} → ${dayLabel(b)}`);
  if (a.pickup !== b.pickup) lines.push(`Pick up: ${fmtTime(a.pickup)} → ${fmtTime(b.pickup)}`);
  if (a.checkIn?.time !== b.checkIn?.time || a.checkIn?.airport !== b.checkIn?.airport) {
    lines.push(`Check-in: ${a.checkIn ? `${a.checkIn.airport} ${fmtTime(a.checkIn.time)}` : '—'} → ${b.checkIn ? `${b.checkIn.airport} ${fmtTime(b.checkIn.time)}` : '—'}`);
  }
  if (a.checkOut?.time !== b.checkOut?.time || a.checkOut?.airport !== b.checkOut?.airport) {
    lines.push(`Check-out: ${a.checkOut ? `${a.checkOut.airport} ${fmtTime(a.checkOut.time)}` : '—'} → ${b.checkOut ? `${b.checkOut.airport} ${fmtTime(b.checkOut.time)}` : '—'}`);
  }
  const wa = a.window ? `${fmtTime(a.window.start)}-${fmtTime(a.window.end)}` : '';
  const wb = b.window ? `${fmtTime(b.window.start)}-${fmtTime(b.window.end)}` : '';
  if (wa !== wb) lines.push(`Orario: ${wa || '—'} → ${wb || '—'}`);

  // lo stesso numero può ripetersi su più tratte (es. NO4962 BLQ-RMF, RMF-SSH, SSH-BLQ):
  // si abbinano in ordine, la prima con la prima, la seconda con la seconda...
  const keyed = (legs) => {
    const seen = {};
    return legs.map((l) => {
      const k = legKey(l);
      seen[k] = (seen[k] ?? 0) + 1;
      return { l, key: `${k}#${seen[k]}`, name: k, dup: legs.filter((x) => legKey(x) === k).length > 1 };
    });
  };
  const A = keyed(a.legs);
  const B = keyed(b.legs);
  const label = (x) => (x.dup ? `${x.name} ${x.l.dep ?? ''}-${x.l.arr ?? ''}` : x.name);
  for (const x of B) if (!A.some((y) => y.key === x.key)) lines.push(`Tratta aggiunta: ${label(x)}`);
  for (const x of A) if (!B.some((y) => y.key === x.key)) lines.push(`Tratta tolta: ${label(x)}`);
  for (const xb of B) {
    const xa = A.find((y) => y.key === xb.key);
    if (!xa) continue;
    const la = xa.l;
    const lb = xb.l;
    const name = label(xb);
    if (la.dep !== lb.dep || la.arr !== lb.arr) lines.push(`${name}: ${la.dep}-${la.arr} → ${lb.dep}-${lb.arr}`);
    if (la.depTime !== lb.depTime) lines.push(`${name} partenza: ${fmtTime(la.depTime)} → ${fmtTime(lb.depTime)}`);
    if (la.arrTime !== lb.arrTime) lines.push(`${name} arrivo: ${fmtTime(la.arrTime)} → ${fmtTime(lb.arrTime)}`);
    if (la.ac !== lb.ac) lines.push(`${name} AC: ${la.ac ?? '—'} → ${lb.ac ?? '—'}`);
    if (crewKey(la) !== crewKey(lb)) lines.push(`${name}: equipaggio cambiato`);
  }
  if ((a.hotel?.code ?? null) !== (b.hotel?.code ?? null) || (a.hotel?.airport ?? null) !== (b.hotel?.airport ?? null)) {
    const hot = (x) => (x?.hotel ? `${x.hotel.code}${x.hotel.airport ? ` ${x.hotel.airport}` : ''}` : '—');
    lines.push(`Hotel: ${hot(a)} → ${hot(b)}`);
  }
  if (a.ft !== b.ft) lines.push(`FT: ${a.ft ?? '—'} → ${b.ft ?? '—'}`);
  if (a.dt !== b.dt) lines.push(`DT: ${a.dt ?? '—'} → ${b.dt ?? '—'}`);
  return lines;
}

// oldDays/newDays: Map data -> giorno. Si confrontano solo le date presenti in
// entrambe le versioni (se la data non c'era prima, non è una modifica).
export function diffDays(oldDays, newDays) {
  const added = [];
  const removed = [];
  const changed = [];
  for (const [date, nd] of newDays) {
    const od = oldDays.get(date);
    if (!od) continue;
    const lines = describeChange(od, nd);
    if (!lines.length) continue;
    if (!hasDuty(od) && hasDuty(nd)) added.push({ date, lines });
    else if (hasDuty(od) && !hasDuty(nd)) removed.push({ date, lines });
    else changed.push({ date, lines });
  }
  return { added, removed, changed, count: added.length + removed.length + changed.length };
}
