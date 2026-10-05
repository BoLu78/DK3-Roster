// Test del briefing con meteo inventato e regole con numeri di prova (non quelli della compagnia).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTaf, parseMetar } from '../src/metar.js';
import { normalizeRules, approachFor, landingMinima, planningMinima } from '../src/rules.js';
import { briefDay, statusAgainst, tokenLevel, threatsForWindow } from '../src/briefing.js';
import { evaluateWindow } from '../src/metar.js';
import { icaoFor, iataFor, nearestAirports } from '../src/icao.js';
import { sunElevation, sunEvents } from '../src/sun.js';

const REF = Date.parse('2026-10-05T10:00:00Z');
const Z = (s) => Date.parse(s);

// numeri di PROVA, scelti diversi dai reali
const RULES = normalizeRules({
  format: 'dk3-rules',
  version: 1,
  planningMinima: { B: { ceilingAdd: 100, visAdd: 300 }, A: { ceilingAdd: 300, visAdd: 1000 }, circling: { ceilingAdd: 300, visAdd: 1000 } },
  approaches: { ILS: { type: 'B', dh: 200, rvr: 500 }, NPA: { type: 'A', mdh: 300, rvr: 800 }, CIRC: { type: 'circling', mdh: 700, vis: 2500 } },
  defaultApproach: 'ILS',
  noAlternate: { maxFlightMin: 300, minCeilingFt: 2500, minVisM: 6000 },
  takeoffAlternate: { maxDistanceNm: 300, floorVisM: 500, assumedReturnMin: 30 },
  airports: { MXP: { approach: 'ILS', separateRunways: true }, FUE: { approach: 'ILS', separateRunways: false }, ACE: { approach: 'NPA', separateRunways: false } },
});

const taf = (raw) => parseTaf(raw, REF);
const metar = (raw) => parseMetar(raw, REF);
const GOOD = (icao) => taf(`TAF ${icao} 050500Z 0506/0612 04010KT 9999 FEW030`);

const wxFor = (extra = {}) => {
  const wx = {};
  for (const i of ['LIMC', 'LIME', 'LIML', 'LIMF', 'LIMJ', 'LIPX', 'LIRP', 'GCFV', 'GCRR', 'GCLP', 'GCXO', 'GCTS']) wx[i] = { taf: GOOD(i), metar: null };
  return { ...wx, ...extra };
};

const legs = [
  { n: 0, flight: 'NO 1620', dep: 'MXP', arr: 'FUE', depMs: Z('2026-10-05T13:30:00Z'), arrMs: Z('2026-10-05T17:45:00Z') },
  { n: 1, flight: 'NO 1621', dep: 'FUE', arr: 'MXP', depMs: Z('2026-10-05T18:35:00Z'), arrMs: Z('2026-10-05T22:25:00Z') },
];

test('regole: file controllato e minime', () => {
  assert.throws(() => normalizeRules({ format: 'altro' }), /file di regole/);
  assert.throws(() => normalizeRules({ format: 'dk3-rules', planningMinima: {} }), /Regole/);
  const app = approachFor(RULES, 'FUE');
  assert.deepEqual(landingMinima(app), { visM: 500, ceilingFt: null });
  assert.deepEqual(planningMinima(RULES, app), { visM: 800, ceilingFt: 300 });
  const npa = approachFor(RULES, 'ACE');
  assert.deepEqual(landingMinima(npa), { visM: 800, ceilingFt: 300 });
  assert.deepEqual(planningMinima(RULES, npa), { visM: 1800, ceilingFt: 600 });
  const ignoto = approachFor(RULES, 'BCN');
  assert.equal(ignoto.assumed, true);
});

test('ICAO: codici e aeroporti vicini', () => {
  assert.equal(icaoFor('FUE'), 'GCFV');
  assert.equal(iataFor('LIMC'), 'MXP');
  const near = nearestAirports('FUE', { maxNm: 300 });
  assert.ok(near.some((c) => c.icao === 'GCRR'));
  assert.ok(near.every((c, i) => i === 0 || c.nm >= near[i - 1].nm));
  assert.ok(!near.some((c) => c.iata === 'FUE'));
});

test('sole: tramonto di FUE il 5 ottobre intorno alle 18:45Z', () => {
  const ev = sunEvents(28.45, -13.86, Z('2026-10-05T17:00:00Z'));
  const min = new Date(ev.sunset).getUTCHours() * 60 + new Date(ev.sunset).getUTCMinutes();
  assert.ok(min > 18 * 60 + 35 && min < 18 * 60 + 58, `tramonto ${new Date(ev.sunset).toISOString()}`);
  assert.ok(sunElevation(45.63, 8.72, Z('2026-10-05T22:25:00Z')) < -0.833); // MXP di notte
  assert.ok(sunElevation(45.63, 8.72, Z('2026-10-05T13:30:00Z')) > 10); // di giorno
});

test('parole del TAF evidenziate per gravità', () => {
  assert.equal(tokenLevel('TS'), 'high');
  assert.equal(tokenLevel('FEW090CB'), 'high');
  assert.equal(tokenLevel('+TSRA'), 'high');
  assert.equal(tokenLevel('0400'), 'high');
  assert.equal(tokenLevel('1200'), 'med');
  assert.equal(tokenLevel('9999'), null);
  assert.equal(tokenLevel('BKN004'), 'med');
  assert.equal(tokenLevel('BKN030'), null);
  assert.equal(tokenLevel('27030G45KT'), 'high');
  assert.equal(tokenLevel('04012KT'), null);
  assert.equal(tokenLevel('SHRA'), 'low');
  assert.equal(tokenLevel('FG'), 'high');
});

test('giornata MXP-FUE-MXP: temporali PROB40 a FUE, rotazione breve, alternati', () => {
  const wx = wxFor({
    LIMC: { taf: taf('TAF LIMC 050500Z 0506/0612 VRB05KT 9999 SCT060 PROB40 TEMPO 0516/0519 SHRA'), metar: metar('METAR LIMC 050750Z VRB01KT CAVOK 17/14 Q1024 NOSIG') },
    GCFV: { taf: taf('TAF GCFV 050200Z 0503/0603 04012KT 9999 FEW015 TX28/0514Z TN22/0506Z PROB40 TEMPO 0503/0507 BKN010 TEMPO 0503/0509 32005KT PROB40 TEMPO 0514/0603 TS FEW090CB PROB40 TEMPO 0518/0603 VRB05KT PROB30 TEMPO 0523/0603 BKN010'), metar: metar('METAR GCFV 050730Z 35006KT 9999 FEW015 24/21 Q1016') },
  });
  const b = briefDay({ legs, wx, rules: RULES, nowMs: Z('2026-10-05T08:00:00Z') });
  const [andata, ritorno] = b.legs;

  // arrivo a FUE: PROB40 TS nella finestra 16:45-18:45
  const ts = andata.arr.threats.find((t) => t.id === 'ts');
  assert.equal(ts.level, 'med');
  assert.equal(ts.prob, 40);
  assert.match(ts.detail, /PROB40 TEMPO 0514\/0603 TS FEW090CB/);
  assert.match(ts.detail, /05 14Z → 06 03Z/); // la finestra vera, non 17:14-18:03
  assert.ok(andata.arr.dark === false); // 17:45Z è ancora giorno a FUE
  assert.ok(ritorno.dep.dark === true || ritorno.dep.dark === false);

  // rotazione di 50 minuti con temporali possibili
  const turn = andata.turn[0];
  assert.equal(turn.id, 'turn');
  assert.equal(turn.level, 'high');
  assert.match(turn.title, /50 min/);

  // FUE: pista unica -> serve un alternato; MXP: due piste separate, cielo buono -> nessuno
  assert.equal(andata.alt.dest.need, 1);
  assert.match(andata.alt.dest.reasons[0], /una sola pista/);
  assert.equal(andata.alt.dest.destStatus, 'ok');
  assert.ok(andata.alt.dest.candidates.some((c) => c.icao === 'GCRR' && c.status === 'ok'));
  assert.equal(ritorno.alt.dest.need, 0);
  assert.match(ritorno.alt.dest.reasons[0], /senza alternato/);

  // partenza: tempo buono -> alternato al decollo non serve
  assert.equal(andata.alt.toa.need, false);
  assert.equal(ritorno.alt.toa.need, false);

  // MXP al ritorno: notte, nessun SHRA nella finestra
  assert.ok(ritorno.arr.dark);
  assert.ok(ritorno.arr.threats.some((t) => t.id === 'night'));
  assert.ok(!ritorno.arr.threats.some((t) => t.id === 'wet'));
  assert.equal(b.level, 'high');
  assert.ok(b.top.some((t) => t.id === 'ts'));
});

test('nebbia a destinazione e alla partenza: due alternati e alternato al decollo', () => {
  const nebbia = taf('TAF LIMC 051100Z 0512/0618 18008KT 9999 SCT040 BECMG 0522/0524 0300 FG VV001 BECMG 0606/0608 9999 NSC');
  const wx = wxFor({ LIMC: { taf: nebbia, metar: null } });
  // rientro a MXP alle 22:25Z con nebbia: sotto le minime -> due alternati
  const ritorno = briefDay({ legs: [legs[1]], wx, rules: RULES, nowMs: Z('2026-10-05T12:00:00Z') }).legs[0];
  assert.equal(ritorno.alt.dest.need, 2);
  assert.equal(ritorno.alt.dest.destStatus, 'no');
  assert.match(ritorno.alt.dest.reasons[0], /visibilità 300 m < 500 m/);
  assert.ok(ritorno.arr.threats.some((t) => t.id === 'fog' && t.level === 'high'));
  assert.ok(ritorno.arr.threats.some((t) => t.id === 'ceil' && t.level === 'high'));
  // partenza da MXP con nebbia alle 23Z: serve alternato al decollo
  const notte = { n: 0, flight: 'X', dep: 'MXP', arr: 'FCO', depMs: Z('2026-10-05T23:00:00Z'), arrMs: Z('2026-10-06T00:15:00Z') };
  const wx2 = wxFor({ LIMC: { taf: nebbia, metar: null }, LIRF: { taf: taf('TAF LIRF 051100Z 0512/0618 VRB03KT CAVOK'), metar: null } });
  const b = briefDay({ legs: [notte], wx: wx2, rules: RULES, nowMs: Z('2026-10-05T12:00:00Z') }).legs[0];
  assert.equal(b.alt.toa.need, true);
  assert.match(b.alt.toa.reasons[0], /sotto le minime di atterraggio/);
  assert.ok(b.alt.toa.candidates.some((c) => c.status === 'ok'));
});

test('minime: nubi e visibilità, PROB come limite, dati mancanti', () => {
  const t = taf('TAF LIMC 051100Z 0512/0618 18008KT 9999 SCT040 PROB40 TEMPO 0520/0523 0400 BKN003');
  const w = evaluateWindow(t, Z('2026-10-05T20:00:00Z'), Z('2026-10-05T22:00:00Z'));
  assert.equal(statusAgainst(w, { visM: 500, ceilingFt: null }, RULES).status, 'marginal');
  assert.equal(statusAgainst(w, { visM: 500, ceilingFt: null }, { ...RULES, probPolicy: 'worst' }).status, 'no');
  assert.equal(statusAgainst(w, { visM: 500, ceilingFt: null }, { ...RULES, probPolicy: 'ignore' }).status, 'ok');
  assert.equal(statusAgainst(null, { visM: 500 }, RULES).status, 'nodata');
  assert.equal(statusAgainst(evaluateWindow(t, Z('2026-10-09T10:00:00Z'), Z('2026-10-09T12:00:00Z')), { visM: 500 }, RULES).status, 'nodata');
  // TEMPO conta come peggiore, anche con tempoPolicy predefinita
  const t2 = taf('TAF LIMC 051100Z 0512/0618 18008KT 9999 SCT040 TEMPO 0520/0523 0400');
  const w2 = evaluateWindow(t2, Z('2026-10-05T20:00:00Z'), Z('2026-10-05T22:00:00Z'));
  assert.equal(statusAgainst(w2, { visM: 500 }, RULES).status, 'no');
  assert.equal(statusAgainst(w2, { visM: 500 }, { ...RULES, tempoPolicy: 'ignore' }).status, 'ok');
});

test('senza regole il briefing mostra i threat ma non decide gli alternati', () => {
  const wx = wxFor();
  const b = briefDay({ legs, wx, rules: null, nowMs: Z('2026-10-05T08:00:00Z') });
  assert.equal(b.legs[0].alt, null);
  assert.ok(Array.isArray(b.legs[0].arr.threats));
});

test('threat: vento, ghiaccio, polvere e dati mancanti', () => {
  const w = evaluateWindow(taf('TAF GCFV 051100Z 0512/0618 04028G40KT 3000 DU FZRA BKN004'), Z('2026-10-05T14:00:00Z'), Z('2026-10-05T16:00:00Z'));
  const { threats } = threatsForWindow({ role: 'arr', iata: 'FUE', ms: Z('2026-10-05T15:00:00Z'), w, metar: null, rules: RULES, nowMs: Z('2026-10-05T10:00:00Z') });
  const ids = Object.fromEntries(threats.map((t) => [t.id, t.level]));
  assert.equal(ids.wind, 'high');
  assert.equal(ids.ice, 'high');
  assert.equal(ids.dust, 'med');
  assert.equal(ids.vis, 'low');
  assert.equal(ids.ceil, 'med');
  const none = threatsForWindow({ role: 'arr', iata: 'FUE', ms: Z('2026-10-05T15:00:00Z'), w: null, metar: null, rules: RULES, nowMs: Z('2026-10-05T10:00:00Z') });
  assert.ok(none.threats.some((t) => t.id === 'nodata'));
});
