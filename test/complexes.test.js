import { describe, it, expect } from 'vitest';
import { detectComplexes, resolveStops, suggestRelatedAddresses, previewUnits } from '../src/lib/complexes.js';
import { addressKey } from '../src/lib/address.js';

const stop = (o) => ({ route: '1', unit: '', city: 'Chapel Hill', state: 'NC', zip: '27514', lat: null, lng: null, unitWords: Boolean(o.unit), ...o });

describe('detectComplexes', () => {
  const stops = [
    stop({ street: '400 Sycamore Ln', unit: '101' }),
    stop({ street: '400 Sycamore Lane', unit: '214' }),
    stop({ street: '18 Hollow Rd' }),
    stop({ street: '9 Elm St' }),
    stop({ street: '9 Elm St' }), // shared house, no unit
    stop({ street: '77 Pine Ct', unit: '2' }), // single household with a unit
  ];

  it('finds shared addresses and addresses with units', () => {
    const found = detectComplexes(stops);
    expect(found.map((c) => [c.street, c.households, c.reason])).toEqual([
      ['400 Sycamore Ln', 2, 'shared'],
      ['9 Elm St', 2, 'shared'],
      ['77 Pine Ct', 1, 'unit'],
    ]);
    expect(found[0].units).toEqual(['101', '214']);
  });

  it('skips complexes already set up, and pinned houses', () => {
    const complexes = [{ id: 'c1', addresses: [{ key: addressKey(stops[0]) }] }];
    const pins = [{ key: addressKey(stops[3]) }];
    expect(detectComplexes(stops, complexes, pins).map((c) => c.street)).toEqual(['77 Pine Ct']);
  });
});

describe('suggestRelatedAddresses', () => {
  it('suggests nearby house numbers on the same street and ZIP', () => {
    const t = { key: '400 SYCAMORE LN|27514', street: '400 Sycamore Ln' };
    const c = [
      { key: '402 SYCAMORE LN|27514', street: '402 Sycamore Ln' },
      { key: '900 SYCAMORE LN|27514', street: '900 Sycamore Ln' },
      { key: '404 SYCAMORE LN|27510', street: '404 Sycamore Ln' },
      { key: '402 OAK ST|27514', street: '402 Oak St' },
    ];
    expect(suggestRelatedAddresses(t, c).map((x) => x.street)).toEqual(['402 Sycamore Ln']);
  });
});

describe('resolveStops', () => {
  const complex = {
    id: 'c1',
    name: 'Oak Ridge',
    addresses: [
      { key: '400 SYCAMORE LN|27514' },
      { key: '402 SYCAMORE LN|27514' },
    ],
    buildings: [
      { id: 'b1', label: 'Building 1', lat: 35.9, lng: -79.05, note: 'Side door' },
      { id: 'b2', label: 'Building 2', lat: 35.91, lng: -79.06 },
    ],
    rules: [
      { id: 'r1', type: 'startsWith', value: '1', buildingId: 'b1' },
      { id: 'r2', type: 'startsWith', value: '2', buildingId: 'b2' },
    ],
  };
  const pins = [{ id: 'p1', key: '18 HOLLOW RD|27514', lat: 36.1, lng: -79.1, note: 'Blue mailbox' }];

  const out = resolveStops(
    [
      stop({ street: '400 Sycamore Ln', unit: '104' }),
      stop({ street: '402 Sycamore Ln', unit: '210' }), // second address of the same complex
      stop({ street: '400 Sycamore Ln', unit: '9C' }), // new unit, no rule
      stop({ street: '18 Hollow Rd' }),
      stop({ street: '5 Birch Way', unit: '3' }), // looks like a complex, not set up
      stop({ street: '6 Birch Way' }),
    ],
    { complexes: [complex], pins },
  );

  it('sends units to their building', () => {
    expect(out[0].place).toMatchObject({ kind: 'building', status: 'ok', label: 'Building 1', lat: 35.9, note: 'Side door' });
    expect(out[1].place).toMatchObject({ kind: 'building', label: 'Building 2' });
  });
  it('flags units with no building instead of silently using the entrance', () => {
    expect(out[2].place).toMatchObject({ kind: 'address', status: 'unmatched', complexName: 'Oak Ridge' });
  });
  it('uses house pins', () => {
    expect(out[3].place).toMatchObject({ kind: 'pin', lat: 36.1, note: 'Blue mailbox' });
  });
  it('marks complexes that are not set up, and plain houses as ok', () => {
    expect(out[4].place.status).toBe('not-set-up');
    expect(out[5].place).toMatchObject({ kind: 'address', status: 'ok' });
  });
  it('previewUnits lists each unit and its building', () => {
    expect(previewUnits(complex, out).map((p) => [p.unit, p.buildingId])).toEqual([
      ['9C', null],
      ['104', 'b1'],
      ['210', 'b2'],
    ]);
  });
});
