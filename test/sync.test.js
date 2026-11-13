// Shared building pins: this computer syncing with TABLE's copy (the real
// apps-script/Code.gs, run against fake Google services).
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll } from 'vitest';
import { put, list, listAll, remove } from '../src/store/db.js';
import { configure, syncNow, testConnection, status } from '../src/store/sync.js';
import { fakeGoogle } from './helpers/fakeGoogle.js';

const URL_ = 'https://script.google.com/macros/s/TEST/exec';
let g, key;

beforeAll(() => {
  g = fakeGoogle();
  key = g.ctx.setup();
  globalThis.fetch = async (url, { body }) => ({ json: async () => g.post(JSON.parse(body)) });
});

describe('shared building pins', () => {
  it('checks the key before saving', async () => {
    await expect(testConnection(URL_, 'wrong')).rejects.toThrow(/key/);
    await expect(testConnection(URL_, key)).resolves.toBeUndefined();
  });

  it('does nothing until set up', async () => {
    configure(null);
    expect(await syncNow()).toBe(0);
  });

  it('sends this computer’s complexes up', async () => {
    let pulled = 0;
    configure({ url: URL_, key }, { pulled: () => pulled++ });
    await put('complexes', { id: 'c1', name: 'Oak Ridge', buildings: [] });
    await syncNow();
    const shared = g.post({ action: 'sync', key, complexes: [], pins: [] });
    expect(shared.complexes.map((c) => c.name)).toEqual(['Oak Ridge']);
    expect(status.error).toBe('');
    expect(pulled).toBe(0);
  });

  it('brings another computer’s newer edits and new pins down', async () => {
    await new Promise((r) => setTimeout(r, 5));
    const later = new Date().toISOString();
    g.post({ action: 'sync', key, complexes: [{ id: 'c1', name: 'Oak Ridge Apartments', buildings: [], updatedAt: later }], pins: [{ id: 'p9', street: '5 Elm St', lat: 1, lng: 2, updatedAt: later }] });
    expect(await syncNow()).toBe(2);
    expect((await list('complexes'))[0].name).toBe('Oak Ridge Apartments');
    expect((await list('pins')).map((p) => p.id)).toEqual(['p9']);
  });

  it('a delete here reaches TABLE’s copy and stays deleted', async () => {
    await new Promise((r) => setTimeout(r, 5)); // make the delete newer than the pin
    await remove('pins', 'p9');
    expect(await list('pins')).toEqual([]);
    expect((await listAll('pins'))[0].deleted).toBe(true);
    await syncNow();
    const shared = g.post({ action: 'sync', key, complexes: [], pins: [] });
    expect(shared.pins[0].deleted).toBe(true);
    await syncNow();
    expect(await list('pins')).toEqual([]);
  });

  it('reports a wrong key without losing local data', async () => {
    configure({ url: URL_, key: 'wrong' });
    expect(await syncNow()).toBe(0);
    expect(status.error).toMatch(/key/);
    expect((await list('complexes')).length).toBe(1);
  });
});
