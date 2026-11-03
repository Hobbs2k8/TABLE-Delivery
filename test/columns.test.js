import { describe, it, expect } from 'vitest';
import { detectColumns, missingRequired, headerSignature, mappingFits, findHeaderRow, matrixToRows, rowsToStops, dayInfo } from '../src/lib/columns.js';

describe('detectColumns', () => {
  it('maps a Routific-style export', () => {
    const m = detectColumns(['Vehicle', 'Stop Number', 'Visit Name', 'Address', 'Phone', 'Notes', 'Latitude', 'Longitude', 'Load']);
    expect(m).toMatchObject({ route: 'Vehicle', stop: 'Stop Number', name: 'Visit Name', street: 'Address', phone: 'Phone', notes: 'Notes', lat: 'Latitude', lng: 'Longitude', bags: 'Load' });
  });

  it('maps a Salesforce macro sheet', () => {
    const m = detectColumns(['Route #', 'Driver Name', 'Household', 'Mailing Street', 'Apt/Unit', 'Mailing City', 'Mailing State', 'Mailing Zip/Postal Code', 'Home Phone', '# Bags', 'Delivery Notes']);
    expect(m).toMatchObject({
      route: 'Route #', driver: 'Driver Name', name: 'Household', street: 'Mailing Street', unit: 'Apt/Unit',
      city: 'Mailing City', state: 'Mailing State', zip: 'Mailing Zip/Postal Code', phone: 'Home Phone', bags: '# Bags', notes: 'Delivery Notes',
    });
  });

  it('prefers Address 1 for street and Address 2 for unit', () => {
    const m = detectColumns(['Route', 'Address 2', 'Address 1']);
    expect(m.street).toBe('Address 1');
    expect(m.unit).toBe('Address 2');
  });

  it('never uses one column twice, and does not guess short words loosely', () => {
    const m = detectColumns(['Route', 'Street', 'Status']);
    expect(m.state).toBeNull(); // "Status" is not "St"
    expect(new Set(Object.values(m).filter(Boolean)).size).toBe(2);
  });

  it('reports missing required fields', () => {
    expect(missingRequired(detectColumns(['Name', 'Phone']))).toEqual(['street']);
    expect(missingRequired(detectColumns(['Address']))).toEqual([]); // routes are optional now
  });
});

describe('remembering a mapping', () => {
  it('signature ignores order and case', () => {
    expect(headerSignature(['Route', 'Address'])).toBe(headerSignature(['address', 'ROUTE']));
  });
  it('mappingFits checks columns still exist', () => {
    const m = { route: 'Route', street: 'Address', unit: null };
    expect(mappingFits(m, ['Route', 'Address', 'Phone'])).toBe(true);
    expect(mappingFits(m, ['Route', 'Street'])).toBe(false);
  });
});

describe('header row detection', () => {
  it('skips title rows from the Monday macro', () => {
    const matrix = [
      ['TABLE Weekly Delivery — Monday'],
      [],
      ['Route', 'Driver', 'Address', 'City', 'Zip'],
      ['1', 'Pat', '18 Hollow Rd', 'Hillsborough', '27278'],
    ];
    expect(findHeaderRow(matrix)).toBe(2);
    const { headers, rows } = matrixToRows(matrix);
    expect(headers).toEqual(['Route', 'Driver', 'Address', 'City', 'Zip']);
    expect(rows).toHaveLength(1);
  });
  it('names blank and duplicate headers', () => {
    const { headers } = matrixToRows([['Route', '', 'Notes', 'Notes'], ['1', 'x', 'a', 'b']]);
    expect(headers).toEqual(['Route', 'Column 2', 'Notes', 'Notes (2)']);
  });
});

describe('rowsToStops', () => {
  const mapping = { route: 'Route', street: 'Address', unit: 'Apt', city: 'City', zip: 'Zip', bags: 'Bags', stop: 'Stop', lat: null, lng: null };

  it('splits units out of the address and prefers the unit column', () => {
    const { stops } = rowsToStops(
      [
        { Route: 'Route 3', Address: '400 Sycamore Ln Apt 214', Apt: '', City: 'Chapel Hill', Zip: '27514', Bags: '3', Stop: '2' },
        { Route: '3', Address: '400 Sycamore Ln Apt 9', Apt: 'Apt 215', City: 'Chapel Hill', Zip: '27514', Bags: '2 bags', Stop: '1' },
      ],
      mapping,
    );
    expect(stops[0]).toMatchObject({ route: '3', street: '400 Sycamore Ln', unit: '214', bags: 3, order: 2 });
    expect(stops[1]).toMatchObject({ unit: '215', bags: 2 });
  });

  it('skips rows with no address, and fills blank route cells from the row above', () => {
    const { stops, skipped } = rowsToStops(
      [
        { Route: '4', Address: '1 Main St' },
        { Route: '', Address: '2 Main St' }, // merged cell: still route 4
        { Route: '4', Address: '' },
        { Route: '', Address: '' },
      ],
      mapping,
    );
    expect(stops.map((s) => [s.route, s.street])).toEqual([['4', '1 Main St'], ['4', '2 Main St']]);
    expect(skipped).toEqual([{ rowNumber: 4, reason: 'no street address' }]);
  });

  it('leaves the route empty when the file has none, so the app can make routes', () => {
    const r = rowsToStops([{ Address: '1 Main St' }, { Address: '2 Main St' }], { street: 'Address' });
    expect(r.hasRoutes).toBe(false);
    expect(r.stops.map((s) => s.route)).toEqual(['', '']);
    expect(r.stops[0].bags).toBeNull(); // one row per household and no bags column: unknown
  });

  it('parses full addresses when there are no city or ZIP columns', () => {
    const { stops } = rowsToStops([{ R: '1', A: '400 Sycamore Ln Apt 3, Chapel Hill, NC 27514' }], { route: 'R', street: 'A' });
    expect(stops[0]).toMatchObject({ street: '400 Sycamore Ln', unit: '3', city: 'Chapel Hill', state: 'NC', zip: '27514' });
  });
});

describe("TABLE's Current Numbers workbook (MASTER sheet, one row per child)", () => {
  const headers = ['Food Location: Delivery Locations Name', 'Food Location: Drop-off Day', 'Stop #', 'Program', 'Mailing Address', 'Dup Address', 'Allergies', 'NeedsLabel', 'PrefLabel', 'Household: Primary Language Spoken at Home', 'Delivery Notes'];

  it('recognizes its columns', () => {
    expect(detectColumns(headers)).toMatchObject({
      route: 'Food Location: Delivery Locations Name',
      day: 'Food Location: Drop-off Day',
      stop: 'Stop #',
      program: 'Program',
      street: 'Mailing Address', // not "Dup Address"
      special: 'NeedsLabel',
      diet: 'PrefLabel',
      language: 'Household: Primary Language Spoken at Home',
      notes: 'Delivery Notes',
      name: null, // the language column must not become the household name
      bags: null,
    });
  });

  it('turns child rows into households with bags, diet and language', () => {
    const row = (route, day, stop, addr, extra = {}) => ({
      'Food Location: Delivery Locations Name': route, 'Food Location: Drop-off Day': day, 'Stop #': stop, Program: 'TABLE @ Home',
      'Mailing Address': addr, NeedsLabel: '', PrefLabel: '', 'Household: Primary Language Spoken at Home': 'Spanish', 'Delivery Notes': 'Knock twice', ...extra,
    });
    const rows = [
      row('Route 01a-Efland', '01-Tues', '3', '820 Eno Mill Rd, 1A, Hillsborough'),
      row('Route 01a-Efland', '01-Tues', '3.1', '820 Eno Mill Rd, 1A, Hillsborough', { NeedsLabel: 'X', PrefLabel: '1. Nut allergy;' }),
      row('Route 01a-Efland', '01-Tues', '3.2', '820 Eno Mill Rd, 1A, Hillsborough'),
      row('Route 01a-Efland', '01-Tues', '1', '112 N Churton St, Hillsborough'),
      row('TABLE Pickup', '01-Tues', '1', '9 Pickup Ln, Carrboro'),
      row('Route 01a-Efland', '03-Thurs', '1', '112 N Churton St, Hillsborough'), // same route name, another day
    ];
    const m = detectColumns(headers);
    const r = rowsToStops(rows, m);
    expect(r.pickups).toBe(1);
    expect(r.hasDays).toBe(true);
    expect(r.stops).toHaveLength(3);
    const apt = r.stops.find((s) => s.unit === '1A');
    expect(apt).toMatchObject({ route: '01a-Efland', day: 'Tuesday', street: '820 Eno Mill Rd', city: 'Hillsborough', bags: 3, special: 1, dietNotes: ['1. Nut allergy;'], language: 'Spanish', notes: 'Knock twice', order: 3 });
    expect(r.stops.filter((s) => s.street === '112 N Churton St').map((s) => s.day)).toEqual(['Tuesday', 'Thursday']);
  });

  it('skips Marketplace pickup households when there are no routes', () => {
    const r = rowsToStops(
      [
        { A: '1 Main St, Carrboro', P: 'TABLE @ Home' },
        { A: '2 Main St, Carrboro', P: 'Marketplace Pick Up' },
        { A: '2 Main St, Carrboro', P: '' }, // sibling row without the flag: same household, still skipped
      ],
      { street: 'A', program: 'P' },
    );
    expect(r.stops.map((s) => s.street)).toEqual(['1 Main St']);
    expect(r.pickups).toBe(1);
  });

  it('reads delivery days', () => {
    expect(dayInfo('01-Tues')).toEqual({ label: 'Tuesday', order: 1 });
    expect(dayInfo('Thursday')).toEqual({ label: 'Thursday', order: 3 });
    expect(dayInfo('')).toEqual({ label: '', order: 99 });
  });
});
