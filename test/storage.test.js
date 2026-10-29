import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { put, list, get, remove, getSetting, setSetting } from '../src/store/db.js';
import { makeBackup, restoreBackup, validateBackup, mergeRecords } from '../src/store/backup.js';
import { parseOverpass, osmLabel, buildingsQuery } from '../src/services/buildings.js';

describe('db', () => {
  it('saves, lists, reads and removes with timestamps', async () => {
    const saved = await put('complexes', { id: 'c1', name: 'Oak Ridge', addresses: [], buildings: [], rules: [] });
    expect(saved.updatedAt).toBeTruthy();
    expect(saved.schemaVersion).toBe(1);
    expect((await list('complexes')).map((c) => c.id)).toEqual(['c1']);
    expect((await get('complexes', 'c1')).name).toBe('Oak Ridge');
    await remove('complexes', 'c1');
    expect(await list('complexes')).toEqual([]);
  });
  it('settings', async () => {
    expect(await getSetting('perLink', 10)).toBe(10);
    await setSetting('perLink', 8);
    expect(await getSetting('perLink', 10)).toBe(8);
  });
});

describe('backup', () => {
  it('round-trips and keeps the newest copy of each record', async () => {
    await put('complexes', { id: 'c2', name: 'Old name' });
    await put('pins', { id: 'p1', key: 'X|1', lat: 1, lng: 2 });
    const backup = await makeBackup();
    expect(validateBackup(backup)).toBe('');
    expect(backup.complexes.map((c) => c.id)).toContain('c2');

    const newer = { ...backup, complexes: [{ ...backup.complexes.find((c) => c.id === 'c2'), name: 'New name', updatedAt: '2999-01-01T00:00:00Z' }] };
    expect(await restoreBackup(newer)).toEqual({ complexes: 1, pins: 0 });
    expect((await get('complexes', 'c2')).name).toBe('New name');
  });
  it('rejects files that are not backups', () => {
    expect(validateBackup({ hello: 1 })).toMatch(/not a TABLE/);
    expect(validateBackup({ kind: 'table-route-sheets-backup', schemaVersion: 1, complexes: [{}], pins: [] })).toMatch(/damaged/);
  });
  it('mergeRecords', () => {
    expect(mergeRecords([{ id: 'a', updatedAt: '2' }], [{ id: 'a', updatedAt: '1' }, { id: 'b' }]).map((r) => r.id)).toEqual(['b']);
  });
});

describe('OpenStreetMap buildings', () => {
  it('parses ways and multipolygon relations', () => {
    const b = parseOverpass({
      elements: [
        { type: 'way', id: 1, tags: { building: 'apartments', name: 'Building C' }, geometry: [{ lat: 0, lon: 0 }, { lat: 0, lon: 2 }, { lat: 2, lon: 2 }, { lat: 2, lon: 0 }] },
        { type: 'relation', id: 2, tags: { building: 'yes', 'addr:housenumber': '402' }, members: [{ role: 'outer', geometry: [{ lat: 1, lon: 1 }, { lat: 1, lon: 2 }, { lat: 2, lon: 2 }] }] },
        { type: 'way', id: 3, geometry: [{ lat: 0, lon: 0 }] },
      ],
    });
    expect(b.map((x) => [x.osmId, x.label])).toEqual([['way/1', 'Building C'], ['relation/2', '402']]);
    expect(b[0].center).toEqual({ lat: 1, lng: 1 });
  });
  it('labels', () => {
    expect(osmLabel({ ref: 'B' })).toBe('B');
    expect(osmLabel({})).toBe('');
  });
  it('query sends only a point', () => {
    expect(buildingsQuery(35.9, -79.05)).toBe('[out:json][timeout:25];(way["building"](around:400,35.9,-79.05);relation["building"](around:400,35.9,-79.05););out tags geom;');
  });
});
