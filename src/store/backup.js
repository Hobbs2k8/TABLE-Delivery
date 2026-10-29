// Backup file: all saved complexes and house pins as one JSON file.
// Contains street addresses, pins and unit numbers, never household names.

import { list, putMany, setSetting, SCHEMA_VERSION } from './db.js';

export const BACKUP_KIND = 'table-route-sheets-backup';

export async function makeBackup() {
  const [complexes, pins] = await Promise.all([list('complexes'), list('pins')]);
  return { kind: BACKUP_KIND, schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), complexes, pins };
}

/** Check a parsed backup file. Returns an error message or ''. */
export function validateBackup(data) {
  if (!data || data.kind !== BACKUP_KIND) return 'This file is not a TABLE Route Sheets backup.';
  if (data.schemaVersion > SCHEMA_VERSION) return 'This backup was made by a newer version of the app. Update the app first.';
  if (!Array.isArray(data.complexes) || !Array.isArray(data.pins)) return 'This backup file is damaged.';
  const bad = [...data.complexes, ...data.pins].find((r) => !r || typeof r.id !== 'string');
  if (bad) return 'This backup file is damaged.';
  return '';
}

/**
 * Merge two lists by id; for the same id keep whichever was saved most recently.
 * Pure, so it can be tested and reused for shared storage later.
 */
export function mergeRecords(existing, incoming) {
  const byId = new Map(existing.map((r) => [r.id, r]));
  const changed = [];
  for (const r of incoming) {
    const cur = byId.get(r.id);
    if (!cur || String(r.updatedAt || '') > String(cur.updatedAt || '')) changed.push(r);
  }
  return changed;
}

export async function restoreBackup(data) {
  const err = validateBackup(data);
  if (err) throw new Error(err);
  const [complexes, pins] = await Promise.all([list('complexes'), list('pins')]);
  const newComplexes = mergeRecords(complexes, data.complexes);
  const newPins = mergeRecords(pins, data.pins);
  if (newComplexes.length) await putMany('complexes', newComplexes);
  if (newPins.length) await putMany('pins', newPins);
  return { complexes: newComplexes.length, pins: newPins.length };
}

export async function downloadBackup() {
  const data = await makeBackup();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `table-building-pins-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  await setSetting('lastBackupAt', data.exportedAt);
  await setSetting('unsavedChanges', 0);
}
