// Local storage in the browser (IndexedDB).
//
// Collections:
//   complexes  saved apartment complexes, buildings and unit rules
//   pins       exact pins for single houses
//   settings   column mapping, stops per link, "seen help" flags...
//   cache      map lookups (address -> point, nearby buildings) so we
//              never ask OpenStreetMap twice for the same thing
//
// Every function is async and works on one collection at a time. To move to
// shared storage later (Supabase, Firestore...), write a file with the same
// five functions and swap the import in the files that use this one.

const DB_NAME = 'table-route-sheets';
const DB_VERSION = 1;
export const COLLECTIONS = ['complexes', 'pins', 'settings', 'cache'];
export const SCHEMA_VERSION = 1;

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of COLLECTIONS) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function run(collection, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(collection, mode);
    const req = fn(tx.objectStore(collection));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const list = (collection) => run(collection, 'readonly', (s) => s.getAll());
export const get = (collection, id) => run(collection, 'readonly', (s) => s.get(id));
export const remove = (collection, id) => run(collection, 'readwrite', (s) => s.delete(id));

export function put(collection, record) {
  const stamped = { schemaVersion: SCHEMA_VERSION, ...record, updatedAt: new Date().toISOString() };
  if (!stamped.createdAt) stamped.createdAt = stamped.updatedAt;
  return run(collection, 'readwrite', (s) => s.put(stamped)).then(() => stamped);
}

/** Write many records as-is (used by backup import; keeps their updatedAt). */
export function putMany(collection, records) {
  return run(collection, 'readwrite', (s) => {
    let last;
    for (const r of records) last = s.put(r);
    return last;
  });
}

// Small helpers for settings, stored as { id, value }.
export async function getSetting(id, fallback = null) {
  const row = await get('settings', id).catch(() => null);
  return row ? row.value : fallback;
}
export const setSetting = (id, value) => run('settings', 'readwrite', (s) => s.put({ id, value }));

export function newId(prefix = '') {
  const rand = globalThis.crypto?.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return prefix + rand;
}
