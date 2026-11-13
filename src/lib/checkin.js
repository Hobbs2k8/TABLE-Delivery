// Driver check-in: what goes into a route's check-in QR code, and the
// events a driver's phone sends to TABLE's own Google Sheet.
//
// The route travels in the link's #fragment. Browsers never send the
// fragment to the web host (GitHub Pages), so the stop list only exists on
// the driver's phone and, once they tap "Delivered", in TABLE's Google Sheet.
// No names, phones, notes or diet details go in: only what a driver needs to
// find the door (stop number, street, unit, building, bags).
//
// Pure functions, no DOM. Tested in test/checkin.test.js.

import { deflateSync, inflateSync, strToU8, strFromU8 } from 'fflate';
import { destinationFor } from './mapsLinks.js';

export const PAYLOAD_VERSION = 1;

// ---- base64url (no padding) ----
function toB64url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64url(text) {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Monday of the week `date` falls in, as YYYY-MM-DD (local time). Labels this week's deliveries in the Sheet. */
export function weekOf(date = new Date()) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * The compact route object that goes in the QR code.
 * s: [number, street, unit, building, bags, townIndex, destination?]
 * destination is only set when it differs from "street, town" (a building or house pin).
 */
export function routePayload(route, { url, key, week }) {
  const towns = [];
  const townIndex = (t) => {
    const i = towns.indexOf(t || '');
    if (i >= 0) return i;
    towns.push(t || '');
    return towns.length - 1;
  };
  const stops = route.stops.map((s) => {
    const dest = destinationFor(s);
    const pinned = s.place && (s.place.kind === 'building' || s.place.kind === 'pin') ? dest : '';
    const row = [s.number, s.street || '', s.unit || '', s.place?.kind === 'building' ? s.place.label || '' : '', s.bags ?? '', townIndex(s.city), pinned];
    while (row.length > 2 && (row[row.length - 1] === '' || row[row.length - 1] == null)) row.pop();
    return row;
  });
  return { v: PAYLOAD_VERSION, r: route.title, d: route.day || '', w: week, u: url, k: key, t: towns, s: stops };
}

export function encodePayload(payload) {
  return toB64url(deflateSync(strToU8(JSON.stringify(payload)), { level: 9 }));
}

/** Returns the payload, or null if the text is damaged or from an unknown version. */
export function decodePayload(text) {
  try {
    const p = JSON.parse(strFromU8(inflateSync(fromB64url(String(text).replace(/^#/, '')))));
    if (!p || p.v !== PAYLOAD_VERSION || !Array.isArray(p.s)) return null;
    return p;
  } catch {
    return null;
  }
}

/** Full driver link: the driver page next to the app, with the route in the fragment. */
export function driverLink(appUrl, route, opts) {
  const base = new URL('driver.html', appUrl);
  base.hash = '';
  return `${base.href}#${encodePayload(routePayload(route, opts))}`;
}

/** Stops as the driver page uses them. */
export function stopsFromPayload(p) {
  return p.s.map(([number, street, unit = '', building = '', bags = '', town = 0, dest = '']) => {
    const city = p.t?.[town] || '';
    return { number, street, unit, building, bags, city, destination: dest || [street, city, 'NC'].filter(Boolean).join(', ') };
  });
}

/** Google Maps directions to one stop (no key needed). */
export function navigateUrl(destination) {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination).replace(/%20/g, '+')}&travelmode=driving`;
}

export const EVENT_TYPES = ['start', 'delivered', 'problem', 'photo', 'finish'];
export const PROBLEM_REASONS = ["Couldn't find the door", "Couldn't get in (gate or locked building)", 'Wrong address', 'Other'];

/** One thing a driver did, ready to send. Times are recorded on the phone when tapped. */
export function makeEvent(p, type, stop = null, extra = {}) {
  return {
    id: extra.id || (globalThis.crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`),
    type,
    at: extra.at || new Date().toISOString(),
    week: p.w || '',
    day: p.d || '',
    route: p.r || '',
    stop: stop ? stop.number : '',
    street: stop ? stop.street : '',
    unit: stop ? stop.unit : '',
    building: stop ? stop.building : '',
    bags: stop ? stop.bags : '',
    reason: extra.reason || '',
    note: extra.note || '',
    device: extra.device || '',
    photo: extra.photo || '',
  };
}

/** Latest status per stop number from a list of events (later events win; photos don't change status). */
export function stopStatuses(events) {
  const out = new Map();
  for (const e of [...events].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))) {
    if (e.type === 'delivered' || e.type === 'problem') out.set(e.stop, { status: e.type, reason: e.reason, at: e.at });
  }
  return out;
}
