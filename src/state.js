// App state. This week's family data lives only here, in memory: it is
// gone when the tab closes. The one exception is the opt-in address list
// (street, town, unit per door; never names), see lib/addressBook.js.

import { resolveStops } from './lib/complexes.js';
import { buildRoutes, unroutedStops } from './lib/routes.js';
import { splitRouteLinks } from './lib/mapsLinks.js';
import { findIssues } from './lib/issues.js';
import { DEFAULT_RULES, estimateMinutes } from './lib/makeRoutes.js';
import { checkWeek, doorPins } from './lib/addressBook.js';
import { weekOf } from './lib/checkin.js';

export const state = {
  step: 'upload', // 'upload' | 'mapping' | 'review' | 'send'
  fileName: '',
  headers: [],
  rows: [],
  mapping: null,
  baseStops: [], // straight from the file, one per household
  skipped: [],
  pickups: 0, // pickup households left out
  fileHasRoutes: true,
  assignments: new Map(), // stopId -> { route, order, day } from "Make routes"
  routesMadeAt: null,
  lookups: new Map(), // address key -> { lat, lng }, only for addresses the coordinator chose to look up
  stops: [], // with place (building / pin / address) worked out
  routes: [],
  waiting: [], // households not on a route yet
  issues: [],
  selectedRoute: null,
  day: 'all', // delivery-day filter for Review and Print
  // saved in IndexedDB (loaded at startup)
  complexes: [],
  pins: [],
  addressBook: [], // the address list (doors seen in earlier weeks; empty until the coordinator starts it)
  fresh: [], // this week's stops that are new or not reviewed yet
  freshToSave: [], // address-list records this week adds or updates (saved by upload.js)
  perLink: 10,
  checkin: { url: '', key: '' }, // TABLE's Apps Script web app, for driver check-ins and shared pins
  rules: DEFAULT_RULES,
};

/** Re-run everything after the file, complexes, pins, routes or settings change. */
export function recompute() {
  const base = state.baseStops.map((s) => (state.assignments.has(s.id) ? { ...s, ...state.assignments.get(s.id) } : s));
  const doors = doorPins(state.addressBook);
  state.stops = resolveStops(base, { complexes: state.complexes, pins: state.pins, doors });
  const week = checkWeek(state.stops, state.addressBook, weekOf());
  const freshIds = new Set(week.fresh.map((s) => s.id));
  state.fresh = state.stops.filter((s) => freshIds.has(s.id));
  state.freshToSave = week.toSave;
  state.routes = buildRoutes(state.stops).map((r) => {
    const minutes = estimateMinutes(r.stops, state.rules, state.lookups);
    const overBags = r.bags > state.rules.maxBags;
    const overTime = minutes !== null && minutes > state.rules.maxMinutes;
    return { ...r, minutes, overBags, overTime, links: splitRouteLinks(r.stops, state.perLink) };
  });
  state.waiting = unroutedStops(state.stops);
  state.issues = findIssues({
    stops: state.stops,
    complexes: state.complexes,
    pins: state.pins,
    doors,
    fresh: state.fresh,
    skipped: state.skipped,
    routes: state.routes,
    waiting: state.waiting,
    rules: state.rules,
  });
  const days = routeDays();
  if (state.day !== 'all' && !days.some((d) => d.label === state.day)) state.day = 'all';
  const visible = visibleRoutes();
  if (!visible.some((r) => r.id === state.selectedRoute)) {
    state.selectedRoute = (visible.find((r) => r.status === 'attention') || visible[0])?.id ?? null;
  }
}

/** Delivery days that have routes, in week order, with route counts. */
export function routeDays() {
  const days = new Map();
  for (const r of state.routes) {
    if (!r.day) continue;
    const d = days.get(r.day) || { label: r.day, order: r.dayOrder, routes: 0, bags: 0 };
    d.routes++;
    d.bags += r.bags;
    days.set(r.day, d);
  }
  return [...days.values()].sort((a, b) => a.order - b.order);
}

/** Routes shown for the chosen delivery day. */
export const visibleRoutes = () => state.routes.filter((r) => state.day === 'all' || r.day === state.day);

export const totals = () => {
  const routes = visibleRoutes();
  const stops = routes.flatMap((r) => r.stops);
  return {
    routes: routes.length,
    stops: stops.length,
    bags: routes.reduce((n, r) => n + r.bags, 0),
    special: routes.reduce((n, r) => n + r.special, 0),
    needAttention: routes.filter((r) => r.status === 'attention').length,
    householdsAtEntrance: stops.filter((s) => s.place.status !== 'ok').length,
  };
};
