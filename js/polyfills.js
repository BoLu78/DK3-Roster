// Safari su iPhone non supporta "for await" sui ReadableStream, che pdf.js usa per
// leggere il testo delle pagine. Qui si aggiunge la funzione mancante.
export function installReadableStreamAsyncIterator() {
  if (typeof ReadableStream === 'undefined' || ReadableStream.prototype[Symbol.asyncIterator]) return false;
  ReadableStream.prototype[Symbol.asyncIterator] = async function* () {
    const reader = this.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) return;
        yield value;
      }
    } finally {
      reader.releaseLock();
    }
  };
  return true;
}

installReadableStreamAsyncIterator();
