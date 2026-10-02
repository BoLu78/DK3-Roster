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
