// Archivio sul dispositivo (IndexedDB). I turni non escono mai dal telefono.
const NAME = 'dk3-roster';
const STORE = 'imports';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    let result;
    Promise.resolve(fn(store, (v) => (result = v))).catch(reject);
    t.oncomplete = () => {
      db.close();
      resolve(result);
    };
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

const wrap = (req) => new Promise((res, rej) => {
  req.onsuccess = () => res(req.result);
  req.onerror = () => rej(req.error);
});

export const allImports = () => tx('readonly', async (s, set) => set(await wrap(s.getAll())));
export const addImport = (rec) => tx('readwrite', async (s, set) => set(await wrap(s.add(rec))));
export const putImport = (rec) => tx('readwrite', (s) => wrap(s.put(rec)));
export const deleteImport = (id) => tx('readwrite', (s) => wrap(s.delete(id)));
export const clearImports = () => tx('readwrite', (s) => wrap(s.clear()));
export async function replaceImports(list) {
  await clearImports();
  for (const rec of list) await addImport(rec);
}
