import { describe, it, expect } from 'vitest';
import { doorKey, checkWeek, startBook, doorPins, suggestRoute, recordFor, STARTED_ID } from '../src/lib/addressBook.js';
import { resolveStops, detectComplexes } from '../src/lib/complexes.js';
import { buildRoutes } from '../src/lib/routes.js';
import { addressKey } from '../src/lib/address.js';
import { DEFAULT_RULES } from '../src/lib/makeRoutes.js';

let n = 0;
const stop = (street, unit = '', over = {}) => {
  const s = { id: `s${++n}`, street, unit, city: 'Carrboro', state: 'NC', zip: '', bags: 2, route: 'R1', day: 'Tuesday', order: n, fileIndex: n, lat: null, lng: null, name: 'Secret', phone: '555', ...over };
  return { ...s, key: addressKey(s) };
};

describe('address list', () => {
  const week1 = [stop('400 Sycamore Ridge Ln', '3B'), stop('400 Sycamore Ridge Ln', '4A'), stop('12 Elm St')];

  it('one door per street + unit, however the unit is written', () => {
    expect(doorKey(stop('400 Sycamore Ridge Ln', 'Apt 3b'))).toBe(doorKey(stop('400 SYCAMORE RIDGE LANE', '#3B')));
    expect(doorKey(stop('12 Elm St'))).not.toBe(doorKey(stop('12 Elm St', '1')));
  });

  it('saves nothing until the coordinator starts it', () => {
    expect(checkWeek(week1, [], '2026-11-16')).toEqual({ started: false, fresh: [], toSave: [] });
    // a unit pin on its own does not start the list
    expect(checkWeek(week1, [{ ...recordFor(week1[0], '2026-11-16', true), lat: 1, lng: 2 }], '2026-11-16').started).toBe(false);
  });

  it('starting it saves every door as reviewed, and never names or phones', () => {
    const book = startBook(week1, '2026-11-16');
    expect(book.map((r) => r.id)).toContain(STARTED_ID);
    expect(book.filter((r) => r.id !== STARTED_ID)).toHaveLength(3);
    expect(JSON.stringify(book)).not.toMatch(/Secret|555/);
    expect(checkWeek(week1, book, '2026-11-16')).toMatchObject({ started: true, fresh: [], toSave: [] });
  });

  it('next week: a new door is flagged and saved as not reviewed; known doors get lastSeen', () => {
    const book = startBook(week1, '2026-11-16');
    const week2 = [...week1, stop('400 Sycamore Ridge Ln', '9C')];
    const res = checkWeek(week2, book, '2026-11-23');
    expect(res.fresh.map((s) => s.unit)).toEqual(['9C']);
    const added = res.toSave.find((r) => r.unit === '9C');
    expect(added).toMatchObject({ reviewed: false, firstSeen: '2026-11-23' });
    expect(res.toSave.filter((r) => r.reviewed).every((r) => r.lastSeen === '2026-11-23')).toBe(true);
    // saved but not reviewed: still flagged the next time
    expect(checkWeek(week2, [...book, ...res.toSave], '2026-11-23').fresh.map((s) => s.unit)).toEqual(['9C']);
    // reviewed: no longer flagged
    const reviewed = [...book, ...res.toSave.map((r) => ({ ...r, reviewed: true }))];
    expect(checkWeek(week2, reviewed, '2026-11-23').fresh).toEqual([]);
  });
});

describe('unit pins', () => {
  const a = stop('400 Sycamore Ridge Ln', '3B');
  const b = stop('400 Sycamore Ridge Ln', '4A');
  const complex = { id: 'c1', name: 'Sycamore', addresses: [{ key: a.key }], buildings: [{ id: 'b1', label: 'A', lat: 35.9, lng: -79.0 }], rules: [{ id: 'r', type: 'rest', buildingId: 'b1' }] };
  const doors = doorPins([{ ...recordFor(a, 'w', true), lat: 35.95, lng: -79.05, note: 'back door' }]);

  it('a pinned unit goes to its own pin, even inside a set-up complex', () => {
    const [ra, rb] = resolveStops([a, b], { complexes: [complex], doors });
    expect(ra.place).toMatchObject({ kind: 'pin', lat: 35.95, lng: -79.05, note: 'back door', complexId: 'c1' });
    expect(rb.place.kind).toBe('building');
  });

  it('pinned units stop asking for complex setup; unpinned ones still do', () => {
    expect(detectComplexes([a], [], [], doors)).toEqual([]);
    expect(detectComplexes([a, b], [], [], doors).map((c) => c.households)).toEqual([1]);
  });
});

describe('best route for a new household', () => {
  const pinned = (street, lat, lng, over) => {
    const s = stop(street, '', over);
    return { ...s, place: { kind: 'pin', status: 'ok', lat, lng } };
  };
  // R1 is west of TABLE, R2 east. The new household is east.
  const r1 = [pinned('1 West Rd', 35.91, -79.15, { route: 'R1' }), pinned('2 West Rd', 35.92, -79.16, { route: 'R1' })];
  const r2 = [pinned('1 East Rd', 35.91, -78.98, { route: 'R2' }), pinned('2 East Rd', 35.92, -78.97, { route: 'R2' })];
  const fresh = pinned('3 East Rd', 35.915, -78.975, { route: 'R1' });

  it('suggests the route where it adds the least driving', () => {
    const routes = buildRoutes([...r1, fresh, ...r2]);
    const sug = suggestRoute(fresh, routes, DEFAULT_RULES);
    expect(sug.route.name).toBe('R2');
    expect(sug.current).toBe(false);
    expect(sug.addedMinutes).toBeGreaterThan(0);
  });

  it('says so when it is already on the best route', () => {
    const here = { ...fresh, route: 'R2' };
    expect(suggestRoute(here, buildRoutes([...r1, ...r2, here]), DEFAULT_RULES).current).toBe(true);
  });

  it('never guesses: no pin, or a route with unpinned stops, gives a reason instead', () => {
    const noPoint = { ...stop('9 Nowhere Rd'), place: { kind: 'address', status: 'ok' } };
    expect(suggestRoute(noPoint, buildRoutes([...r1, ...r2, noPoint]), DEFAULT_RULES)).toEqual({ reason: 'no-point' });
    const unpinned = [{ ...stop('5 Mystery Ln', '', { route: 'R3' }), place: { kind: 'address', status: 'ok' } }];
    const onlyR3 = buildRoutes([...unpinned, { ...fresh, route: 'R3' }]);
    expect(suggestRoute({ ...fresh, route: 'R3', id: 'zz' }, onlyR3, DEFAULT_RULES)).toEqual({ reason: 'routes-not-pinned' });
  });

  it('respects the bag limit and the delivery day', () => {
    const full = r2.map((s) => ({ ...s, bags: 15 }));
    expect(suggestRoute(fresh, buildRoutes([...r1, fresh, ...full]), DEFAULT_RULES).route.name).toBe('R1');
    const wed = r2.map((s) => ({ ...s, day: 'Wednesday' }));
    expect(suggestRoute(fresh, buildRoutes([...r1, fresh, ...wed]), DEFAULT_RULES).route.name).toBe('R1');
  });
});
