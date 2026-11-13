// Runs apps-script/Code.gs in Node with small fakes of Google's services,
// so the script TABLE pastes into Apps Script is tested like the rest.
import { describe, it, expect, beforeEach } from 'vitest';
import { fakeGoogle } from './helpers/fakeGoogle.js';

const event = (over = {}) => ({ id: 'e1', type: 'delivered', at: '2026-10-27T15:00:00.000Z', week: '2026-10-26', day: 'Tuesday', route: 'Route 01a', stop: 3, street: '100 Main St', unit: '4B', building: 'C', bags: 2, reason: '', note: '', device: 'abc', photo: '', ...over });

describe('Apps Script backend', () => {
  let g, key;
  beforeEach(() => {
    g = fakeGoogle();
    key = g.ctx.setup();
  });

  it('setup makes a key and the Deliveries tab', () => {
    expect(key).toMatch(/^[0-9a-f]{24}$/);
    expect(g.rows[0][0]).toBe('Received');
    expect(g.ctx.setup()).toBe(key); // running again keeps the key
  });

  it('refuses requests without the right key', () => {
    expect(g.post({ action: 'ping' })).toEqual({ ok: false, error: 'bad key' });
    expect(g.post({ action: 'ping', key: 'nope' })).toEqual({ ok: false, error: 'bad key' });
    expect(g.post({ action: 'ping', key })).toEqual({ ok: true });
  });

  it('writes one row per tap and ignores the same tap sent twice', () => {
    expect(g.post({ action: 'checkin', key, event: event() })).toEqual({ ok: true });
    expect(g.post({ action: 'checkin', key, event: event() })).toEqual({ ok: true, duplicate: true });
    expect(g.rows).toHaveLength(2);
    const r = g.rows[1];
    expect(r.slice(1, 13)).toEqual(['2026-10-27T15:00:00.000Z', '2026-10-26', 'Tuesday', 'Route 01a', '3', '100 Main St', '4B', 'C', '2', 'Delivered', '', '']);
    expect(r[15]).toBe('e1');
  });

  it('saves photos to the Drive folder and links them', () => {
    g.post({ action: 'checkin', key, event: event({ id: 'p1', type: 'photo', photo: Buffer.from('jpeg').toString('base64') }) });
    expect(g.rows[1][10]).toBe('Photo');
    expect(g.rows[1][13]).toMatch(/^https:\/\/drive\.example\//);
  });

  it('never lets a cell start like a formula', () => {
    g.post({ action: 'checkin', key, event: event({ id: 'x', type: 'problem', reason: 'Other', note: '=HYPERLINK("bad")' }) });
    expect(g.rows[1][12]).toBe('\'=HYPERLINK("bad")');
  });

  it('rejects unknown event types', () => {
    expect(g.post({ action: 'checkin', key, event: event({ type: 'hack' }) }).ok).toBe(false);
    expect(g.rows).toHaveLength(1);
  });

  it('sync keeps the newest version of each record, including deletes', () => {
    const a1 = { id: 'c1', name: 'Old', updatedAt: '2026-10-01T00:00:00Z' };
    const a2 = { id: 'c1', name: 'New', updatedAt: '2026-10-05T00:00:00Z' };
    let res = g.post({ action: 'sync', key, complexes: [a2], pins: [{ id: 'p1', updatedAt: '2026-10-02T00:00:00Z' }] });
    expect(res.complexes).toEqual([a2]);
    res = g.post({ action: 'sync', key, complexes: [a1], pins: [] }); // older copy from another computer
    expect(res.complexes).toEqual([a2]);
    expect(res.pins).toHaveLength(1);
    res = g.post({ action: 'sync', key, complexes: [], pins: [{ id: 'p1', deleted: true, updatedAt: '2026-10-09T00:00:00Z' }] });
    expect(res.pins).toEqual([{ id: 'p1', deleted: true, updatedAt: '2026-10-09T00:00:00Z' }]);
  });
});
