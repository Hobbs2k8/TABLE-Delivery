// Making routes when the weekly file has none (TABLE's workbook often doesn't).
// lib/routing.js does the search; this file prepares its input and turns its
// output into route names, days and stop order. Pure functions, no DOM.
// Naming and day-balancing adapted from monocoder77/table-route-packets.

import { routeMinutes, bestInsertion } from './routing.js';
import { dayInfo, dayShort } from './columns.js';

export const TABLE_DEPOT = { label: 'TABLE, 311 E Main St, Carrboro', lat: 35.9111695, lng: -79.0676697 };

// The rules TABLE gave: start at TABLE, at most 30 bags, under 2 hours, no drive back.
export const DEFAULT_RULES = {
  depot: TABLE_DEPOT,
  maxBags: 30,
  maxMinutes: 120,
  maxStops: 0, // 0 = no cap; 10 keeps every made route in one Google Maps link
  stopMinutes: 4,
  days: ['Tuesday', 'Wednesday', 'Thursday'],
};

/**
 * The map point a household is routed from: its building or house pin, then
 * the file's own latitude/longitude, then an address looked up on request.
 */
export function pointOf(stop, lookups = new Map()) {
  const p = stop.place;
  if (p && (p.kind === 'building' || p.kind === 'pin') && Number.isFinite(p.lat)) return { lat: p.lat, lng: p.lng };
  if (Number.isFinite(stop.lat) && Number.isFinite(stop.lng)) return { lat: stop.lat, lng: stop.lng };
  return lookups.get(stop.key) || null;
}

/**
 * Split households into routing groups (one per delivery day in the file, or
 * one for everyone) and list the ones with no map point yet.
 * Each group: { day, dayOrder, stops, households: [{ id, lat, lng, bags }] }.
 * Households are sorted by address so the same week always gives the same routes.
 */
export function routingGroups(stops, lookups) {
  const fileDays = stops.some((s) => s.day);
  const groups = new Map();
  const missing = [];
  const sorted = [...stops].sort((a, b) => (a.key + a.unit < b.key + b.unit ? -1 : a.key + a.unit > b.key + b.unit ? 1 : a.fileIndex - b.fileIndex));
  for (const s of sorted) {
    const point = pointOf(s, lookups);
    if (!point) {
      missing.push(s);
      continue;
    }
    const k = fileDays ? s.day : '';
    if (!groups.has(k)) groups.set(k, { day: k, dayOrder: fileDays ? s.dayOrder : 99, stops: [], households: [] });
    const g = groups.get(k);
    g.households.push({ id: g.stops.length, lat: point.lat, lng: point.lng, bags: s.bags ?? 1 });
    g.stops.push(s);
  }
  return { groups: [...groups.values()], missing, fileDays };
}

const bagsOf = (route) => route.stops.reduce((n, s) => n + (s.bags ?? 1), 0);

/**
 * Routes with no day (the file has none) go to the day with the fewest bags
 * so far, whole route at a time, so days come out even.
 */
export function assignDays(routes, days, fixed = []) {
  const load = days.map((label) => {
    const already = fixed.filter((r) => r.day === label);
    return { label, order: dayInfo(label).order, bags: already.reduce((n, r) => n + bagsOf(r), 0), routes: already.length };
  });
  for (const r of [...routes].sort((a, b) => bagsOf(b) - bagsOf(a))) {
    const d = load.reduce((best, x) => (x.bags < best.bags || (x.bags === best.bags && x.routes < best.routes) ? x : best));
    d.bags += bagsOf(r);
    d.routes++;
    r.day = d.label;
    r.dayOrder = d.order;
  }
}

/** The one or two towns most of a route's doors are in. */
export function routeArea(stops) {
  const counts = new Map();
  for (const s of stops) {
    if (!s.city) continue;
    const k = s.city.toLowerCase();
    const c = counts.get(k) || { city: s.city, n: 0 };
    c.n++;
    counts.set(k, c);
  }
  const top = [...counts.values()].sort((a, b) => b.n - a.n);
  if (!top.length) return '';
  return top[1] && top[1].n >= stops.length / 4 ? `${top[0].city}, ${top[1].city}` : top[0].city;
}

/**
 * Turn the search results into route assignments for every routed household.
 * Routes for each day are numbered clockwise around TABLE, so neighbors get
 * neighboring numbers, and named after their towns: "Tue 03 · Carrboro".
 * Returns Map(stopId -> { route, order, day, dayOrder }).
 */
export function assignmentsFrom(groups, results, rules, lookups) {
  const made = [];
  groups.forEach((g, i) => {
    for (const ids of results[i].routes) made.push({ day: g.day, dayOrder: g.dayOrder, stops: ids.map((id) => g.stops[id]) });
  });
  const dayless = made.filter((r) => !r.day);
  if (dayless.length && rules.days.length) assignDays(dayless, rules.days, made.filter((r) => r.day));

  const depot = rules.depot;
  const angle = (route) => {
    const pts = route.stops.map((s) => pointOf(s, lookups));
    const lat = pts.reduce((n, p) => n + p.lat, 0) / pts.length;
    const lng = pts.reduce((n, p) => n + p.lng, 0) / pts.length;
    const a = Math.atan2((lng - depot.lng) * Math.cos((depot.lat * Math.PI) / 180), lat - depot.lat);
    return (a + 2 * Math.PI) % (2 * Math.PI);
  };
  const byDay = new Map();
  for (const r of made) {
    if (!byDay.has(r.day)) byDay.set(r.day, []);
    byDay.get(r.day).push(r);
  }
  const assignments = new Map();
  for (const routes of byDay.values()) {
    routes
      .map((r) => ({ r, a: angle(r) }))
      .sort((x, y) => x.a - y.a)
      .forEach(({ r }, i) => {
        const area = routeArea(r.stops);
        const name = `${r.day ? `${dayShort(r.day)} ` : ''}${String(i + 1).padStart(2, '0')}${area ? ` · ${area}` : ''}`;
        r.stops.forEach((s, k) => assignments.set(s.id, { route: name, order: k + 1, day: r.day, dayOrder: r.dayOrder ?? 99 }));
      });
  }
  return assignments;
}

/** Estimated minutes for a route driven in order from TABLE, or null if a stop has no point. */
export function estimateMinutes(stops, rules, lookups) {
  const pts = stops.map((s) => pointOf(s, lookups));
  if (!pts.length || pts.some((p) => !p)) return null;
  return routeMinutes(pts, rules.depot, rules.stopMinutes);
}

export function formatMinutes(mins) {
  if (mins == null) return '';
  const m = Math.round(mins);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

/**
 * Move one household onto another route by hand. It goes where it adds the
 * fewest minutes (or last, if a stop has no map point). Returns the new
 * assignments for the moved household and every stop on the target route,
 * so the target's stop order is written out 1..n.
 */
export function moveStopAssignments(stop, target, rules, lookups) {
  const others = target.stops.filter((s) => s.id !== stop.id);
  const pts = others.map((s) => pointOf(s, lookups));
  const p = pointOf(stop, lookups);
  const index = p && pts.every(Boolean) ? bestInsertion(pts, p, rules.depot, rules.stopMinutes).index : others.length;
  const ordered = [...others.slice(0, index), stop, ...others.slice(index)];
  const day = target.day ?? others[0]?.day ?? '';
  const dayOrder = others[0]?.dayOrder ?? 99;
  const route = others[0]?.route ?? target.name;
  return new Map(ordered.map((s, k) => [s.id, { route, order: k + 1, day, dayOrder }]));
}
