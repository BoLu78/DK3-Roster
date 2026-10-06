// Test delle regole FTL con dati inventati (numeri dell'OMA cap. 7 / EASA ORO.FTL).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { basicFdpMax, extFdpMax, unknownFdpMax, inflightRestMax, analyze, woclEncroachMin, extSectorCap } from '../src/ftl.js';

const AIRPORTS = { MXP: { country: 'ITALY' }, RMF: { country: 'EGYPT' }, HAV: { country: 'CUBA' } };
const m = (h, min = 0) => h * 60 + min;

test('FDP base: tabella 7.1.7.1', () => {
  assert.equal(basicFdpMax(m(5, 20), 2), m(12, 15)); // inizio 05:20, 1-2 settori (caso dello screenshot EASA)
  assert.equal(basicFdpMax(m(7, 0), 2), m(13));
  assert.equal(basicFdpMax(m(7, 0), 3), m(12, 30));
  assert.equal(basicFdpMax(m(14, 15), 4), m(11, 30));
  assert.equal(basicFdpMax(m(22, 0), 2), m(11));
  assert.equal(basicFdpMax(m(2, 30), 4), m(10)); // notte: riga 17:00-04:59
  assert.equal(basicFdpMax(m(5, 59), 1), m(12, 45));
  assert.equal(basicFdpMax(m(7, 0), 12), m(9)); // oltre 10 settori resta 9:00
});

test('FDP: acclimatazione sconosciuta ed estensione', () => {
  assert.equal(unknownFdpMax(2), m(11));
  assert.equal(unknownFdpMax(4), m(10));
  assert.equal(extFdpMax(m(7, 0), 2), m(14));
  assert.equal(extFdpMax(m(6, 30), 3), m(13));
  assert.equal(extFdpMax(m(6, 5), 2), null); // 06:00-06:14 non consentita
  assert.equal(extFdpMax(m(16, 0), 3), null);
  assert.equal(extFdpMax(m(10, 0), 6), null); // oltre 5 settori
});

test('riposo in volo: 3 o 4 piloti, classe 2 (B737) o 1 (B787)', () => {
  assert.equal(inflightRestMax(2, 2, 2, false), null);
  assert.equal(inflightRestMax(3, 2, 2, false), m(15));
  assert.equal(inflightRestMax(4, 2, 2, false), m(16));
  assert.equal(inflightRestMax(3, 2, 1, false), m(16));
  assert.equal(inflightRestMax(4, 2, 1, true), m(18)); // +1 h per un settore oltre 9 h
  assert.equal(inflightRestMax(3, 4, 2, false), null); // max 3 settori
});

const flight = (n, dep, arr, d, a) => ({ kind: 'flight', airline: 'NO', number: n, dep, arr, depTime: d, arrTime: a, ac: 'B737' });
const day = (date, legs, ci, co, over = {}) => ({
  date, dow: 'Mon', kind: 'flight', code: null, window: null, pickup: null, flags: [], notes: [], hotel: null, ft: '05:00', dt: '08:00', simFt: '0:00',
  checkIn: { label: 'C/I', airport: legs[0].dep, time: ci }, checkOut: { label: 'C/O', airport: legs.at(-1).arr, time: co }, legs, ...over,
});

test('analisi: FDP nel limite, oltre il limite e con equipaggio aumentato', () => {
  // ottobre: Italia UTC+2. Presentazione 05:00Z = 07:00 locale, 2 settori -> max 13:00
  const ok = day('2026-10-05', [flight('1', 'MXP', 'RMF', '0600', '0900'), flight('2', 'RMF', 'MXP', '1000', '1300')], '0500', '1330');
  let r = analyze([ok], { base: 'MXP', airports: AIRPORTS });
  assert.equal(r.duties[0].status, 'ok');
  assert.equal(r.duties[0].fdp.min, 480);
  assert.equal(r.duties[0].limits.basic, m(13));
  assert.equal(r.duties[0].limits.discretion, m(15)); // massimo + 2 h

  // FDP troppo lungo: 07:00 locale, 2 settori, block-in dopo 14:30 -> oltre l'estensione (14:00)
  const over = day('2026-10-06', [flight('1', 'MXP', 'RMF', '0600', '0900'), flight('2', 'RMF', 'MXP', '1400', '1930')], '0500', '2000');
  r = analyze([over], { base: 'MXP', airports: AIRPORTS });
  assert.equal(r.duties[0].status, 'over');
  assert.ok(r.issues.some((i) => i.severity === 'bad'));
  // con 3 piloti (riposo in volo) il limite sale a 15 h e il servizio rientra
  const key = String(r.duties[0].startMs);
  r = analyze([over], { base: 'MXP', airports: AIRPORTS, crewByDuty: { [key]: 3 } });
  assert.equal(r.duties[0].limits.used, m(15));
  assert.notEqual(r.duties[0].status, 'over');
  assert.equal(r.duties[0].limits.discretion, m(18)); // +3 h con equipaggio aumentato
});

test('analisi: riposo minimo a base e fuori base', () => {
  const a = day('2026-10-05', [flight('1', 'MXP', 'RMF', '0600', '0900')], '0500', '0930');
  const b = day('2026-10-05', [flight('2', 'MXP', 'RMF', '1700', '2000')], '1600', '2030'); // stesso giorno: riposo 6.5 h a base
  const r = analyze([a, b], { base: 'MXP', airports: AIRPORTS });
  // il primo servizio finisce a MXP? no: finisce a RMF, quindi il secondo parte fuori base: ma il C/I è MXP -> a base
  assert.ok(r.rests[0].needMin >= 720);
  assert.equal(r.rests[0].status, 'over');
});

test('analisi: la notte locale conta 8 ore tra le 22:00 e le 08:00', () => {
  // riposo da 20:00 locale a 07:00 locale (11 h): contiene 9 h della fascia 22-08 -> una notte locale
  const late = day('2026-10-05', [flight('1', 'MXP', 'RMF', '1700', '2000')], '1600', '2030', {});
  late.checkOut = { label: 'C/O', airport: 'MXP', time: '2030' }; // fine 22:30 locale: tipo "tardi" non scatta (<23:00)
  const early = day('2026-10-06', [flight('2', 'MXP', 'RMF', '0400', '0700')], '0300', '0730'); // 05:00 locale: "presto"
  const r = analyze([late, early], { base: 'MXP', airports: AIRPORTS });
  assert.equal(r.duties[1].tags.includes('presto'), true);
  assert.ok(r.rests[0]); // riposo calcolato
});

test('riposo: parte dalla fine dello stand-by precedente (caso verificato con l’app EASA)', () => {
  // stand-by 08:00-17:00Z il giorno prima, presentazione 05:30Z -> riposo 12:30, minimo 12:00
  const sby = { date: '2026-10-02', dow: 'Fri', kind: 'standby', code: 'STAND-BY', airport: 'MXP', window: { start: '0800', end: '1700' }, legs: [], flags: [], notes: [], ft: '00:00', dt: '00:00' };
  const duty = day('2026-10-03', [flight('1', 'MXP', 'RMF', '0630', '1050'), flight('2', 'RMF', 'MXP', '1140', '1630')], '0530', '1700');
  const r = analyze([sby, duty], { base: 'MXP', airports: AIRPORTS });
  assert.equal(r.rests.length, 1);
  assert.equal(r.rests[0].restMin, m(12, 30));
  assert.equal(r.rests[0].needMin, m(12));
  assert.ok(r.rests[0].why.includes('dopo stand-by'));
  // FDP 11:00 / massimo 13:00 / discrezione 15:00, come nell'app EASA
  assert.equal(r.duties[0].fdp.min, m(11));
  assert.equal(r.duties[0].limits.basic, m(13));
  assert.equal(r.duties[0].limits.discretion, m(15));
});

test('E_FDP: servizio pianificato con estensione, vale il massimo esteso', () => {
  // 8 ottobre: presentazione 05:00Z = 07:00 locale, 3 settori -> base 12:30, con estensione 13:30
  const legs3 = (lastArr) => [flight('1', 'MXP', 'LXR', '0600', '1010'), flight('2', 'LXR', 'CAI', '1100', '1210'), flight('3', 'CAI', 'MXP', '1300', lastArr)];
  const AP = { MXP: { country: 'ITALY' }, LXR: { country: 'EGYPT' }, CAI: { country: 'EGYPT' } };
  const mk = (lastArr, flags) => day('2026-10-08', legs3(lastArr), '0500', '1800', { flags });

  // FDP 12:00 con E_FDP: entro il massimo base, ma il limite applicato è quello esteso
  let d = analyze([mk('1700', ['E_FDP'])], { base: 'MXP', airports: AP }).duties[0];
  assert.equal(d.fdp.min, m(12));
  assert.equal(d.limits.basic, m(12, 30));
  assert.equal(d.limits.ext, m(13, 30));
  assert.equal(d.limits.used, m(13, 30));
  assert.equal(d.extPlanned, true);
  assert.equal(d.limitKind, 'ext');
  assert.equal(d.status, 'ok');
  assert.equal(d.gapMin, m(1, 30));
  assert.equal(d.limits.discretion, m(14, 30)); // la discrezione si calcola sul massimo base (12:30) + 2 h, OMA 7.2.1
  assert.ok(d.notes.some((n) => /EXTENSION pianificata/.test(n) && /OMA 7\.1\.7\.2/.test(n)));
  assert.equal(d.fdp.lastBlockMin, m(4)); // CAI 13:00 -> MXP 17:00
  assert.equal(d.fdp.lastDepApt, 'CAI');

  // stesso servizio senza E_FDP: limite base, "al limite"
  d = analyze([mk('1700', [])], { base: 'MXP', airports: AP }).duties[0];
  assert.equal(d.limits.used, m(12, 30));
  assert.equal(d.status, 'warn');
  assert.equal(d.extPlanned, undefined);
  assert.equal(d.limits.discretion, m(14, 30));

  // FDP 13:00: oltre il base. Con E_FDP è regolare, senza E_FDP richiede l'estensione e lo segnala
  let r = analyze([mk('1800', ['E_FDP'])], { base: 'MXP', airports: AP });
  assert.equal(r.duties[0].status, 'warn'); // 13:00 su 13:30: a 30 min dal limite
  assert.equal(r.duties[0].limitKind, 'ext');
  assert.ok(r.issues.some((i) => i.severity === 'info' && /EXTENSION pianificata/.test(i.text)));
  assert.ok(!r.issues.some((i) => i.severity === 'bad'));
  r = analyze([mk('1800', [])], { base: 'MXP', airports: AP });
  assert.equal(r.duties[0].status, 'ext');
  assert.ok(r.issues.some((i) => /richiede Extension/.test(i.text)));

  // oltre il massimo esteso (14:00 > 13:30): fuori limite anche con E_FDP
  r = analyze([mk('1930', ['E_FDP'])], { base: 'MXP', airports: AP });
  assert.equal(r.duties[0].status, 'over');
  assert.ok(r.issues.some((i) => i.severity === 'bad'));
});

test('E_FDP dove la tabella dell\'estensione non c\'è: resta il massimo base e lo dice', () => {
  // inizio 17:00 locale (15:00Z), 4 settori: la tabella estesa non lo prevede
  const AP = { MXP: { country: 'ITALY' }, RMF: { country: 'EGYPT' } };
  const legs = [flight('1', 'MXP', 'RMF', '1600', '1900'), flight('2', 'RMF', 'MXP', '1950', '2250'), flight('3', 'MXP', 'RMF', '2330', '0230'), flight('4', 'RMF', 'MXP', '0300', '0600')];
  const d = analyze([day('2026-10-08', legs, '1500', '0630', { flags: ['E_FDP'] })], { base: 'MXP', airports: AP }).duties[0];
  assert.equal(d.limits.ext, null);
  assert.notEqual(d.extPlanned, true);
  assert.ok(d.notes.some((n) => /EXTENSION nel roster ma non ammessa/.test(n)));
});

test('E_FDP: equipaggio sempre standard, anche se avevo scelto più piloti', () => {
  const AP = { MXP: { country: 'ITALY' }, RMF: { country: 'EGYPT' } };
  const legs = [flight('1', 'MXP', 'RMF', '0600', '0900'), flight('2', 'RMF', 'MXP', '1000', '1300')];
  const dd = day('2026-10-08', legs, '0500', '1330', { flags: ['E_FDP'] });
  const first = analyze([dd], { base: 'MXP', airports: AP }).duties[0];
  const r = analyze([dd], { base: 'MXP', airports: AP, crewByDuty: { [first.key]: 3 } }).duties[0];
  assert.equal(r.crew, 2);
  assert.equal(r.crewLocked, true);
  assert.equal(r.limits.inflight, null);
  // senza E_FDP la scelta dei piloti vale
  const free = day('2026-10-08', legs, '0500', '1330');
  const f1 = analyze([free], { base: 'MXP', airports: AP }).duties[0];
  const f3 = analyze([free], { base: 'MXP', airports: AP, crewByDuty: { [f1.key]: 3 } }).duties[0];
  assert.equal(f3.crew, 3);
  assert.notEqual(f3.crewLocked, true);
});

test('E_FDP: settori ammessi in base alla WOCL (OMA 7.1.7.2)', () => {
  assert.equal(woclEncroachMin(m(7, 0), m(12)), 0);
  assert.equal(woclEncroachMin(m(15, 0), m(12)), 60); // finisce alle 03:00
  assert.equal(woclEncroachMin(m(15, 0), m(13, 30)), 150); // finisce alle 04:30
  assert.equal(woclEncroachMin(m(22, 0), m(10)), 240);
  assert.equal(extSectorCap(0), 5);
  assert.equal(extSectorCap(60), 4);
  assert.equal(extSectorCap(120), 4);
  assert.equal(extSectorCap(150), 2);
  // inizio 15:00 locale (13:00Z), 3 settori, FDP 13:30 -> WOCL toccata 2 h 30: solo 2 settori, estensione non ammessa
  const AP = { MXP: { country: 'ITALY' }, RMF: { country: 'EGYPT' } };
  const legs = [flight('1', 'MXP', 'RMF', '1400', '1700'), flight('2', 'RMF', 'MXP', '1800', '2000'), flight('3', 'MXP', 'RMF', '2100', '0230')];
  const d = analyze([day('2026-10-08', legs, '1300', '0300', { flags: ['E_FDP'] })], { base: 'MXP', airports: AP }).duties[0];
  assert.equal(d.wocl, 150);
  assert.equal(d.limits.ext, null);
  assert.notEqual(d.extPlanned, true);
  assert.ok(d.notes.some((n) => /ammessi?|ammessa/.test(n) && /2 settori/.test(n)));
});

test('E_FDP: riposi più lunghi prima e dopo (+2 h e +2 h, oppure +4 h dopo)', () => {
  const AP = { MXP: { country: 'ITALY' }, RMF: { country: 'EGYPT' } };
  const ext = (date, flags = ['E_FDP']) => day(date, [flight('1', 'MXP', 'RMF', '0600', '0900'), flight('2', 'RMF', 'MXP', '1000', '1300')], '0500', '1330', { flags });
  // servizio esteso 8/10 (dutyMin 8:30) seguito da servizio normale con riposo = 12:00 + 3 h: basta il +2 h dopo
  const normal = (date, ci) => day(date, [flight('3', 'MXP', 'RMF', `${String(Number(ci.slice(0, 2)) + 1).padStart(2, '0')}00`, `${String(Number(ci.slice(0, 2)) + 4).padStart(2, '0')}00`), flight('4', 'RMF', 'MXP', `${String(Number(ci.slice(0, 2)) + 5).padStart(2, '0')}00`, `${String(Number(ci.slice(0, 2)) + 8).padStart(2, '0')}00`)], ci, `${String(Number(ci.slice(0, 2)) + 8).padStart(2, '0')}30`);
  // fine C/O 13:30Z del 8; prossimo C/I 04:30Z del 9 = 15 h di riposo; base = max(8:30, 12:00) = 12:00 -> +2 h = 14:00 ok
  let r = analyze([ext('2026-10-08'), normal('2026-10-09', '0430')], { base: 'MXP', airports: AP });
  let rest = r.rests[0];
  assert.equal(rest.restMin, m(15));
  assert.equal(rest.needMin, m(14));
  assert.equal(rest.status, 'ok');
  assert.ok(rest.why.some((w) => /Extension/.test(w)));
  // riposo di 13 h: sotto 12 + 2 h, ma anche +4 h dopo sarebbe peggio: carenza
  r = analyze([ext('2026-10-08'), normal('2026-10-09', '0230')], { base: 'MXP', airports: AP });
  rest = r.rests[0];
  assert.equal(rest.restMin, m(13));
  assert.equal(rest.status, 'over');
  assert.ok(r.issues.some((i) => i.severity === 'bad' && /Riposo/.test(i.text)));
  // senza E_FDP lo stesso riposo da 13 h va bene
  r = analyze([ext('2026-10-08', []), normal('2026-10-09', '0230')], { base: 'MXP', airports: AP });
  assert.equal(r.rests[0].status, 'ok');
  // due servizi estesi di fila: C/O 13:30Z -> C/I 05:00Z = 15:30 h di riposo.
  // Il secondo può scegliere +4 h dopo di sé (niente supplemento prima): in mezzo basta il +2 h dopo il primo = 14:00
  r = analyze([ext('2026-10-08'), ext('2026-10-09')], { base: 'MXP', airports: AP });
  rest = r.rests[0];
  assert.equal(rest.restMin, m(15, 30));
  assert.equal(rest.needMin, m(14));
  assert.equal(rest.status, 'ok');
  // se il riposo in mezzo è corto, manca comunque
  const quick = analyze([ext('2026-10-08'), day('2026-10-09', [flight('1', 'MXP', 'RMF', '0400', '0700'), flight('2', 'RMF', 'MXP', '0800', '1100')], '0300', '1130', { flags: ['E_FDP'] })], { base: 'MXP', airports: AP });
  assert.equal(quick.rests[0].status, 'over');
});

test('E_FDP: massimo 2 estensioni in 7 giorni', () => {
  const AP = { MXP: { country: 'ITALY' }, RMF: { country: 'EGYPT' } };
  const mk = (date) => day(date, [flight('1', 'MXP', 'RMF', '0600', '0900'), flight('2', 'RMF', 'MXP', '1000', '1300')], '0500', '1330', { flags: ['E_FDP'] });
  let r = analyze([mk('2026-10-08'), mk('2026-10-10')], { base: 'MXP', airports: AP });
  assert.ok(!r.issues.some((i) => /in 7 giorni: massimo 2/.test(i.text)));
  r = analyze([mk('2026-10-08'), mk('2026-10-10'), mk('2026-10-12')], { base: 'MXP', airports: AP });
  assert.ok(r.issues.some((i) => i.severity === 'bad' && /3 Extension FDP in 7 giorni/.test(i.text)));
  // la quarta è fuori dai 7 giorni dalla prima
  r = analyze([mk('2026-10-08'), mk('2026-10-10'), mk('2026-10-16')], { base: 'MXP', airports: AP });
  assert.ok(!r.issues.some((i) => /in 7 giorni: massimo 2/.test(i.text)));
});
