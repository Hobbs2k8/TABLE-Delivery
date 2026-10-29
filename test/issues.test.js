import { describe, it, expect } from 'vitest';
import { findIssues } from '../src/lib/issues.js';

const st = (o) => ({ route: '1', street: '1 Main St', zip: '27514', unit: '', unitWords: false, place: { status: 'ok' }, ...o });

describe('findIssues', () => {
  it('summarizes everything unresolved in plain words', () => {
    const issues = findIssues({
      stops: [
        st({ street: '5 Birch Way', unit: '1', unitWords: true }),
        st({ street: '5 Birch Way', unit: '2', unitWords: true }),
        st({ street: '400 Sycamore Ln', unit: '9C', key: '400 SYCAMORE LN|27514', place: { status: 'unmatched', complexId: 'c1', complexName: 'Oak Ridge' } }),
      ],
      complexes: [{ id: 'c1', addresses: [{ key: '400 SYCAMORE LN|27514' }] }],
      skipped: [{ rowNumber: 7, reason: 'no route number' }],
    });
    expect(issues.map((i) => i.title)).toEqual([
      '1 complex needs building locations',
      'Oak Ridge: 1 new unit has no building',
      '1 row was left out',
    ]);
    expect(issues[0].detail).toBe('2 households go to the main address for now.');
  });

  it('is empty when everything is resolved', () => {
    expect(findIssues({ stops: [st({})], complexes: [] })).toEqual([]);
  });
});
