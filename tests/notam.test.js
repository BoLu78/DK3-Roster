// Test dei NOTAM incollati (testi inventati nel formato ICAO).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitNotams, notamFields, notamTime, classifyNotam, analyzeNotams } from '../src/notam.js';

const Z = (s) => Date.parse(s);
const SAMPLE = `
A1234/26 NOTAMN
Q) LIMM/QMRLC/IV/NBO/A/000/999/4538N00843E005
A) LIMC B) 2610050600 C) 2610052000
E) RWY 17R/35L CLSD DUE WIP

A1235/26 NOTAMN
Q) LIMM/QICAS/I/NBO/A/000/999/4538N00843E005
A) LIMC B) 2610010600 C) 2610310000
E) ILS RWY 35R U/S

C0012/26 NOTAMN
Q) GCCC/QFULT/IV/NBO/A/000/999/2828N01351W005
A) GCFV B) 2610050000 C) 2610062359
E) JET A1 FUEL AVBL ONLY 0800-1600 LT

C0013/26 NOTAMN
Q) GCCC/QMXLC/IV/M/A/000/999/2828N01351W005
A) GCFV B) 2610040000 C) 2610042359
E) TWY B CLSD

C0014/26 NOTAMR C0010/26
Q) GCCC/QMRAK/IV/NBO/A/000/999/2828N01351W005
A) GCFV B) 2610050000 C) 2610062359
E) RWY 01/19 RESUMED NORMAL

A9999/26 NOTAMN
Q) LIMM/QOBCE/IV/M/A/000/999/4538N00843E005
A) LIMC B) 2611010000 C) 2611020000
E) CRANE ERECTED 2NM N OF AD`;

test('NOTAM: divisione e campi', () => {
  const blocks = splitNotams(SAMPLE);
  assert.equal(blocks.length, 6);
  const f = notamFields(blocks[0]);
  assert.equal(f.A, 'LIMC');
  assert.equal(f.B, '2610050600');
  assert.equal(f.C, '2610052000');
  assert.equal(f.E, 'RWY 17R/35L CLSD DUE WIP');
  assert.match(f.Q, /^LIMM\/QMRLC/);
  assert.equal(notamTime('2610050600'), Z('2026-10-05T06:00:00Z'));
  assert.equal(notamTime('PERM'), null);
});

test('NOTAM: classificazione per codice Q e per testo', () => {
  assert.equal(classifyNotam({ Q: 'LIMM/QMRLC/IV', E: 'RWY 17R/35L CLSD' }).cat, 'rwy-closed');
  assert.equal(classifyNotam({ Q: 'LIMM/QMRLC/IV', E: 'RWY 17R/35L CLSD' }).rwy, '17R/35L');
  assert.equal(classifyNotam({ E: 'RWY 09 CLSD' }).cat, 'rwy-closed');
  assert.equal(classifyNotam({ E: 'AD CLSD TO ALL TFC' }).cat, 'ad-closed');
  assert.equal(classifyNotam({ Q: 'X/QICAS/I', E: 'ILS RWY 35R U/S' }).cat, 'ils-us');
  assert.equal(classifyNotam({ E: 'LOC RWY 01 UNSERVICEABLE' }).cat, 'ils-us');
  assert.equal(classifyNotam({ Q: 'X/QLPAS/I', E: 'PAPI RWY 19 U/S' }).cat, 'lights');
  assert.equal(classifyNotam({ E: 'GPS INTERFERENCE POSSIBLE IN FIR' }).cat, 'gnss');
  assert.equal(classifyNotam({ Q: 'X/QMXLC/I', E: 'TWY B CLSD' }).level, 'low');
  assert.equal(classifyNotam({ Q: 'X/QMRAK/I', E: 'RWY 01/19 RESUMED NORMAL' }).level, 'info');
  assert.equal(classifyNotam({ E: 'CRANE ERECTED' }).cat, 'obst');
  assert.equal(classifyNotam({ E: 'LASER ACTIVITY' }).cat, 'airspace');
});

test('NOTAM: analisi del giorno, solo quelli attivi e dei propri aeroporti', () => {
  const windows = { LIMC: [Z('2026-10-05T12:30:00Z'), Z('2026-10-05T14:30:00Z')], GCFV: [Z('2026-10-05T16:45:00Z'), Z('2026-10-05T18:45:00Z')] };
  const r = analyzeNotams(SAMPLE, { icaos: ['LIMC', 'GCFV'], windows, nowMs: Z('2026-10-05T08:00:00Z') });
  assert.equal(r.total, 6);
  const by = Object.fromEntries(r.items.map((i) => [i.id, i]));
  assert.equal(by['A1234/26'].level, 'high');
  assert.equal(by['A1234/26'].active, true);
  assert.equal(by['A1234/26'].rwy, '17R/35L');
  assert.equal(by['A1235/26'].cat, 'ils-us');
  assert.equal(by['C0012/26'].cat, 'fuel');
  assert.equal(by['C0013/26'].active, false); // ieri
  assert.equal(by['A9999/26'].active, false); // novembre
  assert.equal(by['C0014/26'].level, 'info');
  assert.equal(r.items[0].level, 'high'); // ordinati per gravità
});
