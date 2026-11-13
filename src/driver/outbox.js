// The driver's outbox: check-ins wait here (IndexedDB, on the phone) until
// they reach TABLE's Google Sheet. Rural routes lose signal, so nothing is
// lost when a send fails: it stays here and is retried.
// Also keeps this route's events so the page shows what was already tapped.

const DB = 'table-driver-checkin';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('outbox', { keyPath: 'id' });
      req.result.createObjectStore('done', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  });
}

export const pending = () => run('outbox', 'readonly', (s) => s.getAll());
export const history = () => run('done', 'readonly', (s) => s.getAll());

/** Save an event: into the outbox (to send) and the history (to show), photo kept only in the outbox. */
export async function add(event) {
  await run('outbox', 'readwrite', (s) => s.put(event));
  await run('done', 'readwrite', (s) => s.put({ ...event, photo: event.photo ? 'yes' : '' }));
}

export const sent = (id) => run('outbox', 'readwrite', (s) => s.delete(id));

/** Drop history from other weeks so the phone doesn't fill up. */
export async function forgetOtherWeeks(week) {
  const all = await history();
  const old = all.filter((e) => e.week !== week);
  if (old.length) await run('done', 'readwrite', (s) => old.forEach((e) => s.delete(e.id)));
}
