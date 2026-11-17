// The address list: every delivery door TABLE has had, so each week's file
// can be checked for new addresses and exact pins are reused.
//
// A door is one street address plus unit: "400 Sycamore Ridge Ln, Apt 3B".
// Record shape (IndexedDB 'addresses', synced like pins):
//   { id: door key, key: street key, street, city, state, zip, unit,
//     firstSeen, lastSeen (week, YYYY-MM-DD), reviewed: true|false,
//     lat?, lng?, note? }   // lat/lng only when someone dropped a pin
// Never names, phones, diet or notes from the file.
//
// Pure functions, no DOM. Tested in test/addressBook.test.js.

import { addressKey, normalizeUnit } from './address.js';
import { bestInsertion } from './routing.js';
import { pointOf } from './makeRoutes.js';

/** "400 SYCAMORE RIDGE LN|CARRBORO#3B". The same door every week, however the file spells the unit. */
export function doorKey(stop) {
  const key = stop.key || addressKey(stop);
  return key ? `${key}#${normalizeUnit(stop.unit || '').toUpperCase()}` : '';
}

/** A new record for a door seen this week (only what's needed to find it). */
export function recordFor(stop, week, reviewed) {
  return {
    id: doorKey(stop),
    key: stop.key || addressKey(stop),
    street: stop.street || '',
    city: stop.city || '',
    state: stop.state || '',
    zip: stop.zip || '',
    unit: stop.unit || '',
    firstSeen: week,
    lastSeen: week,
    reviewed,
  };
}

// Marker record: the coordinator chose to start the list. Kept with the
// addresses so it syncs, and so a single unit pin doesn't "start" the list.
export const STARTED_ID = '__started__';

/** Index the list by door key, leaving out deleted records. */
export function indexBook(book) {
  return new Map(book.filter((r) => !r.deleted).map((r) => [r.id, r]));
}

/**
 * Compare this week's stops with the list.
 * Returns { started, fresh: stops whose door is new or not reviewed yet, toSave: records to write }.
 * `started` is false until the coordinator starts the list; until then nothing is saved.
 */
export function checkWeek(stops, book, week) {
  const byId = indexBook(book);
  const started = byId.has(STARTED_ID);
  if (!started) return { started, fresh: [], toSave: [] };
  const fresh = [];
  const toSave = new Map();
  for (const s of stops) {
    const id = doorKey(s);
    if (!id) continue;
    const r = byId.get(id) || toSave.get(id);
    if (!r) {
      toSave.set(id, recordFor(s, week, false));
      fresh.push(s);
    } else {
      if (!r.reviewed) fresh.push(s);
      if (r.lastSeen < week && !toSave.has(id)) toSave.set(id, { ...r, lastSeen: week });
    }
  }
  return { started, fresh, toSave: [...toSave.values()] };
}

/** Records to start the list from this week's file: every door, already reviewed. */
export function startBook(stops, week) {
  const out = new Map([[STARTED_ID, { id: STARTED_ID, startedWeek: week }]]);
  for (const s of stops) {
    const id = doorKey(s);
    if (id && !out.has(id)) out.set(id, recordFor(s, week, true));
  }
  return [...out.values()];
}

/** Door pins as Map(doorKey -> record) for resolveStops. */
export function doorPins(book) {
  return new Map(book.filter((r) => !r.deleted && Number.isFinite(r.lat) && Number.isFinite(r.lng)).map((r) => [r.id, r]));
}

/**
 * Best route for one household: the route where it adds the fewest minutes,
 * on the same delivery day, without going over the bag limit.
 * Only routes where every stop has a real map point are considered, so the
 * answer is never a guess. Returns
 *   { route, addedMinutes, current: true|false } or { reason } when it can't say.
 */
export function suggestRoute(stop, routes, rules, lookups = new Map()) {
  const p = pointOf(stop, lookups);
  if (!p) return { reason: 'no-point' };
  const bags = stop.bags ?? 0;
  let best = null;
  let skippedUnknown = 0;
  for (const r of routes) {
    if (stop.day && r.day && r.day !== stop.day) continue;
    const others = r.stops.filter((s) => s.id !== stop.id);
    const pts = others.map((s) => pointOf(s, lookups));
    if (pts.some((x) => !x)) {
      skippedUnknown++;
      continue;
    }
    const isCurrent = others.length !== r.stops.length;
    const load = others.reduce((n, s) => n + (s.bags ?? 0), 0);
    if (!isCurrent && load + bags > rules.maxBags) continue;
    const ins = bestInsertion(pts, p, rules.depot, rules.stopMinutes);
    if (!best || ins.added < best.addedMinutes) best = { route: r, addedMinutes: ins.added, current: isCurrent };
  }
  if (!best) return { reason: skippedUnknown ? 'routes-not-pinned' : 'no-room' };
  return best;
}
