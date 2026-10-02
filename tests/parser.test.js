// Test del parser sui PDF veri in samples/ (esclusa da git).
// Se samples/ non contiene PDF i test vengono saltati.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, pdfjs } from './helpers.js';
import { parsePdf, checkTotals } from '../src/parser.js';

const samplesDir = path.join(ROOT, 'samples');
const pdfs = fs.existsSync(samplesDir) ? fs.readdirSync(samplesDir).filter((f) => f.toLowerCase().endsWith('.pdf')) : [];

if (!pdfs.length) test('parser: nessun PDF in samples/, test saltati', { skip: true }, () => {});

for (const file of pdfs) {
  const base = file.replace(/\.pdf$/i, '');
  const expectedPath = path.join(samplesDir, 'expected', base + '.json');

  test(`${file}: struttura e coerenza`, async () => {
    const r = await parsePdf(pdfjs, fs.readFileSync(path.join(samplesDir, file)));
    assert.deepEqual(r.warnings, []);
    assert.ok(r.meta.periodStart && r.meta.periodEnd);
    // un giorno per ogni data del periodo, senza buchi
    const n = (Date.parse(r.meta.periodEnd) - Date.parse(r.meta.periodStart)) / 86400000 + 1;
    assert.equal(r.days.length, n);
    // FT, DT e giorni di riposo calcolati = totali stampati
    const c = checkTotals(r);
    assert.equal(c.ftOk, true, `FT ${c.computed.ft} / ${c.printed.ft}`);
    assert.equal(c.dtOk, true, `DT ${c.computed.dt} / ${c.printed.dt}`);
    assert.equal(c.offOk, true, `Off ${c.computed.offDays} / ${c.printed.offDays}`);
    for (const d of r.days) {
      if (d.kind === 'flight') {
        assert.ok(d.checkIn && d.checkOut, `${d.date}: C/I e C/O`);
        assert.ok(d.legs.some((l) => l.kind === 'flight'), `${d.date}: nessuna tratta`);
        for (const l of d.legs) {
          assert.match(l.depTime, /^\d{4}$/);
          assert.match(l.arrTime, /^\d{4}$/);
          assert.ok(l.dep && l.arr && l.ac, `${d.date}: tratta incompleta`);
          // l'equipaggio non c'è sempre nel PDF (es. voli da BLQ): se c'è, deve essere completo
          if (l.crew) assert.ok(l.crew.cockpit.length >= 2 && l.crew.cabin.length >= 1, `${d.date} ${l.number}: equipaggio incompleto`);
        }
        assert.ok(d.ft && d.dt, `${d.date}: FT/DT`);
      }
      if (d.hotel) assert.ok(d.hotel.name, `${d.date}: hotel senza nome`);
    }
    // ogni aeroporto usato è nella tabella del PDF
    for (const d of r.days) for (const l of d.legs) for (const a of [l.dep, l.arr]) if (a) assert.ok(r.airports[a], `aeroporto ${a} mancante`);
  });

  test(`${file}: valori attesi verificati a mano`, { skip: !fs.existsSync(expectedPath) }, async () => {
    const exp = JSON.parse(fs.readFileSync(expectedPath, 'utf8'));
    const r = await parsePdf(pdfjs, fs.readFileSync(path.join(samplesDir, file)));
    assert.deepEqual([r.meta.periodStart, r.meta.periodEnd], exp.period);
    assert.deepEqual(r.totals, exp.totals);
    const byDate = new Map(r.days.map((d) => [d.date, d]));
    for (const [date, kind] of Object.entries(exp.kinds)) assert.equal(byDate.get(date).kind, kind, `${date} kind`);
    for (const [date, e] of Object.entries(exp.days)) {
      const d = byDate.get(date);
      const at = (m) => `${date}: ${m}`;
      if ('code' in e) assert.equal(d.code, e.code, at('code'));
      if ('window' in e) assert.deepEqual(d.window, e.window, at('window'));
      if (e.pickup) assert.equal(d.pickup, e.pickup, at('pickup'));
      if (e.checkIn) assert.deepEqual([d.checkIn.airport, d.checkIn.time], e.checkIn, at('checkIn'));
      if (e.checkOut) assert.deepEqual([d.checkOut.airport, d.checkOut.time], e.checkOut, at('checkOut'));
      if (e.ft) assert.equal(d.ft, e.ft, at('ft'));
      if (e.dt) assert.equal(d.dt, e.dt, at('dt'));
      if (e.simFt) assert.equal(d.simFt, e.simFt, at('simFt'));
      if (e.hotel) assert.deepEqual([d.hotel?.code, d.hotel?.airport], e.hotel, at('hotel'));
      const flights = d.legs.filter((l) => l.kind === 'flight');
      if (e.legs) assert.deepEqual(flights.map((l) => [l.number, l.dep, l.arr, l.depTime, l.arrTime]), e.legs, at('tratte'));
      if (e.transport) {
        const t = d.legs.find((l) => l.kind === 'transport');
        assert.deepEqual([t.code, t.dep, t.arr, t.depTime, t.arrTime], e.transport, at('trasferimento'));
      }
      if (e.cockpit) assert.deepEqual(flights[0].crew.cockpit.map((c) => c.code), e.cockpit, at('cockpit'));
      if (e.cabin) assert.deepEqual(flights[0].crew.cabin.map((c) => c.code), e.cabin, at('cabina'));
      if (e.tags) assert.deepEqual(flights[0].crew.cockpit.map((c) => c.tag).filter(Boolean), e.tags, at('tag'));
    }
    for (const [code, frag] of Object.entries(exp.hotels)) assert.ok(r.hotels[code].name.toUpperCase().includes(frag), `hotel ${code}`);
    assert.equal(r.recurrent.length, exp.recurrentCount);
    assert.deepEqual({ expiry: r.recurrent[0].expiry, code: r.recurrent[0].code }, exp.recurrentFirst);
  });
}
