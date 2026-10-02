// Simula Safari (ReadableStream senza iterazione asincrona) e verifica il rimedio.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, pdfjs } from './helpers.js';
import { parsePdf } from '../src/parser.js';

const original = ReadableStream.prototype[Symbol.asyncIterator];

test('polyfill: for await su ReadableStream anche senza supporto nativo', async () => {
  delete ReadableStream.prototype[Symbol.asyncIterator];
  assert.equal(ReadableStream.prototype[Symbol.asyncIterator], undefined);
  try {
    await import('../js/polyfills.js'); // si installa da solo all'import
    assert.equal(typeof ReadableStream.prototype[Symbol.asyncIterator], 'function');
    const out = [];
    for await (const v of new ReadableStream({ start(c) { c.enqueue(1); c.enqueue(2); c.close(); } })) out.push(v);
    assert.deepEqual(out, [1, 2]);

    // con il PDF vero: senza il rimedio pdf.js va in errore, con il rimedio legge
    const dir = path.join(ROOT, 'samples');
    const pdf = fs.existsSync(dir) ? fs.readdirSync(dir).find((f) => f.endsWith('.pdf')) : null;
    if (pdf) {
      const r = await parsePdf(pdfjs, fs.readFileSync(path.join(dir, pdf)));
      assert.ok(r.days.length > 27);
    }
  } finally {
    ReadableStream.prototype[Symbol.asyncIterator] = original;
  }
});
