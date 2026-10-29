// Google Maps directions links (Maps URLs API, no key needed).
// https://developers.google.com/maps/documentation/urls/get-started
//
// Limits from Google's docs (checked Oct 2026):
// - up to 9 waypoints in the Google Maps app / desktop, only 3 in mobile browsers
// - 2,048 characters per URL
// We leave out `origin`, so the route starts wherever the driver is.

import { formatAddress } from './address.js';

export const MAX_STOPS_PER_LINK = 10; // 9 waypoints + 1 destination
export const MAX_URL_LENGTH = 2048;
const BASE = 'https://www.google.com/maps/dir/?api=1';

/** Where to send the driver: exact pin when we have one, otherwise the street address (never the unit). */
export function destinationFor(stop) {
  const p = stop.place;
  if (p && (p.kind === 'building' || p.kind === 'pin') && Number.isFinite(p.lat) && Number.isFinite(p.lng)) {
    return `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
  }
  return formatAddress(stop);
}

/**
 * Collapse back-to-back stops that go to the same spot (e.g. six households
 * in Building C) into one "visit", so they take one slot in the link.
 */
export function toVisits(stops) {
  const visits = [];
  for (const s of stops) {
    const dest = destinationFor(s);
    const last = visits[visits.length - 1];
    if (last && last.destination === dest) {
      last.last = s.number;
      last.households++;
    } else {
      visits.push({ destination: dest, first: s.number, last: s.number, households: 1 });
    }
  }
  return visits;
}

// Percent-encode, but write spaces as "+" (allowed by Google) to keep links
// and their QR codes shorter.
const enc = (v) => encodeURIComponent(v).replace(/%20/g, '+');

export function buildDirectionsUrl(destinations) {
  if (!destinations.length) return '';
  const dest = destinations[destinations.length - 1];
  const waypoints = destinations.slice(0, -1);
  let url = `${BASE}&destination=${enc(dest)}&travelmode=driving`;
  if (waypoints.length) url += `&waypoints=${enc(waypoints.join('|'))}`;
  return url;
}

/**
 * Split a route into links of at most `perLink` places each.
 * Parts that would exceed Google's URL length are split further.
 * Returns [{ part, first, last, label, url, places }].
 */
export function splitRouteLinks(stops, perLink = MAX_STOPS_PER_LINK) {
  const size = Math.max(1, Math.min(MAX_STOPS_PER_LINK, Math.floor(perLink) || MAX_STOPS_PER_LINK));
  const visits = toVisits(stops);
  const chunks = [];
  let i = 0;
  while (i < visits.length) {
    let n = Math.min(size, visits.length - i);
    while (n > 1 && buildDirectionsUrl(visits.slice(i, i + n).map((v) => v.destination)).length > MAX_URL_LENGTH) n--;
    chunks.push(visits.slice(i, i + n));
    i += n;
  }
  return chunks.map((chunk, idx) => {
    const first = chunk[0].first;
    const last = chunk[chunk.length - 1].last;
    const range = first === last ? `stop ${first}` : `stops ${first}–${last}`;
    return {
      part: idx + 1,
      first,
      last,
      places: chunk.length,
      label: chunks.length > 1 ? `Part ${idx + 1}: ${range}` : `All stops: ${range}`,
      url: buildDirectionsUrl(chunk.map((v) => v.destination)),
    };
  });
}
