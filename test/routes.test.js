import { describe, it, expect } from 'vitest';
import { orderRouteStops, buildRoutes } from '../src/lib/routes.js';

let n = 0;
const s = (o) => ({ id: `s${n}`, fileIndex: n++, route: '1', order: null, unit: '', bags: 1, driver: '', key: o.street, place: { kind: 'address', status: 'ok' }, ...o });
const inBldg = (bid, extra = {}) => ({ kind: 'building', status: 'ok', complexId: 'c1', buildingId: bid, ...extra });

describe('orderRouteStops', () => {
  it('follows the stop order column, then file order', () => {
    const out = orderRouteStops([s({ street: 'A', order: 3 }), s({ street: 'B', order: 1 }), s({ street: 'C' }), s({ street: 'D', order: 2 })]);
    expect(out.map((x) => x.street)).toEqual(['B', 'D', 'A', 'C']);
  });

  it('pulls a complex together at its first stop and groups by building', () => {
    const out = orderRouteStops([
      s({ street: 'House 1', order: 1 }),
      s({ street: 'Apts', unit: '210', order: 2, place: inBldg('b2') }),
      s({ street: 'House 2', order: 3 }),
      s({ street: 'Apts', unit: '104', order: 4, place: inBldg('b1') }),
      s({ street: 'Apts', unit: '9C', order: 5, place: { kind: 'address', status: 'unmatched', complexId: 'c1' } }),
      s({ street: 'Apts', unit: '202', order: 6, place: inBldg('b2') }),
      s({ street: 'House 3', order: 7 }),
    ]);
    expect(out.map((x) => `${x.street}${x.unit ? ' ' + x.unit : ''}`)).toEqual([
      'House 1',
      'Apts 202', // building 2 first: it appeared first in Routific's order
      'Apts 210',
      'Apts 104',
      'Apts 9C', // no building: end of the block
      'House 2',
      'House 3',
    ]);
  });

  it('groups a not-yet-set-up complex by address', () => {
    const ns = { kind: 'address', status: 'not-set-up' };
    const out = orderRouteStops([
      s({ street: 'X', unit: '3', order: 1, key: 'X', place: ns }),
      s({ street: 'Y', order: 2 }),
      s({ street: 'X', unit: '1', order: 3, key: 'X', place: ns }),
    ]);
    expect(out.map((x) => x.street + x.unit)).toEqual(['X1', 'X3', 'Y']);
  });
});

describe('buildRoutes', () => {
  it('sorts routes naturally and totals bags and problems', () => {
    const routes = buildRoutes([
      s({ route: '10', street: 'A', bags: 2, driver: 'Sam' }),
      s({ route: '2', street: 'B', bags: 3 }),
      s({ route: '2', street: 'C', bags: null, place: { kind: 'address', status: 'not-set-up' } }),
    ]);
    expect(routes.map((r) => r.id)).toEqual(['2', '10']);
    expect(routes[0]).toMatchObject({ households: 2, bags: 3, problems: 1, status: 'attention' });
    expect(routes[0].stops.map((x) => x.number)).toEqual([1, 2]);
    expect(routes[1]).toMatchObject({ driver: 'Sam', status: 'ready' });
  });
});
