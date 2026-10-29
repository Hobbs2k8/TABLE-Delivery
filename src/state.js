// App state. This week's family data lives only here, in memory: it is
// gone when the tab closes and is never saved or sent anywhere.

import { resolveStops } from './lib/complexes.js';
import { buildRoutes } from './lib/routes.js';
import { splitRouteLinks } from './lib/mapsLinks.js';
import { findIssues } from './lib/issues.js';

export const state = {
  step: 'upload', // 'upload' | 'mapping' | 'review' | 'send'
  fileName: '',
  headers: [],
  rows: [],
  mapping: null,
  baseStops: [], // straight from the file
  skipped: [],
  stops: [], // with place (building / pin / address) worked out
  routes: [],
  issues: [],
  selectedRoute: null,
  // saved in IndexedDB (loaded at startup)
  complexes: [],
  pins: [],
  perLink: 10,
};

/** Re-run everything after the file, complexes, pins or settings change. */
export function recompute() {
  state.stops = resolveStops(state.baseStops, { complexes: state.complexes, pins: state.pins });
  state.routes = buildRoutes(state.stops).map((r) => ({ ...r, links: splitRouteLinks(r.stops, state.perLink) }));
  state.issues = findIssues({ stops: state.stops, complexes: state.complexes, pins: state.pins, skipped: state.skipped });
  if (!state.routes.some((r) => r.id === state.selectedRoute)) {
    state.selectedRoute = (state.routes.find((r) => r.status === 'attention') || state.routes[0])?.id ?? null;
  }
}

export const totals = () => ({
  routes: state.routes.length,
  stops: state.stops.length,
  bags: state.routes.reduce((n, r) => n + r.bags, 0),
  needAttention: state.routes.filter((r) => r.status === 'attention').length,
  householdsAtEntrance: state.stops.filter((s) => s.place.status !== 'ok').length,
});
