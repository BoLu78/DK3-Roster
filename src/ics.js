// Export calendario .ics (RFC 5545).
import { buildDayTimeline, fmtUtc, localTime } from './timeline.js';

function icsDate(ms) {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

// Righe max 75 byte, continuazione con spazio. Si taglia sui caratteri, non sui byte.
function fold(line) {
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

export function routeOf(day) {
  const legs = day.legs.filter((l) => l.kind === 'flight' || l.kind === 'transport');
  if (!legs.length) return '';
  const pts = [legs[0].dep];
  for (const l of legs) pts.push(l.arr);
  return pts.filter(Boolean).join('-');
}

export function flightNumbers(day) {
  return day.legs.filter((l) => l.kind === 'flight').map((l) => `${l.airline ?? ''}${l.number}`).join('/');
}

function describe(day, tl, airports) {
  const lines = [];
  const hm = (ms, apt) => {
    const loc = localTime(ms, apt, airports, day.date);
    return `${fmtUtc(ms)}Z${loc ? ` (${loc.time} locale${loc.dayDelta ? ` ${loc.dayDelta > 0 ? '+' : ''}${loc.dayDelta}` : ''})` : ''}`;
  };
  if (tl.pickupMs) lines.push(`Pick up ${fmtUtc(tl.pickupMs)}Z`);
  if (tl.checkIn) lines.push(`${tl.checkIn.label ?? 'C/I'} ${tl.checkIn.airport ?? ''} ${hm(tl.checkIn.ms, tl.checkIn.airport)}`);
  for (const { leg, depMs, arrMs } of tl.legs) {
    const name = leg.kind === 'flight' ? `${leg.airline ?? ''}${leg.number}` : leg.code ?? '';
    lines.push(`${name} ${leg.dep ?? ''} ${depMs ? hm(depMs, leg.dep) : ''} → ${leg.arr ?? ''} ${arrMs ? hm(arrMs, leg.arr) : ''}${leg.ac ? ` · ${leg.ac}` : ''}`.replace(/\s+/g, ' ').trim());
  }
  if (tl.checkOut) lines.push(`${tl.checkOut.label ?? 'C/O'} ${tl.checkOut.airport ?? ''} ${hm(tl.checkOut.ms, tl.checkOut.airport)}`);
  if (day.ft || day.dt) lines.push(`FT ${day.ft ?? '—'} · DT ${day.dt ?? '—'}`);
  if (day.hotel) lines.push(`Hotel ${day.hotel.name ?? day.hotel.code}${day.hotel.phone ? ` ${day.hotel.phone}` : ''}`);
  return lines.join('\n');
}

function summaryOf(day) {
  const route = routeOf(day);
  if (day.kind === 'flight') return `✈ ${route} ${flightNumbers(day)}`.trim();
  if (day.kind === 'transport') return `Trasferimento ${route}`.trim();
  if (day.kind === 'sim') return 'Simulatore';
  if (day.kind === 'standby') return day.code === 'RESERVE' ? 'Reserve' : 'Stand-by';
  return day.code ?? 'Servizio';
}

// options.scope: 'flights' (solo voli) | 'all' (voli, trasferimenti, sim, stand-by)
// options.from / options.to: date ISO (compresi) per limitare al mese scelto
// options.alarmMinutes: promemoria prima dell'inizio (0 = nessuno)
export function buildIcs(days, airports, options = {}, nowMs = Date.now()) {
  const { scope = 'all', from = null, to = null, alarmMinutes = 0 } = options;
  const out = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//DK3 Roster//IT', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:DK3 Roster'];
  let count = 0;
  for (const day of days) {
    if (from && day.date < from) continue;
    if (to && day.date > to) continue;
    const isFlight = day.kind === 'flight';
    const include = isFlight || (scope === 'all' && ['transport', 'sim', 'standby'].includes(day.kind));
    if (!include) continue;
    const tl = buildDayTimeline(day);
    out.push('BEGIN:VEVENT', `UID:${day.date}-${day.kind}@dk3-roster`, `DTSTAMP:${icsDate(nowMs)}`);
    if (tl.startMs != null && tl.endMs != null && tl.endMs > tl.startMs) {
      out.push(`DTSTART:${icsDate(tl.startMs)}`, `DTEND:${icsDate(tl.endMs)}`);
    } else {
      const next = new Date(Date.parse(day.date + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10).replace(/-/g, '');
      out.push(`DTSTART;VALUE=DATE:${day.date.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${next}`);
    }
    out.push(`SUMMARY:${esc(summaryOf(day))}`);
    const loc = day.checkIn?.airport ?? day.airport ?? day.legs[0]?.dep;
    if (loc) out.push(`LOCATION:${esc(airports?.[loc]?.name ? `${loc} - ${airports[loc].name}` : loc)}`);
    out.push(`DESCRIPTION:${esc(describe(day, tl, airports))}`);
    if (alarmMinutes > 0 && tl.startMs != null) out.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Servizio', `TRIGGER:-PT${alarmMinutes}M`, 'END:VALARM');
    out.push('END:VEVENT');
    count++;
  }
  out.push('END:VCALENDAR');
  return { text: out.map(fold).join('\r\n') + '\r\n', count };
}
