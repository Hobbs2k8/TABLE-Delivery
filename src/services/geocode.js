// Find a point for a complex's street address with OpenStreetMap Nominatim.
//
// PRIVACY: this is one of only two places the app talks to the internet.
// It only ever receives street, city, state and ZIP — never names, phones
// or unit numbers. The function signature makes that hard to get wrong.
//
// Nominatim policy (operations.osmfoundation.org/policies/nominatim):
// max 1 request/second, results must be cached, no autocomplete.
// We look up once per complex, ever, and cache the answer.

import { get, put } from '../store/db.js';
import { addressKey } from '../lib/address.js';

const ENDPOINT = 'https://nominatim.openstreetmap.org/search';
let lastRequest = 0;

async function politeDelay() {
  const wait = lastRequest + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequest = Date.now();
}

/** Returns { lat, lng } or null if the address could not be found. */
export async function findAddress({ street, city, state, zip }) {
  const key = `geo:${addressKey({ street, city, zip })}`;
  const cached = await get('cache', key).catch(() => null);
  if (cached) return cached.value;

  const params = new URLSearchParams({ format: 'jsonv2', limit: '1', countrycodes: 'us', street });
  if (city) params.set('city', city);
  if (state) params.set('state', state);
  if (zip) params.set('postalcode', zip);

  await politeDelay();
  const res = await fetch(`${ENDPOINT}?${params}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`The map search service did not answer (error ${res.status}). Try again in a minute.`);
  const data = await res.json();
  const value = data[0] ? { lat: Number(data[0].lat), lng: Number(data[0].lon) } : null;
  await put('cache', { id: key, value });
  return value;
}
