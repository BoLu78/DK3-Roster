// Aggiornamento dell'app: cerca una versione nuova sul sito e la installa.
// Si scaricano solo i file dell'app dallo stesso indirizzo da cui è stata installata: nessun dato personale.

const devMode = () => /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && !location.search.includes('sw');

// Restituisce 'updating' (nuova versione trovata: l'app si ricarica da sola), 'current', 'dev', 'unsupported'.
// Lancia un errore se non riesce a controllare (rete assente o sito non raggiungibile).
export async function checkForUpdate() {
  if (devMode()) return 'dev';
  if (!('serviceWorker' in navigator)) return 'unsupported';
  if (!navigator.onLine) throw new Error('Nessuna connessione a internet.');
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return 'unsupported';
  await reg.update(); // riscarica sw.js dal sito, senza copie in memoria
  const worker = reg.installing ?? reg.waiting;
  if (!worker) return 'current';
  // la nuova versione si installa e si attiva da sola (skipWaiting): all'attivazione l'app si ricarica (app.js)
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('L’aggiornamento sta impiegando troppo: riprova con una connessione migliore.')), 45000);
    const done = () => {
      if (worker.state === 'activated') {
        clearTimeout(timer);
        resolve();
      } else if (worker.state === 'redundant') {
        clearTimeout(timer);
        reject(new Error('Il nuovo aggiornamento non si è installato (rete interrotta?). Riprova.'));
      }
    };
    worker.addEventListener('statechange', done);
    done();
  });
  return 'updating';
}

// Riscarica tutto da zero: toglie la copia dell'app salvata sul telefono e ricarica. I turni non si toccano.
export async function forceReload() {
  if (!navigator.onLine) throw new Error('Serve la connessione a internet per riscaricare l’app.');
  const regs = (await navigator.serviceWorker?.getRegistrations?.()) ?? [];
  await Promise.all(regs.map((r) => r.unregister()));
  if ('caches' in window) await Promise.all((await caches.keys()).map((k) => caches.delete(k)));
  location.reload();
}
