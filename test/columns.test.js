import { describe, it, expect } from 'vitest';
import { detectColumns, missingRequired, headerSignature, mappingFits, findHeaderRow, matrixToRows, rowsToStops } from '../src/lib/columns.js';

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
    expect(missingRequired(detectColumns(['Name', 'Phone']))).toEqual(['route', 'street']);
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

  it('skips rows with no route or address and says why', () => {
    const { stops, skipped } = rowsToStops(
      [
        { Route: '', Address: '1 Main St' },
        { Route: '1', Address: '' },
        { Route: '', Address: '' },
      ],
      mapping,
    );
    expect(stops).toHaveLength(0);
    expect(skipped).toEqual([
      { rowNumber: 2, reason: 'no route number' },
      { rowNumber: 3, reason: 'no street address' },
    ]);
  });

  it('parses full addresses when there are no city or ZIP columns', () => {
    const { stops } = rowsToStops([{ R: '1', A: '400 Sycamore Ln Apt 3, Chapel Hill, NC 27514' }], { route: 'R', street: 'A' });
    expect(stops[0]).toMatchObject({ street: '400 Sycamore Ln', unit: '3', city: 'Chapel Hill', state: 'NC', zip: '27514' });
  });
});
