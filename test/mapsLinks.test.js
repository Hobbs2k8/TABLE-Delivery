import { describe, it, expect } from 'vitest';
import QRCode from 'qrcode';
import { splitRouteLinks, toVisits, destinationFor, buildDirectionsUrl, MAX_URL_LENGTH } from '../src/lib/mapsLinks.js';

const house = (i) => ({
  number: i,
  street: `${100 + i} Long Country Road Extension`,
  city: 'Hillsborough',
  state: 'NC',
  zip: '27278',
  unit: '',
  name: 'Secret Name',
  phone: '919-555-0100',
  place: { kind: 'address', status: 'ok' },
});
const bldg = (i, lat, lng) => ({ ...house(i), unit: `${i}`, place: { kind: 'building', status: 'ok', lat, lng, buildingId: `${lat}` } });

function parse(url) {
  const u = new URL(url);
  return {
    host: u.host,
    path: u.pathname,
    api: u.searchParams.get('api'),
    destination: u.searchParams.get('destination'),
    waypoints: u.searchParams.get('waypoints')?.split('|') ?? [],
    travelmode: u.searchParams.get('travelmode'),
    origin: u.searchParams.get('origin'),
  };
}

describe('destinationFor', () => {
  it('uses pins as 6-decimal coordinates and never includes the unit', () => {
    expect(destinationFor(bldg(1, 35.9123456789, -79.05))).toBe('35.912346,-79.050000');
    expect(destinationFor({ ...house(1), unit: '4B' })).toBe('101 Long Country Road Extension, Hillsborough, NC 27278');
  });
});

describe('toVisits', () => {
  it('collapses back-to-back stops at the same building into one place', () => {
    const v = toVisits([bldg(1, 35.9, -79), bldg(2, 35.9, -79), bldg(3, 35.9, -79), house(4)]);
    expect(v).toHaveLength(2);
    expect(v[0]).toMatchObject({ first: 1, last: 3, households: 3 });
  });
});

describe('splitRouteLinks', () => {
  const stops = Array.from({ length: 28 }, (_, i) => house(i + 1));

  it('splits 28 stops into 10 + 10 + 8 with clear labels', () => {
    const links = splitRouteLinks(stops, 10);
    expect(links.map((l) => l.label)).toEqual(['Part 1: stops 1–10', 'Part 2: stops 11–20', 'Part 3: stops 21–28']);
  });

  it('builds well-formed Maps URLs: api=1, no origin, driving, ≤9 waypoints', () => {
    for (const l of splitRouteLinks(stops, 10)) {
      const p = parse(l.url);
      expect(p).toMatchObject({ host: 'www.google.com', path: '/maps/dir/', api: '1', travelmode: 'driving', origin: null });
      expect(p.waypoints.length).toBeLessThanOrEqual(9);
      expect(l.url).not.toMatch(/Secret|555/); // no names or phones
      expect(l.url).toContain('%7C'); // pipes are encoded
      expect(l.url.length).toBeLessThanOrEqual(MAX_URL_LENGTH);
    }
    const first = parse(splitRouteLinks(stops, 10)[0].url);
    expect(first.waypoints[0]).toBe('101 Long Country Road Extension, Hillsborough, NC 27278');
    expect(first.destination).toBe('110 Long Country Road Extension, Hillsborough, NC 27278');
  });

  it('caps stops per link at 10 even if asked for more, and supports small values', () => {
    expect(splitRouteLinks(stops, 25)).toHaveLength(3);
    expect(splitRouteLinks(stops, 4)).toHaveLength(7);
    expect(splitRouteLinks(stops, 0)).toHaveLength(3);
  });

  it('labels one-link routes without "Part"', () => {
    expect(splitRouteLinks(stops.slice(0, 3), 10)[0].label).toBe('All stops: stops 1–3');
    expect(splitRouteLinks(stops.slice(0, 1), 10)[0].label).toBe('All stops: stop 1');
    expect(parse(splitRouteLinks(stops.slice(0, 1), 10)[0].url).waypoints).toEqual([]);
  });

  it('stop ranges count households, so a 6-unit building is still one place', () => {
    const route = [house(1), ...[2, 3, 4, 5, 6, 7].map((i) => bldg(i, 35.9, -79)), ...Array.from({ length: 12 }, (_, i) => house(i + 8))];
    const links = splitRouteLinks(route, 10);
    expect(links[0].label).toBe('Part 1: stops 1–15');
    expect(links[0].places).toBe(10);
  });

  it('splits further if a link would pass 2,048 characters', () => {
    const huge = Array.from({ length: 10 }, (_, i) => ({ ...house(i + 1), street: `${i} ${'Very Long Street Name '.repeat(10)}` }));
    const links = splitRouteLinks(huge, 10);
    expect(links.length).toBeGreaterThan(1);
    links.forEach((l) => expect(l.url.length).toBeLessThanOrEqual(MAX_URL_LENGTH));
    expect(links.at(-1).last).toBe(10);
  });

  it('empty route gives no links', () => {
    expect(splitRouteLinks([], 10)).toEqual([]);
    expect(buildDirectionsUrl([])).toBe('');
  });
});

describe('QR codes', () => {
  it('generate for the longest possible link', async () => {
    const huge = Array.from({ length: 10 }, (_, i) => ({ ...house(i + 1), street: `${i} ${'Very Long Street Name '.repeat(4)}` }));
    const links = splitRouteLinks(huge, 10);
    const longest = links.reduce((a, b) => (a.url.length > b.url.length ? a : b)).url;
    expect(longest.length).toBeGreaterThan(1000);
    const svg = await QRCode.toString(longest, { type: 'svg', errorCorrectionLevel: 'L' });
    expect(svg).toContain('<svg');
  });
  it('typical 10-stop link stays small enough for a low-density QR', () => {
    const url = splitRouteLinks(Array.from({ length: 10 }, (_, i) => house(i + 1)), 10)[0].url;
    const qr = QRCode.create(url, { errorCorrectionLevel: 'L' });
    expect(qr.version).toBeLessThanOrEqual(20);
  });
});
