// Load building outlines near a point from OpenStreetMap (Overpass API).
//
// PRIVACY: only a latitude/longitude is sent — no addresses or family data.
// Policy (wiki.openstreetmap.org/wiki/Overpass_API): keep volume low and
// cache. We query once per complex and cache by rounded location.

import { get, put } from '../store/db.js';

const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];

/** Overpass query for buildings within `radius` meters. */
export function buildingsQuery(lat, lng, radius = 400) {
  return `[out:json][timeout:25];(way["building"](around:${radius},${lat},${lng});relation["building"](around:${radius},${lat},${lng}););out tags geom;`;
}

function centroid(ring) {
  let lat = 0;
  let lng = 0;
  for (const [a, b] of ring) {
    lat += a;
    lng += b;
  }
  return { lat: lat / ring.length, lng: lng / ring.length };
}

/** A short label from whatever OSM knows: "Building C", "400", "Clubhouse". */
export function osmLabel(tags = {}) {
  return tags.name || tags['building:name'] || tags.ref || tags['addr:unit'] || (tags['addr:housenumber'] ? `${tags['addr:housenumber']}${tags['addr:street'] ? ' ' + tags['addr:street'] : ''}` : '');
}

/** Turn an Overpass response into [{ osmId, label, tags, outline: [[lat,lng]...], center }]. */
export function parseOverpass(json) {
  const out = [];
  for (const el of json?.elements || []) {
    let ring = null;
    if (el.type === 'way' && Array.isArray(el.geometry)) {
      ring = el.geometry.map((p) => [p.lat, p.lon]);
    } else if (el.type === 'relation' && Array.isArray(el.members)) {
      const outer = el.members.find((m) => m.role === 'outer' && Array.isArray(m.geometry));
      if (outer) ring = outer.geometry.map((p) => [p.lat, p.lon]);
    }
    if (!ring || ring.length < 3) continue;
    out.push({ osmId: `${el.type}/${el.id}`, label: osmLabel(el.tags), tags: el.tags || {}, outline: ring, center: centroid(ring) });
  }
  return out;
}

export async function loadBuildings(lat, lng, radius = 400) {
  const key = `bldg:${lat.toFixed(4)},${lng.toFixed(4)},${radius}`;
  const cached = await get('cache', key).catch(() => null);
  if (cached) return cached.value;

  const body = `data=${encodeURIComponent(buildingsQuery(lat.toFixed(6), lng.toFixed(6), radius))}`;
  let lastError;
  for (const url of ENDPOINTS) {
    // Public servers are sometimes overloaded; don't leave the coordinator waiting.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const res = await fetch(url, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: controller.signal });
      if (!res.ok) throw new Error(`error ${res.status}`);
      const value = parseOverpass(await res.json());
      await put('cache', { id: key, value });
      return value;
    } catch (e) {
      lastError = e.name === 'AbortError' ? new Error('the map server is busy') : e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`Couldn't load building outlines: ${lastError?.message}. Use Drop a pin to mark buildings instead.`);
}
