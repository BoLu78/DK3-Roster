// Test della lettura delle risposte aviationweather.gov (formato JSON inventato ma conforme alla documentazione).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { metarUrl, tafUrl, sigmetUrl, parseMetarJson, parseTafJson } from '../src/awc.js';
import { parseTaf, diffTaf } from '../src/metar.js';
import { parseSigmets, sigmetHits, routePoints, buildRouteUrl, parseRouteResponse, routeSegments, pointLevel, inPolygon } from '../src/route-wx.js';
import { coordsFor } from '../src/airports-geo.js';

const Z = (s) => Date.parse(s);

test('richieste: solo codici ICAO', () => {
  const u = metarUrl(['LIMC', 'GCFV']);
  assert.equal(u, 'https://aviationweather.gov/api/data/metar?ids=LIMC,GCFV&format=json&hours=3');
  assert.equal(tafUrl(['LIMC']), 'https://aviationweather.gov/api/data/taf?ids=LIMC&format=json');
  assert.ok(sigmetUrl().startsWith('https://aviationweather.gov/api/data/isigmet'));
  assert.ok(!/roster|crew|name|user/i.test(u));
});

test('METAR e TAF in JSON: si tiene il più recente', () => {
  const metars = parseMetarJson([
    { icaoId: 'LIMC', obsTime: 1759650600, rawOb: 'METAR LIMC 050650Z VRB01KT CAVOK 15/14 Q1024' },
    { icaoId: 'LIMC', obsTime: 1759654200, rawOb: 'METAR LIMC 050750Z VRB01KT CAVOK 17/14 Q1024 NOSIG' },
    { icaoId: 'GCFV', obsTime: 1759653000, rawOb: 'METAR GCFV 050730Z 35006KT 9999 FEW015 24/21 Q1016' },
    { icaoId: 'XXXX' },
  ]);
  assert.deepEqual(Object.keys(metars).sort(), ['GCFV', 'LIMC']);
  assert.match(metars.LIMC, /050750Z/);
  const tafs = parseTafJson([{ icaoId: 'GCFV', issueTime: 1, rawTAF: 'TAF GCFV 050200Z 0503/0603\n  04012KT 9999 FEW015' }]);
  assert.equal(tafs.GCFV, 'TAF GCFV 050200Z 0503/0603 04012KT 9999 FEW015');
  assert.throws(() => parseTafJson({ error: 'x' }), /non valida/);
});

test('TAF cambiato: gruppi comparsi e spariti', () => {
  const REF = Z('2026-10-05T10:00:00Z');
  const a = parseTaf('TAF GCFV 050200Z 0503/0603 04012KT 9999 FEW015 PROB40 TEMPO 0514/0603 TS FEW090CB', REF);
  const b = parseTaf('TAF GCFV 050800Z 0509/0609 04012KT 9999 FEW015 TEMPO 0514/0603 TS FEW090CB', REF);
  const d = diffTaf(a, b);
  assert.equal(d.added.length, 1);
  assert.match(d.added[0], /^TEMPO/);
  assert.equal(d.removed.length, 1);
  assert.match(d.removed[0], /^PROB40/);
});

test('rotta diretta MXP-FUE: punti, tempi e richiesta', () => {
  const a = coordsFor('MXP');
  const b = coordsFor('FUE');
  const pts = routePoints(a, b, Z('2026-10-05T13:30:00Z'), Z('2026-10-05T17:45:00Z'), 100);
  assert.ok(pts.length >= 15 && pts.length <= 25);
  assert.equal(pts[0].nm, 0);
  assert.equal(pts[0].ms, Z('2026-10-05T13:30:00Z'));
  assert.equal(pts.at(-1).ms, Z('2026-10-05T17:45:00Z'));
  assert.ok(pts.at(-1).nm > 1400 && pts.at(-1).nm < 1600);
  const url = buildRouteUrl(pts);
  assert.ok(url.startsWith('https://api.open-meteo.com/v1/forecast?'));
  assert.ok(/start_date=2026-10-05/.test(url) && /end_date=2026-10-05/.test(url));
  assert.ok(!/roster|crew|name/i.test(url));
});

test('rotta: instabilità e tratti', () => {
  const pts = [0, 1, 2, 3, 4, 5].map((i) => ({ lat: 40 - i, lon: 5, nm: i * 100, ms: Z('2026-10-05T13:00:00Z') + i * 3600000 }));
  const json = pts.map((p, i) => ({ hourly: { time: ['2026-10-05T13:00', '2026-10-05T14:00', '2026-10-05T15:00', '2026-10-05T16:00', '2026-10-05T17:00', '2026-10-05T18:00'], weather_code: [0, 0, 0, 0, 0, 0].map((x, k) => (k === i && i === 3 ? 95 : x)), cape: [0, 0, 0, 0, 0, 0].map((x, k) => (k === i ? [100, 1200, 2500, 400, 900, 1500][i] : x)), wind_gusts_10m: [10, 10, 10, 10, 10, 10] } }));
  const withWx = parseRouteResponse(json, pts);
  assert.equal(withWx[2].cape, 2500);
  assert.equal(pointLevel(withWx[2]), 3);
  assert.equal(pointLevel(withWx[1]), 2);
  assert.equal(pointLevel(withWx[3]), 3); // codice temporale
  const seg = routeSegments(withWx, 2);
  assert.equal(seg.length, 2);
  assert.deepEqual([seg[0].fromNm, seg[0].toNm, seg[0].thunder], [100, 300, true]);
  assert.equal(seg[1].fromNm, 500);
  assert.throws(() => parseRouteResponse([json[0]], pts), /non valida/);
});

test('SIGMET: poligono e passaggio sulla rotta', () => {
  const sig = parseSigmets([
    { seriesId: 'A1', firId: 'GMMM', hazard: 'TS', qualifier: 'EMBD', validTimeFrom: Z('2026-10-05T15:00:00Z') / 1000, validTimeTo: Z('2026-10-05T19:00:00Z') / 1000, base: 0, top: 45000, coords: [{ lat: 35, lon: -12 }, { lat: 35, lon: -6 }, { lat: 30, lon: -6 }, { lat: 30, lon: -12 }], rawSigmet: 'GMMM SIGMET A1 VALID 051500/051900 EMBD TS' },
    { seriesId: 'B2', hazard: 'TURB', coords: [{ lat: 10, lon: 10 }, { lat: 10, lon: 11 }, { lat: 11, lon: 11 }] },
    { seriesId: 'C3', hazard: 'TS', coords: [] },
  ]);
  assert.equal(sig.length, 2);
  assert.ok(inPolygon([33, -8], sig[0].poly));
  assert.ok(!inPolygon([38, -8], sig[0].poly));
  const route = routePoints(coordsFor('MXP'), coordsFor('FUE'), Z('2026-10-05T13:30:00Z'), Z('2026-10-05T17:45:00Z'), 25);
  const hits = sigmetHits(sig, route);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].hazard, 'TS');
  assert.ok(hits[0].fromNm > 800 && hits[0].fromNm < 1100);
  // stesso poligono ma validità finita prima del passaggio: nessuna segnalazione
  const old = parseSigmets([{ ...{ seriesId: 'A1', hazard: 'TS', validTimeFrom: Z('2026-10-05T01:00:00Z') / 1000, validTimeTo: Z('2026-10-05T05:00:00Z') / 1000, coords: [{ lat: 35, lon: -12 }, { lat: 35, lon: -6 }, { lat: 30, lon: -6 }, { lat: 30, lon: -12 }] } }]);
  assert.equal(sigmetHits(old, route).length, 0);
});
