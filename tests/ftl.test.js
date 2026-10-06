// Test delle regole FTL con dati inventati (numeri dell'OMA cap. 7 / EASA ORO.FTL).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { basicFdpMax, extFdpMax, unknownFdpMax, inflightRestMax, analyze } from '../src/ftl.js';

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
  assert.equal(d.limits.discretion, null); // niente discrezione sopra l'estensione
  assert.ok(d.notes.some((n) => /E_FDP/.test(n)));

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
  assert.ok(r.issues.some((i) => i.severity === 'info' && /estensione pianificata/.test(i.text)));
  assert.ok(!r.issues.some((i) => i.severity === 'bad'));
  r = analyze([mk('1800', [])], { base: 'MXP', airports: AP });
  assert.equal(r.duties[0].status, 'ext');
  assert.ok(r.issues.some((i) => /manca E_FDP|non c’è E_FDP/.test(i.text)));

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
  assert.ok(d.notes.some((n) => /E_FDP nel roster/.test(n)));
});
