// Test della logica con dati inventati (nessun dato reale).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { timezoneFor } from '../src/tz.js';
import { buildDayTimeline, fmtUtc, localTime, utcOffsetHours } from '../src/timeline.js';
import { evaluateRecurrent, aircraftOf, statusFor } from '../src/recurrent.js';
import { diffDays } from '../src/diff.js';
import { mergeImports, changesFor, pendingChangeDates } from '../src/merge.js';
import { buildIcs } from '../src/ics.js';
import { monthSummary, rolling } from '../src/stats.js';

const AIRPORTS = { MXP: { country: 'ITALY' }, RMF: { country: 'EGYPT' }, FUE: { country: 'SPAIN' }, XXX: { country: 'ATLANTIS' } };

const day = (date, over = {}) => ({
  date, dow: 'Mon', kind: 'flight', code: null, airport: null, window: null, pickup: null,
  checkIn: { label: 'C/I', airport: 'MXP', time: '0530' }, checkOut: { label: 'C/O', airport: 'MXP', time: '1700' },
  legs: [
    { kind: 'flight', airline: 'NO', number: '100', dep: 'MXP', arr: 'RMF', depTime: '0630', arrTime: '1050', ac: 'B737', crew: null },
    { kind: 'flight', airline: 'NO', number: '101', dep: 'RMF', arr: 'MXP', depTime: '1140', arrTime: '1630', ac: 'B737', crew: null },
  ],
  hotel: null, ft: '09:10', dt: '11:30', simFt: '0:00', flags: [], notes: [], ...over,
});

test('fusi orari: aeroporto, eccezioni e paese', () => {
  assert.equal(timezoneFor('FUE', AIRPORTS), 'Atlantic/Canary'); // Spagna, ma fuso diverso
  assert.equal(timezoneFor('MXP', AIRPORTS), 'Europe/Rome');
  assert.equal(timezoneFor('RMF', AIRPORTS), 'Africa/Cairo');
  assert.equal(timezoneFor('XXX', AIRPORTS), null);
  assert.equal(timezoneFor(null, AIRPORTS), null);
});

test('ora locale: legale/solare e cambio data', () => {
  // 3 ottobre 2026: Italia in ora legale (UTC+2), Egitto UTC+3 (ora legale egiziana dal 2023)
  const d = day('2026-10-03');
  const tl = buildDayTimeline(d);
  assert.equal(fmtUtc(tl.legs[0].depMs), '06:30');
  assert.equal(localTime(tl.legs[0].depMs, 'MXP', AIRPORTS, d.date).time, '08:30');
  // inverno: 15 gennaio, Italia UTC+1
  const w = buildDayTimeline(day('2026-01-15'));
  assert.equal(localTime(w.legs[0].depMs, 'MXP', AIRPORTS, '2026-01-15').time, '07:30');
  assert.equal(utcOffsetHours(w.legs[0].depMs, 'MXP', AIRPORTS), 1);
  assert.equal(utcOffsetHours(w.legs[0].depMs, 'XXX', AIRPORTS), null);
});

test('servizio notturno: gli orari passano la mezzanotte UTC', () => {
  const d = day('2026-10-03', {
    checkIn: { label: 'C/I', airport: 'MXP', time: '2130' },
    legs: [{ kind: 'flight', airline: 'NO', number: '9', dep: 'MXP', arr: 'RMF', depTime: '2300', arrTime: '0300', ac: 'B737' }],
    checkOut: { label: 'C/O', airport: 'RMF', time: '0330' },
  });
  const tl = buildDayTimeline(d);
  assert.equal(new Date(tl.legs[0].arrMs).toISOString(), '2026-10-04T03:00:00.000Z');
  assert.equal(new Date(tl.endMs).toISOString(), '2026-10-04T03:30:00.000Z');
  assert.equal(localTime(tl.legs[0].arrMs, 'RMF', AIRPORTS, d.date).dayDelta, 1);
  assert.equal(localTime(tl.legs[0].arrMs, 'XXX', AIRPORTS, d.date), null);
});

test('scadenze: stati, soglie e gruppi per aeromobile', () => {
  assert.equal(aircraftOf('LC78'), 'B787');
  assert.equal(aircraftOf('OPC73'), 'B737');
  assert.equal(aircraftOf('Z2_73'), 'B737');
  assert.equal(aircraftOf('CRM_RT'), null);
  assert.equal(aircraftOf('SEC965RT'), null);
  assert.equal(statusFor(-1), 'expired');
  assert.equal(statusFor(10), 'critical');
  assert.equal(statusFor(60), 'warning');
  assert.equal(statusFor(200), 'ok');
  const ev = evaluateRecurrent([{ expiry: '2027-01-31', code: 'OPC73', nameRaw: 'Operator Proficiency Chec' }, { expiry: '2026-05-06', code: 'LC78', nameRaw: 'x' }], '2026-10-02');
  assert.equal(ev[0].code, 'LC78');
  assert.equal(ev[0].status, 'expired');
  assert.equal(ev[1].name, 'OPC (Operator Proficiency Check) B737');
  assert.equal(ev[1].daysLeft, 121);
});

test('diff: aggiunto, tolto, modificato, invariato', () => {
  const oldD = new Map([
    ['2026-10-01', day('2026-10-01')],
    ['2026-10-02', day('2026-10-02', { kind: 'off', legs: [], checkIn: null, checkOut: null })],
    ['2026-10-03', day('2026-10-03')],
    ['2026-10-04', day('2026-10-04')],
  ]);
  const changedLegs = day('2026-10-03');
  changedLegs.legs = [{ ...changedLegs.legs[0], depTime: '0700' }, changedLegs.legs[1]];
  const newD = new Map([
    ['2026-10-01', day('2026-10-01')],
    ['2026-10-02', day('2026-10-02')],
    ['2026-10-03', changedLegs],
    ['2026-10-04', day('2026-10-04', { kind: 'off', legs: [], checkIn: null, checkOut: null })],
    ['2026-10-05', day('2026-10-05')], // data nuova: non è una modifica
  ]);
  const r = diffDays(oldD, newD);
  assert.deepEqual(r.added.map((x) => x.date), ['2026-10-02']);
  assert.deepEqual(r.removed.map((x) => x.date), ['2026-10-04']);
  assert.deepEqual(r.changed.map((x) => x.date), ['2026-10-03']);
  assert.ok(r.changed[0].lines.includes('NO100 partenza: 06:30 → 07:00'));
  assert.equal(r.count, 3);
});

test('merge: vale l\'import più recente; modifiche in sospeso', () => {
  const mk = (id, importedAt, days, extra = {}) => ({ id, importedAt, roster: { meta: { periodStart: days[0].date, periodEnd: days.at(-1).date, printedAt: importedAt, pilotCode: 'AAA', pilotName: 'ROSSI, MARIO', base: 'MXP' }, days, totals: {}, airports: AIRPORTS, recurrent: [{ expiry: '2027-01-01', code: 'X' }] }, ...extra });
  const a = mk(1, '2026-10-01T10:00', [day('2026-10-01'), day('2026-10-02')]);
  const newRoster = mk(2, '2026-10-02T10:00', [day('2026-10-01', { ft: '10:00' }), day('2026-10-02')]).roster;
  const ch = changesFor([a], newRoster);
  assert.equal(ch.changed.length, 1);
  const b = { id: 2, importedAt: '2026-10-02T10:00', roster: newRoster, changes: ch, seen: false };
  const m = mergeImports([b, a]);
  assert.equal(m.days.get('2026-10-01').ft, '10:00');
  assert.equal(m.days.size, 2);
  assert.equal(pendingChangeDates([a, b]).get('2026-10-01').kind, 'changed');
  assert.equal(pendingChangeDates([a, { ...b, seen: true }]).size, 0);
});

test('ics: eventi, orari UTC, righe lunghe e caratteri speciali', () => {
  const d = day('2026-10-03', { hotel: { code: 'H1', name: 'HOTEL, CENTRO; (X)', phone: '+39 1' } });
  const off = day('2026-10-04', { kind: 'off', legs: [], checkIn: null, checkOut: null });
  const sby = day('2026-10-05', { kind: 'standby', code: 'STAND-BY', legs: [], checkIn: null, checkOut: null, window: { start: '0800', end: '1700' }, airport: 'MXP' });
  const { text, count } = buildIcs([d, off, sby], { MXP: { name: 'MILAN MALPENSA APT' } }, { scope: 'all', alarmMinutes: 120 }, Date.UTC(2026, 9, 2));
  assert.equal(count, 2);
  assert.ok(text.includes('DTSTART:20261003T053000Z'));
  assert.ok(text.includes('DTEND:20261003T170000Z'));
  assert.ok(text.includes('DTSTART:20261005T080000Z'));
  assert.ok(text.includes('TRIGGER:-PT120M'));
  assert.ok(text.includes('HOTEL\\, CENTRO\\; (X)'));
  assert.ok(text.includes('SUMMARY:✈ MXP-RMF-MXP NO100/NO101'));
  for (const line of text.split('\r\n')) assert.ok(new TextEncoder().encode(line).length <= 75, 'riga troppo lunga: ' + line);
  assert.equal(buildIcs([d, off, sby], {}, { scope: 'flights' }).count, 1);
  assert.equal(buildIcs([d, off, sby], {}, { scope: 'all', from: '2026-10-05', to: '2026-10-31' }).count, 1);
});

test('statistiche: riepilogo mese e finestre mobili', () => {
  const days = [day('2026-10-01'), day('2026-10-02', { kind: 'off', legs: [], ft: null, dt: null }), day('2026-10-03', { hotel: { code: 'H1' } })];
  const s = monthSummary(days);
  assert.equal(s.ft, 2 * 550);
  assert.equal(s.dt, 2 * 690);
  assert.equal(s.flightDays, 2);
  assert.equal(s.sectors, 4);
  assert.equal(s.offDays, 1);
  assert.equal(s.nights, 1);
  const map = new Map(days.map((d) => [d.date, d]));
  assert.equal(rolling(map, '2026-10-03', 3).ft, 1100);
  assert.equal(rolling(map, '2026-10-03', 2).ft, 550);
});

test('rotazioni: servizio notturno con pernottamento = una sola barra', async () => {
  const { buildTrips } = await import('../src/trips.js');
  const leg = (n, dep, arr, d, a) => ({ kind: 'flight', airline: 'NO', number: n, dep, arr, depTime: d, arrTime: a, ac: 'B737' });
  const d1 = day('2026-09-15', { checkIn: { label: 'C/I', airport: 'MXP', time: '0400' }, legs: [leg('1', 'MXP', 'BGY', '0500', '0800')], checkOut: { label: 'C/O', airport: 'BGY', time: '0830' }, hotel: { code: 'H1' } });
  const d2 = day('2026-09-16', { checkIn: { label: 'C/I', airport: 'BGY', time: '2310' }, legs: [], checkOut: null });
  const d3 = day('2026-09-17', { checkIn: null, legs: [leg('2', 'BGY', 'DSS', '0013', '0603')], checkOut: { label: 'C/O', airport: 'MXP', time: '0900' } });
  const d4 = day('2026-09-20', { legs: [leg('3', 'MXP', 'FUE', '0600', '0900')] });
  const trips = buildTrips([d1, d2, d3, d4], 'MXP');
  assert.equal(trips.length, 2);
  assert.deepEqual([trips[0].startDate, trips[0].endDate], ['2026-09-15', '2026-09-17']);
  assert.deepEqual(trips[0].stops, ['BGY', 'DSS']);
  assert.deepEqual([trips[1].startDate, trips[1].endDate, trips[1].stops], ['2026-09-20', '2026-09-20', ['FUE']]);
});

test('geo: distanze, rotte e tratte', async () => {
  const { distanceKm, greatCircle, collectRoutes } = await import('../src/geo.js');
  const { coordsFor } = await import('../src/airports-geo.js');
  const d = distanceKm(coordsFor('MXP'), coordsFor('JFK'));
  assert.ok(d > 6300 && d < 6600, `MXP-JFK ${d}`);
  const arc = greatCircle(coordsFor('MXP'), coordsFor('JFK'), 8);
  assert.equal(arc.length, 9);
  assert.ok(arc[4][0] > 50, 'la rotta verso New York sale verso nord'); // cerchio massimo, non linea retta
  assert.deepEqual(coordsFor('IBT'), coordsFor('BLQ'));
  const days = [day('2026-10-03'), day('2026-10-04')];
  days[1].legs = [{ kind: 'flight', airline: 'NO', number: '1', dep: 'MXP', arr: 'ZZZ', depTime: '0600', arrTime: '0900' }, { kind: 'transport', dep: 'RMI', arr: 'BLQ' }];
  const r = collectRoutes(days);
  assert.equal(r.sectors, 2); // MXP-RMF e RMF-MXP del primo giorno
  assert.equal(r.routes.length, 1);
  assert.equal(r.routes[0].count, 2);
  assert.deepEqual(r.missing, ['ZZZ']);
});

test('servizio che passa la mezzanotte a ora locale: il giorno dopo contiene la fine', async () => {
  const { dutyTails } = await import('../src/tails.js');
  const { buildTrips } = await import('../src/trips.js');
  // 5 ottobre: C/I 12:30Z, C/O 22:55Z = 00:55 del 6 a Milano (UTC+2)
  const d = day('2026-10-05', { checkIn: { label: 'C/I', airport: 'MXP', time: '1230' }, checkOut: { label: 'C/O', airport: 'MXP', time: '2255' } });
  d.legs = [
    { kind: 'flight', airline: 'NO', number: '1', dep: 'MXP', arr: 'FUE', depTime: '1330', arrTime: '1745', ac: 'B737' },
    { kind: 'flight', airline: 'NO', number: '2', dep: 'FUE', arr: 'MXP', depTime: '1835', arrTime: '2225', ac: 'B737' },
  ];
  const airports = { MXP: { country: 'ITALY' }, FUE: { country: 'SPAIN' } };
  const tails = dutyTails([d], airports, 'MXP');
  assert.deepEqual([...tails.keys()], ['2026-10-06']);
  assert.equal(tails.get('2026-10-06')[0].fromDate, '2026-10-05');
  const trips = buildTrips([d], 'MXP', airports);
  assert.deepEqual([trips[0].startDate, trips[0].endDate], ['2026-10-05', '2026-10-06']); // barra su due giorni
  assert.equal(buildTrips([d], 'MXP')[0].endDate, '2026-10-05'); // senza fusi si resta in UTC
  // un servizio che finisce prima di mezzanotte locale non lascia code
  const early = day('2026-10-07');
  assert.equal(dutyTails([early], airports, 'MXP').size, 0);
});

test('famiglia: casa, rotazione su più giorni, notti, UID stabili', async () => {
  const { buildFamilyIcs } = await import('../src/family.js');
  const airports = { MXP: { country: 'ITALY', name: 'MILAN MALPENSA APT' }, FUE: { country: 'SPAIN', name: 'FUERTEVENTURA' }, RMF: { country: 'EGYPT', name: 'MARSA ALAM' } };
  const off = (date) => day(date, { kind: 'off', code: 'OFF', legs: [], checkIn: null, checkOut: null, seq: [] });
  const fl = (n, dep, arr, d, a) => ({ kind: 'flight', airline: 'NO', number: n, dep, arr, depTime: d, arrTime: a, ac: 'B737' });
  // 5 ott: MXP-FUE-MXP; 6 ott: riposo; 7-8: MXP-RMF (notte a Marsa Alam) -RMF-MXP
  const a = day('2026-10-05', { legs: [fl('1620', 'MXP', 'FUE', '1330', '1745'), fl('1621', 'FUE', 'MXP', '1835', '2225')], checkIn: { label: 'C/I', airport: 'MXP', time: '1230' }, checkOut: { label: 'C/O', airport: 'MXP', time: '2255' } });
  const b = day('2026-10-07', { legs: [fl('7', 'MXP', 'RMF', '0600', '1000')], checkIn: { label: 'C/I', airport: 'MXP', time: '0500' }, checkOut: { label: 'C/O', airport: 'RMF', time: '1030' }, hotel: { code: 'H1', airport: 'RMF', name: 'Hotel; Mare' } });
  const c = day('2026-10-08', { legs: [fl('8', 'RMF', 'MXP', '1000', '1400')], checkIn: { label: 'C/I', airport: 'RMF', time: '0900' }, checkOut: { label: 'C/O', airport: 'MXP', time: '1430' } });
  const days = [a, off('2026-10-06'), b, c, off('2026-10-09')];
  const { text, count } = buildFamilyIcs(days, airports, { base: 'MXP' }, Date.UTC(2026, 9, 4));
  assert.ok(text.includes('SUMMARY:✈ MXP → FUE → MXP'));
  assert.ok(text.includes('SUMMARY:✈ MXP → RMF → MXP')); // rotazione di due giorni = un solo evento
  assert.ok(text.includes('SUMMARY:🏠 A casa'));
  assert.ok(text.includes('SUMMARY:🛏 Notte a Marsa Alam'));
  assert.ok(text.includes('DTSTART:20261005T133000Z') && text.includes('DTEND:20261005T222500Z')); // dal decollo all'atterraggio
  assert.ok(text.includes('UID:fam-trip-2026-10-05-0@dk3-roster-famiglia'));
  assert.ok(text.includes('UID:fam-day-2026-10-06@dk3-roster-famiglia'));
  // il 6 e il 9 sono a casa; il 7 e l'8 no (siamo in rotazione); il 5 finisce 00:55 del 6 ma l'evento è del 5 -> il 6 resta "casa"? no: copre anche il 6
  assert.ok(!text.includes('fam-day-2026-10-07') && !text.includes('fam-day-2026-10-08'));
  assert.ok(!/FDP|FTL|equipaggio|crew/i.test(text), 'nessun dato di lavoro nel calendario di famiglia');
  for (const line of text.split('\r\n')) assert.ok(new TextEncoder().encode(line).length <= 75, 'riga lunga: ' + line);
  // secondo invio: stessi UID anche se l'orario cambia, SEQUENCE più alto
  b.legs[0].depTime = '0630';
  const again = buildFamilyIcs(days, airports, { base: 'MXP' }, Date.UTC(2026, 9, 5));
  const uids = (t) => [...t.matchAll(/UID:(.+)@/g)].map((m) => m[1]).sort();
  assert.deepEqual(uids(again.text), uids(text));
  assert.ok(Number(/SEQUENCE:(\d+)/.exec(again.text)[1]) > Number(/SEQUENCE:(\d+)/.exec(text)[1]));
  assert.ok(count >= 5);
});
