import { describe, it, expect } from 'vitest';
import QRCode from 'qrcode';
import { routePayload, encodePayload, decodePayload, driverLink, stopsFromPayload, weekOf, makeEvent, stopStatuses, navigateUrl } from '../src/lib/checkin.js';

const stop = (n, over = {}) => ({ id: `s${n}`, number: n, street: `${100 + n} Main St`, unit: '', city: 'Carrboro', bags: 2, name: 'Secret Family', phone: '919-555-0100', notes: 'gate 1234', place: { kind: 'address', status: 'ok' }, ...over });
const route = {
  title: 'Route 01a',
  day: 'Tuesday',
  stops: [
    stop(1),
    stop(2, { unit: '4B', city: 'Chapel Hill', place: { kind: 'building', status: 'ok', label: 'C', lat: 35.91234567, lng: -79.0612345 } }),
    stop(3, { bags: '' }),
  ],
};
const opts = { url: 'https://script.google.com/macros/s/abc/exec', key: 'k123', week: '2026-10-26' };

describe('check-in link', () => {
  it('round-trips the route through the link', () => {
    const p = decodePayload(encodePayload(routePayload(route, opts)));
    expect(p).toMatchObject({ v: 1, r: 'Route 01a', d: 'Tuesday', w: '2026-10-26', u: opts.url, k: 'k123' });
    const stops = stopsFromPayload(p);
    expect(stops.map((s) => s.number)).toEqual([1, 2, 3]);
    expect(stops[0]).toMatchObject({ street: '101 Main St', city: 'Carrboro', bags: 2, destination: '101 Main St, Carrboro, NC' });
    expect(stops[1]).toMatchObject({ unit: '4B', building: 'C', city: 'Chapel Hill', destination: '35.912346,-79.061234' });
    expect(stops[2].bags).toBe('');
  });

  it('leaves out names, phones and notes', () => {
    const link = driverLink('https://example.org/app/', route, opts);
    const text = JSON.stringify(decodePayload(link.split('#')[1]));
    expect(text).not.toMatch(/Secret|555|gate/);
  });

  it('puts the route after # so the web host never sees it', () => {
    const link = driverLink('https://example.org/app/index.html?x=1#old', route, opts);
    expect(link.startsWith('https://example.org/app/driver.html#')).toBe(true);
  });

  it('a 17-stop route still fits a QR code', () => {
    const big = { ...route, stops: Array.from({ length: 17 }, (_, i) => stop(i + 1, { unit: `${i}A` })) };
    const link = driverLink('https://hobbs2k8.github.io/TABLE-Delivery/', big, { ...opts, url: `https://script.google.com/macros/s/${'x'.repeat(72)}/exec`, key: 'k'.repeat(24) });
    expect(QRCode.create(link, { errorCorrectionLevel: 'L' }).version).toBeLessThanOrEqual(20);
  });

  it('damaged links decode to null instead of crashing', () => {
    expect(decodePayload('not-a-route')).toBeNull();
    expect(decodePayload('')).toBeNull();
  });
});

describe('check-in events', () => {
  const p = routePayload(route, opts);
  it('weekOf gives the Monday', () => {
    expect(weekOf(new Date(2026, 9, 28))).toBe('2026-10-26'); // Wednesday
    expect(weekOf(new Date(2026, 9, 26))).toBe('2026-10-26'); // Monday
    expect(weekOf(new Date(2026, 10, 1))).toBe('2026-10-26'); // Sunday
  });
  it('events carry the route and stop, not names', () => {
    const e = makeEvent(p, 'delivered', stopsFromPayload(p)[1], { device: 'd1' });
    expect(e).toMatchObject({ type: 'delivered', week: '2026-10-26', day: 'Tuesday', route: 'Route 01a', stop: 2, unit: '4B', building: 'C', device: 'd1' });
    expect(e.id).toBeTruthy();
  });
  it('the latest tap wins; photos do not change status', () => {
    const s = stopsFromPayload(p)[0];
    const st = stopStatuses([
      makeEvent(p, 'problem', s, { at: '2026-10-27T10:00:00Z', reason: 'Other' }),
      makeEvent(p, 'delivered', s, { at: '2026-10-27T10:05:00Z' }),
      makeEvent(p, 'photo', s, { at: '2026-10-27T10:06:00Z' }),
    ]);
    expect(st.get(1).status).toBe('delivered');
  });
  it('directions link', () => {
    expect(navigateUrl('101 Main St, Carrboro, NC')).toBe('https://www.google.com/maps/dir/?api=1&destination=101+Main+St%2C+Carrboro%2C+NC&travelmode=driving');
  });
});
