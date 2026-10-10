// Confronto tra due versioni dello stesso turno (re-import).

const hasDuty = (d) => d && d.kind !== 'off' && d.kind !== 'blank';

const legKey = (l) => (l.kind === 'flight' ? `${l.airline}${l.number}` : l.code ?? l.kind);
const crewKey = (l) => (l.crew ? [...(l.crew.cockpit ?? []), ...(l.crew.cabin ?? []), ...(l.crew.other ?? [])].map((c) => c.code).join(',') : '');

const fmtTime = (t) => (t ? `${t.slice(0, 2)}:${t.slice(2)}` : '—');

const KIND_LABEL = { flight: 'Volo', transport: 'Trasferimento', standby: 'Stand-by', sim: 'Simulatore', off: 'OFF', vacation: 'Ferie', rest: 'Giorno X', blank: 'Nessun servizio', other: 'Altro' };
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

  const keysA = a.legs.map(legKey);
  const keysB = b.legs.map(legKey);
  for (const k of keysB) if (!keysA.includes(k)) lines.push(`Tratta aggiunta: ${k}`);
  for (const k of keysA) if (!keysB.includes(k)) lines.push(`Tratta tolta: ${k}`);
  for (const lb of b.legs) {
    const la = a.legs.find((l) => legKey(l) === legKey(lb));
    if (!la) continue;
    const name = legKey(lb);
    if (la.dep !== lb.dep || la.arr !== lb.arr) lines.push(`${name}: ${la.dep}-${la.arr} → ${lb.dep}-${lb.arr}`);
    if (la.depTime !== lb.depTime) lines.push(`${name} partenza: ${fmtTime(la.depTime)} → ${fmtTime(lb.depTime)}`);
    if (la.arrTime !== lb.arrTime) lines.push(`${name} arrivo: ${fmtTime(la.arrTime)} → ${fmtTime(lb.arrTime)}`);
    if (la.ac !== lb.ac) lines.push(`${name} AC: ${la.ac ?? '—'} → ${lb.ac ?? '—'}`);
    if (crewKey(la) !== crewKey(lb)) lines.push(`${name}: equipaggio cambiato`);
  }
  if ((a.hotel?.code ?? null) !== (b.hotel?.code ?? null) || (a.hotel?.airport ?? null) !== (b.hotel?.airport ?? null)) {
    lines.push(`Hotel: ${a.hotel?.code ?? '—'} → ${b.hotel?.code ?? '—'}`);
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
