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

/** All routes, naturally sorted, with numbered stops and totals. */
export function buildRoutes(resolvedStops) {
  const byRoute = new Map();
  for (const s of resolvedStops) {
    if (!byRoute.has(s.route)) byRoute.set(s.route, []);
    byRoute.get(s.route).push(s);
  }
  return [...byRoute.entries()]
    .sort(([a], [b]) => naturalCompare(a, b))
    .map(([id, stops]) => {
      const ordered = orderRouteStops(stops).map((s, i) => ({ ...s, number: i + 1 }));
      const drivers = [...new Set(ordered.map((s) => s.driver).filter(Boolean))];
      const bags = ordered.reduce((sum, s) => sum + (s.bags ?? 0), 0);
      const problems = ordered.filter(needsAttention).length;
      return {
        id,
        driver: drivers.join(', '),
        stops: ordered,
        households: ordered.length,
        bags,
        hasBags: ordered.some((s) => s.bags !== null),
        problems,
        status: problems ? 'attention' : 'ready',
      };
    });
}
