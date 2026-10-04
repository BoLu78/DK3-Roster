// Calendario "per la famiglia": solo dove sei e quando, senza dati di lavoro (FTL, equipaggi, FDP).
//  - giorno di riposo o ferie -> "🏠 A casa" (evento di tutto il giorno)
//  - stand-by / reserve -> "⏳ Stand-by 10:00–19:00" (reperibile: non è tempo libero)
//  - rotazione (anche su più giorni) -> un evento dal decollo all'atterraggio con la rotta
//  - notte in hotel -> "🛏 Notte a Rimini"
// Gli identificativi (UID) sono stabili: importando di nuovo il file gli eventi cambiati si aggiornano
// sul calendario condiviso invece di duplicarsi.
import { buildDayTimeline, fmtUtc, localTime } from './timeline.js';
import { buildTrips } from './trips.js';
import { routeOfLegs, flightNumbersOf } from './ics.js';
import { icsDate, esc, fold } from './ics.js';

const addDay = (iso) => new Date(Date.parse(iso + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
const dayBefore = (iso) => new Date(Date.parse(iso + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
const titleCase = (s) => (s ?? '').toLowerCase().replace(/(^|[\s(-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase());
const WD = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];
const dayLabel = (iso) => `${WD[new Date(iso + 'T00:00:00Z').getUTCDay()]} ${Number(iso.slice(8))}/${iso.slice(5, 7)}`;

function cityOf(apt, airports) {
  const n = airports?.[apt]?.name;
  return n ? titleCase(n.replace(/\s+APT$/i, '').replace(/ rail station$/i, '')) : apt;
}

// options: { base, from, to, flightNumbers: true }
export function buildFamilyIcs(days, airports, options = {}, nowMs = Date.now()) {
  const { base = 'MXP', from = null, to = null, flightNumbers = true } = options;
  const sorted = [...days].filter((d) => !d.spill).sort((a, b) => a.date.localeCompare(b.date));
  const trips = buildTrips([...days].sort((a, b) => a.date.localeCompare(b.date)), base, airports);
  const inRange = (date) => (!from || date >= from) && (!to || date <= to);
  const seq = Math.floor(nowMs / 1000); // sempre crescente: l'evento nuovo vince su quello già nel calendario
  const out = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//DK3 Roster//Famiglia//IT', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Turni'];
  let count = 0;

  const head = (uid, summary) => out.push('BEGIN:VEVENT', `UID:${uid}@dk3-roster-famiglia`, `DTSTAMP:${icsDate(nowMs)}`, `LAST-MODIFIED:${icsDate(nowMs)}`, `SEQUENCE:${seq}`, `SUMMARY:${esc(summary)}`);
  const allDay = (uid, date, summary, description) => {
    head(uid, summary);
    out.push(`DTSTART;VALUE=DATE:${date.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${addDay(date).replace(/-/g, '')}`, 'TRANSP:TRANSPARENT');
    if (description) out.push(`DESCRIPTION:${esc(description)}`);
    out.push('END:VEVENT');
    count++;
  };

  // ---- rotazioni
  const covered = new Set();
  const perStart = new Map();
  for (const trip of trips) {
    // se rientri a casa la mattina presto (es. 00:55) l'ultimo giorno è "a casa", non "fuori"
    const lastLeg = [...trip.duties.at(-1).legs].reverse().find((l) => l.arrMs != null);
    const endLocal = lastLeg ? localTime(trip.endMs, lastLeg.leg.arr, airports, null)?.time ?? '99:99' : '99:99';
    const lastOut = trip.endDate > trip.startDate && endLocal < '12:00' ? dayBefore(trip.endDate) : trip.endDate;
    for (let d = trip.startDate; d <= lastOut; d = addDay(d)) covered.add(d);
    if (!inRange(trip.startDate) && !inRange(trip.endDate)) continue;
    const n = perStart.get(trip.startDate) ?? 0;
    perStart.set(trip.startDate, n + 1);
    const legs = trip.duties.flatMap((d) => d.legs);
    const first = legs.find((l) => l.depMs != null);
    const last = [...legs].reverse().find((l) => l.arrMs != null);
    if (!first || !last) continue;
    const route = routeOfLegs(legs.map((l) => l.leg)).split('-').join(' → ');
    const title = trip.kind === 'sim' ? `Simulatore${first.leg.dep ? ` (${first.leg.dep})` : ''}` : trip.kind === 'flight' ? `✈ ${route}` : `➜ Trasferimento ${route}`;
    const hm = (ms, apt) => localTime(ms, apt, airports, null)?.time ?? fmtUtc(ms) + 'Z';
    const lines = [];
    let lastDate = null;
    for (const l of legs) {
      const date = localTime(l.depMs, l.leg.dep, airports, null)?.localDate ?? new Date(l.depMs).toISOString().slice(0, 10);
      if (date !== lastDate) {
        lines.push(`— ${dayLabel(date)}`);
        lastDate = date;
      }
      const name = l.leg.kind === 'flight' && flightNumbers ? `${l.leg.airline ?? ''}${l.leg.number} ` : '';
      lines.push(`${name}${l.leg.dep} ${hm(l.depMs, l.leg.dep)} → ${l.leg.arr} ${hm(l.arrMs, l.leg.arr)}`);
    }
    lines.push('(orari locali di ogni aeroporto)');
    head(`fam-trip-${trip.startDate}-${n}`, title);
    out.push(`DTSTART:${icsDate(first.depMs)}`, `DTEND:${icsDate(Math.max(last.arrMs, first.depMs + 60000))}`);
    out.push(`LOCATION:${esc(`${first.leg.dep} → ${last.leg.arr}`)}`, `DESCRIPTION:${esc(lines.join('\n'))}`, 'END:VEVENT');
    count++;
  }

  // ---- notti in hotel e giorni a casa
  for (const day of sorted) {
    if (!inRange(day.date)) continue;
    if (day.hotel?.airport && covered.has(day.date)) {
      const city = cityOf(day.hotel.airport, airports);
      const hotel = [day.hotel.name, day.hotel.phone].filter(Boolean).join(' · ');
      allDay(`fam-night-${day.date}`, day.date, `🛏 Notte a ${city}`, hotel ? `Hotel: ${hotel}` : '');
    }
    if (covered.has(day.date)) continue;
    // "A casa" solo per riposo e ferie: stand-by e reserve sono lavoro (reperibile), non tempo libero
    let title = '🏠 A casa';
    let description = '';
    if (day.kind === 'vacation') title = '🏠 A casa · ferie';
    else if (day.kind === 'standby') {
      const tl = buildDayTimeline(day);
      const hm = (ms) => localTime(ms, day.airport ?? base, airports, null)?.time ?? '?';
      const window = tl.window ? `${hm(tl.window.startMs)}–${hm(tl.window.endMs)}` : '';
      title = day.code === 'RESERVE' ? '⏳ Reserve' : `⏳ Stand-by${window ? ` ${window}` : ''}`;
      description = `Reperibile: può essere chiamato a lavorare${window ? ` (${window})` : ''}`;
    }
    allDay(`fam-day-${day.date}`, day.date, title, description);
  }

  out.push('END:VCALENDAR');
  return { text: out.map(fold).join('\r\n') + '\r\n', count };
}
