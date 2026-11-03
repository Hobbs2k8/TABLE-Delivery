// Build routes from resolved stops: keep the file's stop order, but pull
// all stops at one complex together and order them building by building.

import { naturalCompare } from './address.js';

/** Group key for "same place": complexes by id, other shared addresses by address. */
function groupKeyOf(stop) {
  if (stop.place?.complexId) return `c:${stop.place.complexId}`;
  if (stop.place?.status === 'not-set-up') return `a:${stop.key}`;
  return null;
}

/** Sort stops by the file's stop order, falling back to row order. */
function byFileOrder(a, b) {
  const ao = a.order ?? Infinity;
  const bo = b.order ?? Infinity;
  if (ao !== bo) return ao - bo;
  return a.fileIndex - b.fileIndex;
}

/**
 * Reorder one route's stops:
 * - a complex's block sits where its first stop was in the original order
 * - inside the block: buildings in order of first appearance, units in natural order,
 *   households with no building last
 */
export function orderRouteStops(stops) {
  const sorted = [...stops].sort(byFileOrder);
  const blocks = [];
  const blockByKey = new Map();
  for (const s of sorted) {
    const k = groupKeyOf(s);
    if (!k) {
      blocks.push([s]);
      continue;
    }
    if (!blockByKey.has(k)) {
      const block = [];
      blockByKey.set(k, block);
      blocks.push(block);
    }
    blockByKey.get(k).push(s);
  }

  return blocks.flatMap((block) => {
    if (block.length === 1) return block;
    const buildingRank = new Map();
    for (const s of block) {
      const b = s.place?.buildingId;
      if (b && !buildingRank.has(b)) buildingRank.set(b, buildingRank.size);
    }
    return [...block].sort((a, b) => {
      const ra = a.place?.buildingId ? buildingRank.get(a.place.buildingId) : Infinity;
      const rb = b.place?.buildingId ? buildingRank.get(b.place.buildingId) : Infinity;
      if (ra !== rb) return ra - rb;
      return naturalCompare(a.unit, b.unit) || a.fileIndex - b.fileIndex;
    });
  });
}

const needsAttention = (s) => s.place && s.place.status !== 'ok';

/** "12" -> "Route 12"; names like "Tue 03 · Carrboro" or "Route 01a-Efland" stay as they are. */
export const routeTitle = (name) => (/^[0-9]+[a-z]?$/i.test(name) ? `Route ${name}` : name);

/**
 * All routes with numbered stops and totals, sorted by delivery day then name.
 * Households with no route yet (route '') are left out; see unroutedStops().
 * A route is identified by day + name, since a driver can run a route on two days.
 */
export function buildRoutes(resolvedStops) {
  const byRoute = new Map();
  for (const s of resolvedStops) {
    if (!s.route) continue;
    const id = s.day ? `${s.day}|${s.route}` : s.route;
    if (!byRoute.has(id)) byRoute.set(id, []);
    byRoute.get(id).push(s);
  }
  return [...byRoute.entries()]
    .map(([id, stops]) => {
      const ordered = orderRouteStops(stops).map((s, i) => ({ ...s, number: i + 1 }));
      const drivers = [...new Set(ordered.map((s) => s.driver).filter(Boolean))];
      const bags = ordered.reduce((sum, s) => sum + (s.bags ?? 0), 0);
      const special = ordered.reduce((sum, s) => sum + (s.special ?? 0), 0);
      const problems = ordered.filter(needsAttention).length;
      return {
        id,
        name: stops[0].route,
        title: routeTitle(stops[0].route),
        day: stops[0].day || '',
        dayOrder: stops[0].dayOrder ?? 99,
        driver: drivers.join(', '),
        stops: ordered,
        households: ordered.length,
        bags,
        special,
        hasBags: ordered.some((s) => s.bags !== null),
        problems,
        status: problems ? 'attention' : 'ready',
      };
    })
    .sort((a, b) => a.dayOrder - b.dayOrder || naturalCompare(a.name, b.name));
}

/** Households that aren't on any route yet (the file had no routes). */
export const unroutedStops = (resolvedStops) => resolvedStops.filter((s) => !s.route);
