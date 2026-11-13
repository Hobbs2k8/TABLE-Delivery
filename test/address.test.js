import { describe, it, expect } from 'vitest';
import { splitUnit, normalizeUnit, normalizeStreet, addressKey, parseFullAddress, hasUnitWords, naturalCompare, houseNumber, formatAddress, normalizeTown } from '../src/lib/address.js';

describe('splitUnit', () => {
  it.each([
    ['400 Sycamore Ln Apt 214', '400 Sycamore Ln', '214', ''],
    ['400 Sycamore Ln, Apt. 4B', '400 Sycamore Ln', '4B', ''],
    ['400 Sycamore Ln #4b', '400 Sycamore Ln', '4B', ''],
    ['400 Sycamore Ln Unit 0214', '400 Sycamore Ln', '214', ''],
    ['400 Sycamore Ln Bldg 4 Apt 214', '400 Sycamore Ln', '214', '4'],
    ['400 Sycamore Ln Building C', '400 Sycamore Ln', '', 'C'],
    ['12 Mobile Park Rd Lot 12', '12 Mobile Park Rd', '12', ''],
    ['18 Hollow Rd', '18 Hollow Rd', '', ''],
    ['100 Lot Rd', '100 Lot Rd', '', ''],
    ['5 Suite Ave', '5 Suite Ave', '', ''],
  ])('%s', (input, street, unit, building) => {
    expect(splitUnit(input)).toEqual({ street, unit, building });
  });
});

describe('normalizeUnit', () => {
  it('strips words, symbols, leading zeros and case', () => {
    expect(normalizeUnit('Apt. #04b')).toBe('4B');
    expect(normalizeUnit(' unit 12 ')).toBe('12');
    expect(normalizeUnit('')).toBe('');
    expect(normalizeUnit(null)).toBe('');
  });
});

describe('normalizeStreet / addressKey', () => {
  it('treats spelling variants of one address the same', () => {
    const a = addressKey({ street: '400 Sycamore Lane', zip: '27514' });
    const b = addressKey({ street: '400 SYCAMORE LN.', zip: '27514-1234' });
    expect(a).toBe(b);
    expect(a).toBe('400 SYCAMORE LN|27514');
  });
  it('abbreviates directions and only the trailing suffix', () => {
    expect(normalizeStreet('101 North Court Street')).toBe('101 N COURT ST');
    expect(normalizeStreet('5 Main Street North')).toBe('5 MAIN ST N');
  });
  it('falls back to city when there is no ZIP', () => {
    expect(addressKey({ street: '1 Main St', city: 'Carrboro' })).toBe('1 MAIN ST|CARRBORO');
  });
  it('returns empty key for empty street', () => {
    expect(addressKey({ street: '' })).toBe('');
  });
});

describe('parseFullAddress', () => {
  it('splits comma-separated full addresses', () => {
    expect(parseFullAddress('400 Sycamore Ln, Chapel Hill, NC 27514')).toEqual({ street: '400 Sycamore Ln', unit: '', city: 'Chapel Hill', state: 'NC', zip: '27514' });
    expect(parseFullAddress('400 Sycamore Ln, Chapel Hill NC 27514, USA')).toEqual({ street: '400 Sycamore Ln', unit: '', city: 'Chapel Hill', state: 'NC', zip: '27514' });
  });
  it("reads TABLE's export: street, town with no state or ZIP", () => {
    expect(parseFullAddress('112 N Churton St, Hillsborough')).toEqual({ street: '112 N Churton St', unit: '', city: 'Hillsborough', state: '', zip: '' });
  });
  it('reads the unit as the middle segment', () => {
    expect(parseFullAddress('820 Eno Mill Rd, 1A, Hillsborough')).toMatchObject({ street: '820 Eno Mill Rd', unit: '1A', city: 'Hillsborough' });
    expect(parseFullAddress('1105 N Fordham Blvd, Apt 12, Chapel Hill, NC')).toMatchObject({ street: '1105 N Fordham Blvd', unit: '12', city: 'Chapel Hill', state: 'NC' });
    expect(parseFullAddress('9 Oak Ave, Upstairs, Carrboro')).toMatchObject({ unit: 'UPSTAIRS', city: 'Carrboro' });
  });
  it('leaves unparseable text as the street', () => {
    expect(parseFullAddress('18 Hollow Rd').street).toBe('18 Hollow Rd');
  });
});

describe('helpers', () => {
  it('hasUnitWords', () => {
    expect(hasUnitWords('Apt 3')).toBe(true);
    expect(hasUnitWords('#3')).toBe(true);
    expect(hasUnitWords('Bldg C')).toBe(true);
    expect(hasUnitWords('18 Hollow Rd')).toBe(false);
  });
  it('naturalCompare', () => {
    expect(['10', '2', '1'].sort(naturalCompare)).toEqual(['1', '2', '10']);
  });
  it('formatAddress adds NC when the file has no state or ZIP', () => {
    expect(formatAddress({ street: '112 N Churton St', city: 'Hillsborough' })).toBe('112 N Churton St, Hillsborough, NC');
    expect(formatAddress({ street: '1 Main St', city: 'Carrboro', zip: '27510' })).toBe('1 Main St, Carrboro, 27510');
  });
  it('houseNumber', () => {
    expect(houseNumber('402 Sycamore Lane')).toEqual({ number: 402, name: 'SYCAMORE LN' });
  });
});

describe('normalizeTown', () => {
  it('fixes case and small typos of known towns', () => {
    expect(normalizeTown('Chapel HIll')).toBe('Chapel Hill');
    expect(normalizeTown('Carborro')).toBe('Carrboro');
    expect(normalizeTown('  chapel   hill ')).toBe('Chapel Hill');
    expect(normalizeTown('Hillsborugh')).toBe('Hillsborough');
    expect(normalizeTown('MEBANE')).toBe('Mebane');
  });
  it('leaves unknown or far-off names as typed', () => {
    expect(normalizeTown('Raleigh')).toBe('Raleigh');
    expect(normalizeTown('Hillsboro')).toBe('Hillsboro'); // 3 edits away: not guessed
    expect(normalizeTown('Graham')).toBe('Graham');
    expect(normalizeTown('Durhm')).toBe('Durham');
    expect(normalizeTown('')).toBe('');
  });
});
