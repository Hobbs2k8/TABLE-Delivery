import { describe, it, expect } from 'vitest';
import { ruleMatches, matchUnit, describeRule, validateRule } from '../src/lib/unitRules.js';

describe('ruleMatches', () => {
  it('numeric ranges only match whole numbers', () => {
    const r = { type: 'range', from: '101', to: '124' };
    expect(ruleMatches(r, '101')).toBe(true);
    expect(ruleMatches(r, '124')).toBe(true);
    expect(ruleMatches(r, '125')).toBe(false);
    expect(ruleMatches(r, '110A')).toBe(false);
    expect(ruleMatches({ type: 'range', from: '124', to: '101' }, '110')).toBe(true);
  });
  it('letter ranges', () => {
    expect(ruleMatches({ type: 'range', from: 'A', to: 'D' }, 'c')).toBe(true);
    expect(ruleMatches({ type: 'range', from: 'A', to: 'D' }, 'E')).toBe(false);
  });
  it('starts / ends with', () => {
    expect(ruleMatches({ type: 'startsWith', value: '2' }, '214')).toBe(true);
    expect(ruleMatches({ type: 'endsWith', value: 'b' }, '11B')).toBe(true);
    expect(ruleMatches({ type: 'endsWith', value: 'B' }, '11C')).toBe(false);
  });
  it('patterns: x is one digit, * is anything', () => {
    const r = { type: 'pattern', value: '1xx' };
    expect(ruleMatches(r, '101')).toBe(true);
    expect(ruleMatches(r, '1')).toBe(false);
    expect(ruleMatches(r, '1001')).toBe(false);
    expect(ruleMatches({ type: 'pattern', value: '4*' }, '4B')).toBe(true);
  });
  it('empty units only match "every other unit"', () => {
    expect(ruleMatches({ type: 'startsWith', value: '1' }, '')).toBe(false);
    expect(ruleMatches({ type: 'rest' }, '')).toBe(true);
  });
});

describe('matchUnit', () => {
  const complex = {
    buildings: [
      { id: 'b1', label: 'Building 1' },
      { id: 'b2', label: 'Building 2' },
      { id: 'bC', label: 'Bldg C' },
      { id: 'office', label: 'Office' },
    ],
    rules: [
      { id: 'r1', type: 'pattern', value: '1xx', buildingId: 'b1' },
      { id: 'r2', type: 'startsWith', value: '2', buildingId: 'b2' },
      { id: 'r3', type: 'range', from: '100', to: '110', buildingId: 'b2' },
      { id: 'r4', type: 'unit', unit: '105', buildingId: 'office' },
      { id: 'r5', type: 'endsWith', value: 'C', buildingId: 'bC' },
    ],
  };

  it('one-off units win over everything', () => {
    expect(matchUnit({ unit: '105' }, complex)).toMatchObject({ buildingId: 'office', via: 'unit' });
  });
  it('ranges are checked before patterns', () => {
    expect(matchUnit({ unit: '108' }, complex)).toMatchObject({ buildingId: 'b2', via: 'range' });
  });
  it('patterns apply when no range matches', () => {
    expect(matchUnit({ unit: '150' }, complex)).toMatchObject({ buildingId: 'b1', via: 'pattern' });
  });
  it('"Bldg C" in the address picks the building with that label', () => {
    expect(matchUnit({ unit: '', buildingHint: 'C' }, complex)).toMatchObject({ buildingId: 'bC', via: 'address' });
  });
  it('flags units that two same-level rules send to different buildings', () => {
    const m = matchUnit({ unit: '2C' }, complex);
    expect(m.buildingId).toBe('b2');
    expect(m.conflicts).toEqual(['bC']);
  });
  it('returns null for units nothing covers', () => {
    expect(matchUnit({ unit: '9Z' }, complex).buildingId).toBeNull();
  });
});

describe('describe / validate', () => {
  it('describes rules in plain words', () => {
    expect(describeRule({ type: 'range', from: '101', to: '124' })).toBe('Units 101–124');
    expect(describeRule({ type: 'rest' })).toBe('Every other unit');
  });
  it('validates input', () => {
    expect(validateRule({ type: 'range', from: '1', to: 'B', buildingId: 'x' })).toMatch(/two numbers/);
    expect(validateRule({ type: 'unit', unit: '', buildingId: 'x' })).toMatch(/unit number/);
    expect(validateRule({ type: 'unit', unit: '4', buildingId: '' })).toMatch(/building/);
    expect(validateRule({ type: 'unit', unit: '4', buildingId: 'x' })).toBe('');
  });
});
