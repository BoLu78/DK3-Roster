// Export calendario .ics (RFC 5545).
import { buildDayTimeline, buildDuties, fmtUtc, localTime } from './timeline.js';

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

// Rotta dai tratti: MXP-RMF-MXP (un aeroporto non si ripete se la tratta parte da dove è arrivata la precedente)
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
    return `${fmtUtc(ms)}Z${loc ? ` (${loc.time} locale${loc.dayDelta ? ` ${loc.dayDelta > 0 ? '+' : ''}${loc.dayDelta}` : ''})` : ''}`;
  };
  if (duty.pickupMs) lines.push(`Pick up ${fmtUtc(duty.pickupMs)}Z`);
  if (duty.ci) lines.push(`${duty.ci.label ?? 'C/I'} ${duty.ci.airport ?? ''} ${hm(duty.ci.ms, duty.ci.airport)}`);
  for (const { leg, depMs, arrMs } of duty.legs) {
    const name = leg.kind === 'flight' ? `${leg.airline ?? ''}${leg.number}` : leg.code ?? '';
    lines.push(`${name} ${leg.dep ?? ''} ${depMs ? hm(depMs, leg.dep) : ''} → ${leg.arr ?? ''} ${arrMs ? hm(arrMs, leg.arr) : ''}${leg.ac ? ` · ${leg.ac}` : ''}`.replace(/\s+/g, ' ').trim());
  }
  if (duty.co) lines.push(`${duty.co.label ?? 'C/O'} ${duty.co.airport ?? ''} ${hm(duty.co.ms, duty.co.airport)}`);
  if (duty.ft || duty.dt) lines.push(`FT ${duty.ft ?? '—'} · DT ${duty.dt ?? '—'}`);
  if (duty.hotel) lines.push(`Hotel ${duty.hotel.name ?? duty.hotel.code}${duty.hotel.phone ? ` ${duty.hotel.phone}` : ''}`);
  return lines.join('\n');
}

function dutySummary(duty) {
  const legs = duty.legs.map((l) => l.leg);
  if (duty.kind === 'flight') return `✈ ${routeOfLegs(legs)} ${flightNumbersOf(legs)}`.trim();
  if (duty.kind === 'sim') return 'Simulatore';
  return `Trasferimento ${routeOfLegs(legs)}`.trim();
}

const isoDate = (ms) => new Date(ms).toISOString().slice(0, 10);

// options.scope: 'flights' (solo voli) | 'all' (voli, trasferimenti, sim, stand-by)
// options.from / options.to: date ISO (compresi) per limitare al mese scelto
// options.alarmMinutes: promemoria prima dell'inizio (0 = nessuno)
// I servizi si ricostruiscono da C/I a C/O anche se passano la mezzanotte.
export function buildIcs(days, airports, options = {}, nowMs = Date.now()) {
  const { scope = 'all', from = null, to = null, alarmMinutes = 0 } = options;
  const out = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//DK3 Roster//IT', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:DK3 Roster'];
  let count = 0;
  const inRange = (date) => (!from || date >= from) && (!to || date <= to);
  const event = (uid, summary, location, description, startMs, endMs, allDayDate) => {
    out.push('BEGIN:VEVENT', `UID:${uid}@dk3-roster`, `DTSTAMP:${icsDate(nowMs)}`);
    if (startMs != null && endMs != null && endMs > startMs) out.push(`DTSTART:${icsDate(startMs)}`, `DTEND:${icsDate(endMs)}`);
    else {
      const next = new Date(Date.parse(allDayDate + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10).replace(/-/g, '');
      out.push(`DTSTART;VALUE=DATE:${allDayDate.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${next}`);
    }
    out.push(`SUMMARY:${esc(summary)}`);
    if (location) out.push(`LOCATION:${esc(airports?.[location]?.name ? `${location} - ${airports[location].name}` : location)}`);
    out.push(`DESCRIPTION:${esc(description)}`);
    if (alarmMinutes > 0 && startMs != null && endMs > startMs) out.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Servizio', `TRIGGER:-PT${alarmMinutes}M`, 'END:VALARM');
    out.push('END:VEVENT');
    count++;
  };

  for (const duty of buildDuties(days)) {
    if (scope === 'flights' && duty.kind !== 'flight') continue;
    const date = isoDate(duty.startMs);
    if (!inRange(date)) continue;
    const loc = duty.ci?.airport ?? duty.legs[0]?.leg.dep;
    event(`${duty.startMs}-${duty.kind}`, dutySummary(duty), loc, describeDuty(duty, airports, date), duty.startMs, duty.endMs, date);
  }
  if (scope === 'all') {
    for (const day of days) {
      if (day.kind !== 'standby' || !inRange(day.date)) continue;
      const tl = buildDayTimeline(day);
      const name = day.code === 'RESERVE' ? 'Reserve' : 'Stand-by';
      event(`${day.date}-standby`, name, day.airport, `${name}${day.airport ? ` ${day.airport}` : ''}${tl.window ? `\n${fmtUtc(tl.window.startMs)}Z - ${fmtUtc(tl.window.endMs)}Z` : ''}`, tl.window?.startMs, tl.window?.endMs, day.date);
    }
  }
  out.push('END:VCALENDAR');
  return { text: out.map(fold).join('\r\n') + '\r\n', count };
}
