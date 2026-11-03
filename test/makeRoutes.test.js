// Route making on TABLE's workbook format (sample-data/table-master-sample.xlsx:
// fake data in the MASTER shape, one row per child, no routes, with lat/lng).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { readRouteFile } from '../src/lib/parse.js';
import { detectColumns, rowsToStops } from '../src/lib/columns.js';
import { resolveStops } from '../src/lib/complexes.js';
import { buildRoutes, unroutedStops } from '../src/lib/routes.js';
import { build, legMinutes } from '../src/lib/routing.js';
import { DEFAULT_RULES, routingGroups, assignmentsFrom, estimateMinutes, pointOf, assignDays, routeArea, formatMinutes } from '../src/lib/makeRoutes.js';

const file = new File([readFileSync('sample-data/table-master-sample.xlsx')], 'table-master-sample.xlsx');
const { headers, rows } = await readRouteFile(file);
const parsed = rowsToStops(rows, detectColumns(headers));
const resolved = resolveStops(parsed.stops, {});

function makeRoutes(stops, rules = DEFAULT_RULES, lookups = new Map()) {
  const { groups, missing } = routingGroups(stops, lookups);
  const results = groups.map((g) => build(g.households, { ...rules, seed: 1 }));
  return { assignments: assignmentsFrom(groups, results, rules, lookups), missing };
}
const apply = (stops, assignments) => stops.map((s) => (assignments.has(s.id) ? { ...s, ...assignments.get(s.id) } : s));

describe('reading the sample workbook', () => {
  it('groups 168 child rows into households and skips pickups', () => {
    expect(rows).toHaveLength(168);
    expect(parsed.hasRoutes).toBe(false);
    expect(parsed.pickups).toBeGreaterThan(0);
    expect(parsed.stops.length + parsed.pickups).toBe(67);
    const bags = parsed.stops.reduce((n, s) => n + s.bags, 0);
    expect(bags).toBeLessThan(168); // pickup children are not delivered
    expect(parsed.stops.every((s) => s.lat !== null)).toBe(true);
    expect(parsed.stops.filter((s) => s.unit).map((s) => s.unit)).toContain('1A');
  });
  it('nothing is on a route yet', () => {
    expect(buildRoutes(resolved)).toEqual([]);
    expect(unroutedStops(resolved)).toHaveLength(parsed.stops.length);
  });
});

describe('making routes', () => {
  const { assignments, missing } = makeRoutes(resolved);
  const routes = buildRoutes(apply(resolved, assignments));

  it('puts every household on exactly one route', () => {
    expect(missing).toEqual([]);
    expect(assignments.size).toBe(resolved.length);
    expect(routes.reduce((n, r) => n + r.households, 0)).toBe(resolved.length);
  });

  it('keeps every route within 30 bags and 2 hours', () => {
    for (const r of routes) {
      expect(r.bags).toBeLessThanOrEqual(30);
      expect(estimateMinutes(r.stops, DEFAULT_RULES)).toBeLessThanOrEqual(120);
    }
  });

  it('spreads routes over Tue / Wed / Thu with similar bag totals', () => {
    const byDay = new Map();
    for (const r of routes) byDay.set(r.day, (byDay.get(r.day) || 0) + r.bags);
    expect([...byDay.keys()].sort()).toEqual(['Thursday', 'Tuesday', 'Wednesday']);
    const loads = [...byDay.values()];
    expect(Math.max(...loads) - Math.min(...loads)).toBeLessThanOrEqual(30);
  });

  it('names routes by day, number and town, in week order', () => {
    expect(routes[0].name).toMatch(/^Tue 01 · [A-Z]/);
    expect(routes.map((r) => r.dayOrder)).toEqual([...routes.map((r) => r.dayOrder)].sort((a, b) => a - b));
  });

  it('gives the same routes every time', () => {
    const again = makeRoutes(resolved).assignments;
    expect([...again.entries()]).toEqual([...assignments.entries()]);
  });

  it('keeps households from the file days on their day', () => {
    const withDays = resolved.map((s, i) => ({ ...s, day: i % 2 ? 'Tuesday' : 'Thursday', dayOrder: i % 2 ? 1 : 3 }));
    const a = makeRoutes(withDays).assignments;
    for (const s of withDays) expect(a.get(s.id).day).toBe(s.day);
  });

  it('lists households with no map point instead of guessing', () => {
    const noPoint = resolved.map((s, i) => (i < 3 ? { ...s, lat: null, lng: null } : s));
    const { missing: m, assignments: a } = makeRoutes(noPoint);
    expect(m).toHaveLength(3);
    expect(a.size).toBe(resolved.length - 3);
  });
});

describe('helpers', () => {
  it('pointOf prefers building pins, then file coordinates, then looked-up addresses', () => {
    const s = { key: 'K', lat: 1, lng: 2, place: { kind: 'building', lat: 5, lng: 6 } };
    expect(pointOf(s)).toEqual({ lat: 5, lng: 6 });
    expect(pointOf({ ...s, place: { kind: 'address' } })).toEqual({ lat: 1, lng: 2 });
    expect(pointOf({ key: 'K', lat: null, lng: null, place: { kind: 'address' } }, new Map([['K', { lat: 9, lng: 9 }]]))).toEqual({ lat: 9, lng: 9 });
    expect(pointOf({ key: 'K', lat: null, lng: null })).toBeNull();
  });
  it('assignDays balances bags', () => {
    const r = (bags) => ({ stops: [{ bags }] });
    const routes = [r(30), r(20), r(20), r(10)];
    assignDays(routes, ['Tuesday', 'Wednesday']);
    expect(routes.map((x) => x.day)).toEqual(['Tuesday', 'Wednesday', 'Wednesday', 'Tuesday']);
  });
  it('routeArea names the main towns', () => {
    expect(routeArea([{ city: 'Carrboro' }, { city: 'Carrboro' }, { city: 'Carrboro' }, { city: 'Carrboro' }, { city: 'Efland' }])).toBe('Carrboro'); // under a quarter: not named
    expect(routeArea([{ city: 'Carrboro' }, { city: 'Efland' }])).toBe('Carrboro, Efland');
  });
  it('doors in one complex are a short walk apart', () => {
    expect(legMinutes({ lat: 35.9, lng: -79.05 }, { lat: 35.9001, lng: -79.05 })).toBe(0.5);
  });
  it('formatMinutes', () => {
    expect(formatMinutes(47.4)).toBe('47 min');
    expect(formatMinutes(125)).toBe('2 h 05 min');
    expect(formatMinutes(null)).toBe('');
  });
});
