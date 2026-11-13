// Shared building pins: keeps this computer's saved complexes and house pins
// in step with TABLE's own copy (a Drive file run by apps-script/Code.gs).
// Only on when the coordinator has entered TABLE's check-in URL and key.
// For each record the most recently saved version wins; deletes travel as
// { id, deleted: true }. Family names never leave the browser: complexes and
// pins hold street addresses, building pins and unit rules only.

import { listAll, putMany } from './db.js';
import { mergeRecords } from './backup.js';

let config = null;
let timer = null;
let running = null;
let onPulled = () => {};
export const status = { lastAt: null, error: '' };

export function configure(c, { pulled } = {}) {
  config = c?.url && c?.key ? c : null;
  if (pulled) onPulled = pulled;
}
export const enabled = () => Boolean(config);

async function post(url, body) {
  // text/plain body keeps this a "simple" request, which Apps Script accepts from any site.
  const res = await fetch(url, { method: 'POST', body: JSON.stringify(body) });
  const data = await res.json().catch(() => null);
  if (!data) throw new Error('No answer from TABLE’s sheet. Check the web app URL.');
  if (!data.ok) throw new Error(data.error === 'bad key' ? 'TABLE’s sheet did not accept the key.' : `TABLE’s sheet said: ${data.error || 'error'}.`);
  return data;
}

/** Check a URL and key before saving them. Resolves or throws a message for the coordinator. */
export async function testConnection(url, key) {
  try {
    await post(url, { action: 'ping', key });
  } catch (e) {
    throw new Error(e instanceof TypeError ? 'Could not reach that URL. Check it is the web app URL ending in /exec.' : e.message);
  }
}

/** Send local changes up and bring others' changes down. Returns how many records came down. */
export function syncNow() {
  if (!config) return Promise.resolve(0);
  if (running) return running;
  running = (async () => {
    try {
      const [complexes, pins] = await Promise.all([listAll('complexes'), listAll('pins')]);
      const remote = await post(config.url, { action: 'sync', key: config.key, complexes, pins });
      const nc = mergeRecords(complexes, remote.complexes || []);
      const np = mergeRecords(pins, remote.pins || []);
      if (nc.length) await putMany('complexes', nc);
      if (np.length) await putMany('pins', np);
      status.lastAt = new Date();
      status.error = '';
      if (nc.length || np.length) await onPulled();
      return nc.length + np.length;
    } catch (e) {
      status.error = e instanceof TypeError ? 'Offline or TABLE’s sheet unreachable. Will try again.' : e.message;
      return 0;
    } finally {
      running = null;
    }
  })();
  return running;
}

/** Sync a moment after a change (several quick edits send once). */
export function scheduleSync(delay = 1500) {
  if (!config) return;
  clearTimeout(timer);
  timer = setTimeout(syncNow, delay);
}
