// Test del meteo con risposte inventate (nessuna rete).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeCode, hourKey, buildUrl, parseResponse, mergeForecast, neededForecasts, updateForecasts, weatherAt, prune, weatherEventsOf } from '../src/weather.js';

const response = (date, codes, temps) => ({
  hourly: {
    time: codes.map((_, i) => `${date}T${String(i).padStart(2, '0')}:00`),
    weather_code: codes,
    temperature_2m: temps,
    wind_gusts_10m: codes.map(() => 12),
  },
});

test('meteo: codici e icone', () => {
  assert.equal(describeCode(0).icon, '☀️');
  assert.equal(describeCode(2).label, 'Parzialmente nuvoloso');
  assert.equal(describeCode(3).group, 'cloudy');
  assert.equal(describeCode(45).group, 'fog');
  assert.equal(describeCode(63).group, 'rain');
  assert.equal(describeCode(95).group, 'storm');
  assert.equal(describeCode(0, 30).windy, true);
  assert.equal(describeCode(0, 10).windy, false);
});

test('meteo: ora più vicina e richiesta senza dati personali', () => {
  assert.equal(hourKey(Date.parse('2026-10-05T12:29:00Z')), '2026-10-05T12');
  assert.equal(hourKey(Date.parse('2026-10-05T12:31:00Z')), '2026-10-05T13');
  const url = buildUrl(45.6312, 8.7231, '2026-10-05', '2026-10-06');
  assert.ok(url.startsWith('https://api.open-meteo.com/v1/forecast?'));
  assert.ok(url.includes('latitude=45.63') && url.includes('longitude=8.72') && url.includes('start_date=2026-10-05'));
  assert.ok(!/name|crew|roster|user/i.test(url)); // solo coordinate e date
});

test('meteo: cambio di previsione nel tempo', () => {
  const day1 = parseResponse(response('2026-10-05', [0, 0, 0], [20, 21, 22]));
  let f = mergeForecast(undefined, day1, 1000);
  assert.deepEqual(weatherAt({ MXP: f }, 'MXP', Date.parse('2026-10-05T01:00:00Z')).temp, 21);
  assert.equal(weatherAt({ MXP: f }, 'MXP', Date.parse('2026-10-05T01:00:00Z')).before, null);
  // il giorno dopo la previsione cambia: ora 01:00 piove
  f = mergeForecast(f, parseResponse(response('2026-10-05', [0, 63, 0], [20, 15, 22])), 2000);
  const w = weatherAt({ MXP: f }, 'MXP', Date.parse('2026-10-05T01:00:00Z'));
  assert.equal(w.icon, '🌧️');
  assert.equal(w.before.icon, '☀️'); // "prima: sole"
  // ritorna sereno: la modifica sparisce
  f = mergeForecast(f, parseResponse(response('2026-10-05', [0, 0, 0], [20, 21, 22])), 3000);
  assert.equal(weatherAt({ MXP: f }, 'MXP', Date.parse('2026-10-05T01:00:00Z')).before, null);
  // cambio di sola temperatura o di codice nello stesso gruppo non conta
  f = mergeForecast(f, parseResponse(response('2026-10-05', [1, 0, 0], [25, 21, 22])), 4000);
  assert.equal(weatherAt({ MXP: f }, 'MXP', Date.parse('2026-10-05T00:00:00Z')).before, null);
});

const day = (date, legs, extra = {}) => ({ date, kind: 'flight', legs, checkIn: legs.length ? { label: 'C/I', airport: legs[0].dep, time: '0500' } : null, checkOut: legs.length ? { label: 'C/O', airport: legs.at(-1).arr, time: '1500' } : null, hotel: null, ...extra });
const leg = (dep, arr, d, a) => ({ kind: 'flight', airline: 'NO', number: '1', dep, arr, depTime: d, arrTime: a });

test('meteo: aeroporti necessari, solo oggi e i prossimi 15 giorni', () => {
  const days = [
    day('2026-10-01', [leg('MXP', 'FUE', '0600', '0900')]), // passato
    day('2026-10-05', [leg('MXP', 'RMF', '0600', '0900'), leg('RMF', 'MXP', '1000', '1300')]),
    day('2026-10-20', [leg('MXP', 'SSH', '0600', '0900')]), // oltre 15 giorni
    day('2026-10-06', [], { kind: 'rest', checkIn: null, checkOut: null, hotel: { code: 'H1', airport: 'RMI' } }),
  ];
  const need = neededForecasts(days, '2026-10-03', weatherEventsOf);
  assert.deepEqual([...need.keys()].sort(), ['MXP', 'RMF', 'RMI']);
  assert.deepEqual(need.get('RMF'), { from: '2026-10-05', to: '2026-10-05' });
  assert.ok(!need.has('FUE') && !need.has('SSH'));
});

test('meteo: aggiornamento con rete finta, riuso se fresco, errore parziale', async () => {
  const need = new Map([['MXP', { from: '2026-10-05', to: '2026-10-05' }], ['RMF', { from: '2026-10-05', to: '2026-10-05' }]]);
  let calls = 0;
  const fetchFn = async (url) => {
    calls++;
    if (url.includes('latitude=25.56')) throw new Error('rete assente'); // RMF fallisce
    return response('2026-10-05', Array(24).fill(1), Array(24).fill(18));
  };
  let r = await updateForecasts({ need, fetchFn, now: 1_000_000 });
  assert.equal(r.updated, 1);
  assert.equal(r.failed, 1);
  assert.ok(r.cache.MXP && !r.cache.RMF);
  // subito dopo: MXP è fresca e non si riscarica, RMF sì
  calls = 0;
  r = await updateForecasts({ cache: r.cache, need, fetchFn, now: 1_000_000 + 60_000 });
  assert.equal(calls, 1);
  // dopo 4 ore la previsione è vecchia: si riscarica
  calls = 0;
  r = await updateForecasts({ cache: r.cache, need: new Map([['MXP', need.get('MXP')]]), fetchFn, now: 1_000_000 + 4 * 3600000 });
  assert.equal(calls, 1);
  assert.equal(r.updated, 1);
  // le ore vecchie si eliminano
  assert.deepEqual(Object.keys(prune(r.cache, Date.parse('2026-10-09T00:00:00Z'))), []);
});

test('meteo: eventi del giorno con hotel', () => {
  const ev = weatherEventsOf(day('2026-10-05', [leg('MXP', 'RMF', '0600', '0900')], { hotel: { code: 'H1', airport: 'RMF' } }));
  const apts = ev.map(([a]) => a);
  assert.ok(apts.includes('MXP') && apts.includes('RMF'));
});
