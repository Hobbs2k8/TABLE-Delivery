// End-to-end over the sample files: read -> map columns -> detect complexes ->
// set one up with rules -> build routes -> links and QR codes.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import QRCode from 'qrcode';
import { readRouteFile } from '../src/lib/parse.js';
import { detectColumns, missingRequired, rowsToStops } from '../src/lib/columns.js';
import { detectComplexes, resolveStops } from '../src/lib/complexes.js';
import { buildRoutes } from '../src/lib/routes.js';
import { splitRouteLinks } from '../src/lib/mapsLinks.js';
import { findIssues } from '../src/lib/issues.js';

const fileFrom = (path, type) => new File([readFileSync(path)], path.split('/').pop(), { type });

const sycamore = {
  id: 'c1',
  name: 'Sycamore Ridge Apartments',
  addresses: [
    { key: '400 SYCAMORE RIDGE LN|27510', street: '400 Sycamore Ridge Ln' },
    { key: '410 SYCAMORE RIDGE LN|27510', street: '410 Sycamore Ridge Ln' },
  ],
  buildings: [1, 2, 3, 4].map((n) => ({ id: `b${n}`, label: `Building ${n}`, lat: 35.908 + n / 1000, lng: -79.084 - n / 1000, note: n === 4 ? 'Enter from the back lot' : '' })),
  rules: [
    { id: 'r1', type: 'pattern', value: '1xx', buildingId: 'b1' },
    { id: 'r2', type: 'pattern', value: '2xx', buildingId: 'b2' },
    { id: 'r3', type: 'pattern', value: '3xx', buildingId: 'b3' },
    { id: 'r4', type: 'pattern', value: '4xx', buildingId: 'b4' },
  ],
};

async function load(path, type) {
  const { headers, rows } = await readRouteFile(fileFrom(path, type));
  const mapping = detectColumns(headers);
  expect(missingRequired(mapping)).toEqual([]);
  return rowsToStops(rows, mapping);
}

describe('sample week (Routific-style CSV)', async () => {
  const { stops, skipped } = await load('sample-data/sample-week.csv', 'text/csv');

  it('reads every stop', () => {
    expect(stops).toHaveLength(59);
    expect(skipped).toEqual([]);
  });

  it('finds both complexes and the duplex before anything is set up', () => {
    const found = detectComplexes(stops.map((s) => ({ ...s })));
    expect(found.map((c) => c.street)).toEqual(expect.arrayContaining(['400 Sycamore Ridge Ln', '410 Sycamore Ridge Ln', '77 Maple Court', '208 Shelton St']));
    expect(found.find((c) => c.street === '400 Sycamore Ridge Ln').households).toBe(16);
  });

  it('after setup, pattern units go to buildings and odd units are flagged, not sent to the entrance silently', () => {
    const resolved = resolveStops(stops, { complexes: [sycamore] });
    const atComplex = resolved.filter((s) => s.place.complexId === 'c1');
    expect(atComplex).toHaveLength(18);
    const unmatched = atComplex.filter((s) => s.place.status === 'unmatched').map((s) => s.unit).sort();
    expect(unmatched).toEqual(['', '4B', '9C']);
    // "410 Sycamore Ridge Ln Bldg 4 Apt 402" -> unit 402 -> Building 4
    expect(atComplex.find((s) => s.unit === '402').place).toMatchObject({ label: 'Building 4', note: 'Enter from the back lot' });

    const issues = findIssues({ stops: resolved, complexes: [sycamore] });
    expect(issues.map((i) => i.title)).toEqual(['2 complexes need building locations', 'Sycamore Ridge Apartments: 3 new units have no building']);
  });

  it('route 2 visits the complex building by building, and links use building coordinates', () => {
    const routes = buildRoutes(resolveStops(stops, { complexes: [sycamore] }));
    const r2 = routes.find((r) => r.id === '2');
    const labels = r2.stops.map((s) => s.place.label || (s.place.complexId ? '?' : '-'));
    // houses first, then the complex grouped (Building 2 first: unit 212 came first in Routific's order), unplaced at the end of the block
    expect(labels.join(' ')).toBe('- - Building 2 Building 2 Building 1 Building 1 Building 1 Building 1 Building 3 Building 3 Building 3 Building 4 Building 4 Building 4 ? ? ? -');
    const links = splitRouteLinks(r2.stops, 10);
    expect(links).toHaveLength(1);
    expect(links[0].places).toBe(8); // 19 households: 3 houses + 4 buildings + 1 entrance stop for the 3 unplaced units
    expect(decodeURIComponent(links[0].url)).toContain('35.910000,-79.086000'); // Building 2
  });

  it('route 3 (28 stops) splits into three links (the duplex counts once), each with a scannable QR code', async () => {
    const r3 = buildRoutes(resolveStops(stops, { complexes: [sycamore] })).find((r) => r.id === '3');
    expect(r3.households).toBe(28);
    const links = splitRouteLinks(r3.stops, 10);
    expect(links.map((l) => l.label)).toEqual(['Part 1: stops 1–11', 'Part 2: stops 12–21', 'Part 3: stops 22–28']);
    for (const l of links) {
      const qr = QRCode.create(l.url, { errorCorrectionLevel: 'L' });
      expect(qr.version).toBeLessThanOrEqual(15);
    }
  });
});

describe('sample week (Monday macro .xlsx with title rows)', async () => {
  const { stops } = await load('sample-data/monday-macro.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

  it('skips the title rows and splits units out of the street', () => {
    expect(stops).toHaveLength(59);
    const s = stops.find((x) => x.street === '400 Sycamore Ridge Ln' && x.unit === '212');
    expect(s).toBeTruthy();
    expect(stops.find((x) => x.unit === '402')).toMatchObject({ street: '410 Sycamore Ridge Ln', buildingHint: '4' });
  });
});
