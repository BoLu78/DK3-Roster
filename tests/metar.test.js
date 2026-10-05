// Test di lettura METAR/TAF con messaggi inventati o presi da esempi pubblici di formato (nessuna rete).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveDay, parseMetar, parseTaf, evaluateWindow, isTs, isFog } from '../src/metar.js';

const REF = Date.parse('2026-10-05T10:00:00Z');
const Z = (s) => Date.parse(s);

const TAF_FUE = 'TAF GCFV 050200Z 0503/0603 04012KT 9999 FEW015 TX28/0514Z TN22/0506Z PROB40 TEMPO 0503/0507 BKN010 TEMPO 0503/0509 32005KT PROB40 TEMPO 0514/0603 TS FEW090CB PROB40 TEMPO 0518/0603 VRB05KT PROB30 TEMPO 0523/0603 BKN010';
const TAF_MXP = 'TAF LIMC 050500Z 0506/0612 VRB05KT 9999 SCT060 PROB40 TEMPO 0516/0519 SHRA';

test('date dei gruppi: mese giusto anche a cavallo di mese', () => {
  assert.equal(resolveDay(5, 14, 0, REF), Z('2026-10-05T14:00:00Z'));
  assert.equal(resolveDay(1, 3, 0, Z('2026-09-30T22:00:00Z')), Z('2026-10-01T03:00:00Z'));
  assert.equal(resolveDay(30, 22, 0, Z('2026-10-01T02:00:00Z')), Z('2026-09-30T22:00:00Z'));
  assert.equal(resolveDay(6, 24, 0, REF), Z('2026-10-07T00:00:00Z')); // 24 = mezzanotte
});

test('METAR: MXP sereno e FUE con nubi', () => {
  const m = parseMetar('METAR LIMC 050750Z VRB01KT CAVOK 17/14 Q1024 NOSIG', REF);
  assert.equal(m.station, 'LIMC');
  assert.equal(m.timeMs, Z('2026-10-05T07:50:00Z'));
  assert.equal(m.cavok, true);
  assert.equal(m.visM, 9999);
  assert.equal(m.wind.dir, null);
  assert.equal(m.wind.speed, 1);
  assert.equal(m.temp, 17);
  assert.equal(m.dew, 14);
  assert.equal(m.qnh, 1024);
  assert.equal(m.nosig, true);
  const f = parseMetar('METAR GCFV 050730Z 35006KT 9999 FEW015 24/21 Q1016', REF);
  assert.deepEqual(f.wind, { dir: 350, speed: 6, gust: null });
  assert.equal(f.clouds[0].baseFt, 1500);
  assert.equal(f.ceilingFt, null);
});

test('METAR: fenomeni, raffiche, RVR, temperature negative e tendenza', () => {
  const m = parseMetar('LIMC 052250Z 18012G25KT 0400 R35R/0600V0900N FG VV002 M02/M03 Q1030 BECMG 1500 BR=', REF);
  assert.equal(m.wind.gust, 25);
  assert.equal(m.visM, 400);
  assert.deepEqual(m.rvr, [{ rwy: '35R', m: 600 }]);
  assert.ok(isFog(m.wx));
  assert.equal(m.ceilingFt, 200);
  assert.equal(m.temp, -2);
  assert.equal(m.dew, -3);
  assert.equal(m.trend.kind, 'BECMG');
  assert.equal(m.trend.visM, 1500);
  const t = parseMetar('METAR LICC 051020Z 20015KT 4000 +TSRA BKN012CB SCT030 22/20 Q1008 TEMPO 2000', REF);
  assert.ok(isTs(t.wx));
  assert.ok(t.cb);
  assert.equal(t.ceilingFt, 1200);
  assert.equal(parseMetar('spazzatura', REF), null);
});

test('METAR: pressione in pollici e visibilità in miglia', () => {
  const m = parseMetar('KJFK 051051Z 28010KT 10SM FEW250 18/09 A3012', REF);
  assert.equal(m.qnh, 1020);
  assert.ok(m.visM >= 9999 || m.visM === 16090);
  assert.equal(parseMetar('KJFK 051051Z 28010KT P6SM FEW250 18/09 A3012', REF).visM, 9999);
});

test('TAF FUE: gruppi e finestre', () => {
  const taf = parseTaf(TAF_FUE, REF);
  assert.equal(taf.station, 'GCFV');
  assert.equal(taf.validFrom, Z('2026-10-05T03:00:00Z'));
  assert.equal(taf.validTo, Z('2026-10-06T03:00:00Z'));
  assert.deepEqual(taf.periods.map((p) => [p.kind, p.prob]), [['BASE', null], ['PROB-TEMPO', 40], ['TEMPO', null], ['PROB-TEMPO', 40], ['PROB-TEMPO', 40], ['PROB-TEMPO', 30]]);
  const ts = taf.periods[3];
  assert.equal(ts.from, Z('2026-10-05T14:00:00Z')); // 0514/0603 = dalle 14Z di oggi alle 03Z di domani
  assert.equal(ts.to, Z('2026-10-06T03:00:00Z'));
  assert.ok(ts.cb);
  assert.ok(isTs(ts.wx));

  // arrivo 17:45Z: finestra 16:45-18:45
  const w = evaluateWindow(taf, Z('2026-10-05T16:45:00Z'), Z('2026-10-05T18:45:00Z'));
  assert.equal(w.covered, true);
  assert.equal(w.prevailing.visM, 9999);
  assert.equal(w.prevailing.windKt, 12);
  assert.equal(w.prevailing.windDir, 40);
  assert.equal(w.prevailing.cb, false);
  assert.equal(w.tempo, null);
  assert.equal(w.prob40.cb, true);
  assert.ok(isTs(w.prob40.wx));
  assert.equal(w.prob30, null);
  const inWin = w.groups.filter((g) => g.inWindow).map((g) => g.raw);
  assert.equal(inWin.length, 3); // base + PROB40 TS + PROB40 vento variabile
  assert.ok(inWin.some((r) => r.includes('TS FEW090CB')));

  // alle 05-06Z ci sono il PROB40 BKN010 e il TEMPO di vento, ma niente TS
  const mattina = evaluateWindow(taf, Z('2026-10-05T05:00:00Z'), Z('2026-10-05T06:00:00Z'));
  assert.equal(mattina.tempo.windDir, 320);
  assert.equal(mattina.prob40.ceilingFt, 1000);
  assert.equal(mattina.prob40.cb, false);

  // fuori validità
  assert.equal(evaluateWindow(taf, Z('2026-10-07T10:00:00Z'), Z('2026-10-07T12:00:00Z')).partial, false);
});

test('TAF MXP: SHRA solo dalle 16 alle 19Z, non al ritorno', () => {
  const taf = parseTaf(TAF_MXP, REF);
  assert.equal(taf.validTo, Z('2026-10-06T12:00:00Z'));
  const ritorno = evaluateWindow(taf, Z('2026-10-05T21:25:00Z'), Z('2026-10-05T23:25:00Z'));
  assert.equal(ritorno.covered, true);
  assert.equal(ritorno.prob40, null);
  assert.equal(ritorno.prevailing.ceilingFt, null); // SCT060: nessun ceiling
  const pomeriggio = evaluateWindow(taf, Z('2026-10-05T16:30:00Z'), Z('2026-10-05T17:30:00Z'));
  assert.deepEqual(pomeriggio.prob40.wx, ['SHRA']);
});

test('TAF: BECMG, FM e peggiore durante la transizione', () => {
  const raw = 'TAF LIMC 051100Z 0512/0618 18008KT 9999 SCT040 BECMG 0600/0602 0300 FG VV001 FM060800 21010KT 9999 FEW030 TEMPO 0610/0614 4000 TSRA BKN020CB';
  const taf = parseTaf(raw, REF);
  assert.deepEqual(taf.periods.map((p) => p.kind), ['BASE', 'BECMG', 'FM', 'TEMPO']);
  const prima = evaluateWindow(taf, Z('2026-10-05T22:00:00Z'), Z('2026-10-05T23:00:00Z'));
  assert.equal(prima.prevailing.visM, 9999);
  const nebbia = evaluateWindow(taf, Z('2026-10-06T03:00:00Z'), Z('2026-10-06T04:00:00Z'));
  assert.equal(nebbia.prevailing.visM, 300);
  assert.equal(nebbia.prevailing.ceilingFt, 100);
  assert.ok(isFog(nebbia.prevailing.wx));
  const transizione = evaluateWindow(taf, Z('2026-10-06T00:30:00Z'), Z('2026-10-06T01:30:00Z'));
  assert.equal(transizione.prevailing.visM, 300); // durante il BECMG conta il peggiore
  const dopoFm = evaluateWindow(taf, Z('2026-10-06T09:00:00Z'), Z('2026-10-06T09:30:00Z'));
  assert.equal(dopoFm.prevailing.visM, 9999);
  assert.deepEqual(dopoFm.prevailing.wx, []);
  const temporale = evaluateWindow(taf, Z('2026-10-06T11:00:00Z'), Z('2026-10-06T12:00:00Z'));
  assert.equal(temporale.tempo.visM, 4000);
  assert.equal(temporale.tempo.cb, true);
  assert.equal(temporale.prevailing.cb, false);
});

test('TAF: formati strani non rompono la lettura', () => {
  assert.equal(parseTaf('', REF), null);
  assert.equal(parseTaf('TAF NIL', REF), null);
  const amd = parseTaf('TAF AMD LEBL 051130Z 0512/0618 VRB03KT CAVOK', REF);
  assert.equal(amd.station, 'LEBL');
  assert.equal(amd.periods[0].cavok, true);
  assert.equal(evaluateWindow(amd, Z('2026-10-05T14:00:00Z'), Z('2026-10-05T16:00:00Z')).prevailing.visM, 9999);
});
