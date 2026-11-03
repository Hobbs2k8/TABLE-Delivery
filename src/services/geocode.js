// Find a point for a street address with OpenStreetMap Nominatim.
//
// PRIVACY: this is one of only two places the app talks to the internet.
// It only ever receives street, city, state and ZIP — never names, phones
// or unit numbers. The function signature makes that hard to get wrong.
//
// Used for:
//   - a complex's address when it's set up (automatic, once per complex)
//   - household addresses, ONLY when the coordinator clicks "Find on the map"
//     on the Make routes card and confirms (routes need a point per household)
//
// Nominatim policy (operations.osmfoundation.org/policies/nominatim):
// max 1 request/second, results must be cached, no autocomplete.
// Every answer is cached in this browser, so each address is looked up once, ever.

import { get, put } from '../store/db.js';
import { addressKey, DEFAULT_STATE } from '../lib/address.js';

const ENDPOINT = 'https://nominatim.openstreetmap.org/search';
let lastRequest = 0;

async function politeDelay() {
  const wait = lastRequest + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequest = Date.now();
}

const cacheKey = ({ street, city, zip }) => `geo:${addressKey({ street, city, zip })}`;

/** Returns { lat, lng } or null if the address could not be found. */
export async function findAddress({ street, city, state, zip }) {
  const key = cacheKey({ street, city, zip });
  const cached = await get('cache', key).catch(() => null);
  if (cached) return cached.value;

  const params = new URLSearchParams({ format: 'jsonv2', limit: '1', countrycodes: 'us', street });
  if (city) params.set('city', city);
  params.set('state', state || DEFAULT_STATE);
  if (zip) params.set('postalcode', zip);

  await politeDelay();
  const res = await fetch(`${ENDPOINT}?${params}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`The map search service did not answer (error ${res.status}). Try again in a minute.`);
  const data = await res.json();
  const value = data[0] ? { lat: Number(data[0].lat), lng: Number(data[0].lon) } : null;
  await put('cache', { id: key, value });
  return value;
}

/**
 * Points this browser already found for these addresses (no network).
 * Returns Map(addressKey -> { lat, lng }).
 */
export async function cachedPoints(stops) {
  const out = new Map();
  for (const s of stops) {
    if (!s.key || out.has(s.key)) continue;
    const row = await get('cache', cacheKey(s)).catch(() => null);
    if (row?.value) out.set(s.key, row.value);
  }
  return out;
}

/**
 * Look up many addresses, one per second. Calls onProgress(done, total, found)
 * after each one; stop early by returning false from shouldContinue().
 * Returns { points: Map(addressKey -> point), notFound: [stop] }.
 */
export async function findMany(stops, { onProgress, shouldContinue = () => true } = {}) {
  const unique = [...new Map(stops.map((s) => [s.key, s])).values()];
  const points = new Map();
  const notFound = [];
  for (let i = 0; i < unique.length && shouldContinue(); i++) {
    const s = unique[i];
    const p = await findAddress({ street: s.street, city: s.city, state: s.state, zip: s.zip });
    if (p) points.set(s.key, p);
    else notFound.push(s);
    onProgress?.(i + 1, unique.length, points.size);
  }
  return { points, notFound };
}
