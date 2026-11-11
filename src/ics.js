// Export calendario .ics (RFC 5545).
import { eventName } from './labels.js';
import { buildDayTimeline, buildDuties, fmtUtc, localTime } from './timeline.js';
import { tr } from './i18n.js';

export function icsDate(ms) {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

// Righe max 75 byte, continuazione con spazio. Si taglia sui caratteri, non sui byte.
export function fold(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (bytes + b > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = '';
      bytes = 0;
    }
    cur += ch;
    bytes += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}

// Rotta dai tratti: MXP-RMF-MXP (un aeroporto non si ripete se la tratta parte da dove è arrivata la precedente)
// Chiude il calendario gestendo gli aggiornamenti.
// Importare un .ics può aggiungere o aggiornare eventi (stesso UID, SEQUENCE più alta) ma non toglierli:
// per i servizi spariti dal roster si ripete l'evento già esportato con STATUS:CANCELLED.
// previous: { uid: { date, dt: [righe DTSTART/DTEND] } } dall'export precedente (stesso formato).
// Restituisce la mappa degli eventi esportati ora, da salvare per il prossimo export.
export function finishCalendar(out, { previous = {}, from = null, to = null, nowMs = Date.now(), seq = Math.floor(nowMs / 1000), cancelledTitle = tr('Annullato · non più nel roster', 'Cancelled · no longer in the roster') } = {}) {
  const emitted = {};
  let cur = null;
  for (const line of out) {
    if (line === 'BEGIN:VEVENT') cur = { dt: [] };
    else if (line === 'END:VEVENT' && cur) {
      if (cur.uid) emitted[cur.uid] = { date: cur.date, dt: cur.dt };
      cur = null;
    } else if (cur && line.startsWith('UID:')) cur.uid = line.slice(4);
    else if (cur && (line.startsWith('DTSTART') || line.startsWith('DTEND'))) {
      cur.dt.push(line);
      if (line.startsWith('DTSTART')) {
        const v = line.split(':')[1];
        cur.date = `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
      }
    }
  }
  const inRange = (date) => (!from || date >= from) && (!to || date <= to);
  let cancelled = 0;
  for (const [uid, ev] of Object.entries(previous)) {
    if (emitted[uid] || !ev?.dt?.length || !inRange(ev.date)) continue;
    out.push('BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${icsDate(nowMs)}`, `LAST-MODIFIED:${icsDate(nowMs)}`, `SEQUENCE:${seq}`,
      'STATUS:CANCELLED', 'TRANSP:TRANSPARENT', `SUMMARY:${esc(cancelledTitle)}`, ...ev.dt, 'END:VEVENT');
    cancelled++;
  }
  // l'export nuovo conosce anche gli eventi precedenti fuori dal periodo esportato
  const keep = Object.fromEntries(Object.entries(previous).filter(([, ev]) => ev?.date && !inRange(ev.date)));
  out.push('END:VCALENDAR');
  return { emitted: { ...keep, ...emitted }, cancelled };
}

export function routeOfLegs(legs) {
  const l = legs.filter((x) => x.kind === 'flight' || x.kind === 'transport');
  if (!l.length) return '';
  const pts = [l[0].dep];
  for (const x of l) {
    if (x.dep !== pts.at(-1)) pts.push(x.dep);
    pts.push(x.arr);
  }
  return pts.filter(Boolean).join('-');
}

export const routeOf = (day) => routeOfLegs(day.legs);

export function flightNumbersOf(legs) {
  const out = [];
  for (const l of legs) {
    if (l.kind !== 'flight') continue;
    const n = `${l.airline ?? ''}${l.number}`;
    if (!out.includes(n)) out.push(n);
  }
  return out.join('/');
}

export const flightNumbers = (day) => flightNumbersOf(day.legs);

function describeDuty(duty, airports, refDate) {
  const lines = [];
  const hm = (ms, apt) => {
    const loc = localTime(ms, apt, airports, refDate);
    return `${fmtUtc(ms)}Z${loc ? ` (${loc.time} ${tr('locale', 'local')}${loc.dayDelta ? ` ${loc.dayDelta > 0 ? '+' : ''}${loc.dayDelta}` : ''})` : ''}`;
  };
  if (duty.pickupMs) lines.push(`Pick up ${fmtUtc(duty.pickupMs)}Z`);
  if (duty.ci) lines.push(`${eventName(duty.ci.label, 'C/I')} ${duty.ci.airport ?? ''} ${hm(duty.ci.ms, duty.ci.airport)}`);
  for (const { leg, depMs, arrMs } of duty.legs) {
    const name = leg.kind === 'flight' ? `${leg.airline ?? ''}${leg.number}` : leg.code ?? '';
    lines.push(`${name} ${leg.dep ?? ''} ${depMs ? hm(depMs, leg.dep) : ''} → ${leg.arr ?? ''} ${arrMs ? hm(arrMs, leg.arr) : ''}${leg.ac ? ` · ${leg.ac}` : ''}`.replace(/\s+/g, ' ').trim());
  }
  if (duty.co) lines.push(`${eventName(duty.co.label, 'C/O')} ${duty.co.airport ?? ''} ${hm(duty.co.ms, duty.co.airport)}`);
  if (duty.ft || duty.dt) lines.push(`FT ${duty.ft ?? '—'} · DT ${duty.dt ?? '—'}`);
  if (duty.hotel) lines.push(`Hotel ${duty.hotel.name ?? duty.hotel.code}${duty.hotel.phone ? ` ${duty.hotel.phone}` : ''}`);
  return lines.join('\n');
}

function dutySummary(duty) {
  const legs = duty.legs.map((l) => l.leg);
  if (duty.kind === 'flight') return `✈ ${routeOfLegs(legs)} ${flightNumbersOf(legs)}`.trim();
  if (duty.kind === 'sim') return tr('Simulatore', 'Simulator');
  if (duty.kind === 'ground') return `${tr('Attività a terra', 'Ground duty')} ${legs[0]?.code ?? ''}`.trim();
  return `${tr('Trasferimento', 'Positioning')} ${routeOfLegs(legs)}`.trim();
}

const isoDate = (ms) => new Date(ms).toISOString().slice(0, 10);

// options.scope: 'flights' (solo voli) | 'all' (voli, trasferimenti, sim, stand-by)
// options.from / options.to: date ISO (compresi) per limitare al mese scelto
// options.alarmMinutes: promemoria prima dell'inizio (0 = nessuno)
// I servizi si ricostruiscono dal check-in al check-out anche se passano la mezzanotte.
export function buildIcs(days, airports, options = {}, nowMs = Date.now()) {
  const { scope = 'all', from = null, to = null, alarmMinutes = 0, version = '', previous = {} } = options;
  const seq = Math.floor(nowMs / 1000); // sempre crescente: l'evento nuovo vince su quello già nel calendario
  const out = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//DK3 Roster//IT', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:DK3 Roster'];
  let count = 0;
  const inRange = (date) => (!from || date >= from) && (!to || date <= to);
  const event = (uid, summary, location, description, startMs, endMs, allDayDate) => {
    out.push('BEGIN:VEVENT', `UID:${uid}@dk3-roster`, `DTSTAMP:${icsDate(nowMs)}`, `LAST-MODIFIED:${icsDate(nowMs)}`, `SEQUENCE:${seq}`);
    if (startMs != null && endMs != null && endMs > startMs) out.push(`DTSTART:${icsDate(startMs)}`, `DTEND:${icsDate(endMs)}`);
    else {
      const next = new Date(Date.parse(allDayDate + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10).replace(/-/g, '');
      out.push(`DTSTART;VALUE=DATE:${allDayDate.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${next}`);
    }
    out.push(`SUMMARY:${esc(summary)}`);
    if (location) out.push(`LOCATION:${esc(airports?.[location]?.name ? `${location} - ${airports[location].name}` : location)}`);
    out.push(`DESCRIPTION:${esc([version, description].filter(Boolean).join('\n'))}`);
    if (alarmMinutes > 0 && startMs != null && endMs > startMs) out.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${tr('Servizio', 'Duty')}`, `TRIGGER:-PT${alarmMinutes}M`, 'END:VALARM');
    out.push('END:VEVENT');
    count++;
  };

  // Un posto fisso per ogni giorno (UID = data + numero): se il turno cambia, l'evento di quel giorno
  // si aggiorna invece di aggiungersene uno nuovo; un giorno che diventa libero diventa "OFF".
  const slots = new Map(); // data -> eventi già messi quel giorno
  const slotUid = (date) => {
    const n = slots.get(date) ?? 0;
    slots.set(date, n + 1);
    return `d${date}-${n}`;
  };
  const dutyStart = new Set();
  for (const duty of buildDuties(days)) {
    const date = isoDate(duty.startMs);
    dutyStart.add(date);
    if (scope === 'flights' && duty.kind !== 'flight') continue;
    if (!inRange(date)) continue;
    const loc = duty.ci?.airport ?? duty.legs[0]?.leg.dep;
    event(slotUid(date), dutySummary(duty), loc, describeDuty(duty, airports, date), duty.startMs, duty.endMs, date);
  }
  for (const day of [...days].filter((d) => !d.spill).sort((a, b) => a.date.localeCompare(b.date))) {
    if (!inRange(day.date)) continue;
    if (day.kind === 'standby' && scope === 'all') {
      const tl = buildDayTimeline(day);
      const name = day.code === 'RESERVE' ? 'Reserve' : 'Stand-by';
      event(slotUid(day.date), name, day.airport, `${name}${day.airport ? ` ${day.airport}` : ''}${tl.window ? `\n${fmtUtc(tl.window.startMs)}Z - ${fmtUtc(tl.window.endMs)}Z` : ''}`, tl.window?.startMs, tl.window?.endMs, day.date);
      continue;
    }
    if (slots.has(day.date) || dutyStart.has(day.date) && scope === 'all') continue;
    // giorno senza servizi che iniziano: evento di tutto il giorno, così occupa il suo posto
    const free = { off: 'OFF', vacation: tr('Ferie', 'Leave'), rest: `${tr('Riposo', 'Rest')}${day.hotel?.airport ? ` ${tr('a', 'in')} ${day.hotel.airport}` : ''}` }[day.kind];
    const title = free ?? (scope === 'flights' ? tr('Nessun volo', 'No flight') : null);
    if (!title) continue; // giorno dentro un servizio iniziato prima, o senza dati
    event(slotUid(day.date), title, null, [title, day.hotel?.name].filter(Boolean).join('\n'), null, null, day.date);
  }
  const { emitted, cancelled } = finishCalendar(out, { previous, from, to, nowMs, seq });
  return { text: out.map(fold).join('\r\n') + '\r\n', count, emitted, cancelled };
}
