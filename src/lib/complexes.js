// Apartment complexes: detect them in this week's stops, and work out the
// exact spot (building pin, house pin, or plain address) for every stop.
//
// Saved complex shape (see store/db.js):
// {
//   id, name, schemaVersion, createdAt, updatedAt,
//   addresses: [{ key, street, city, state, zip }],   // every street address it answers to
//   center: { lat, lng },
//   buildings: [{ id, label, lat, lng, note, osmId }],
//   rules: [ see unitRules.js ],
//   siteMap: { url, image }                           // optional
// }
// Saved house pin shape: { id, key, street, city, state, zip, lat, lng, note, updatedAt }

import { addressKey, houseNumber } from './address.js';
import { matchUnit } from './unitRules.js';

/** Index complexes by every address key they answer to. */
export function indexComplexes(complexes) {
  const byKey = new Map();
  for (const c of complexes) for (const a of c.addresses || []) byKey.set(a.key, c);
  return byKey;
}

/**
 * Find addresses in this week's data that look like apartment complexes
 * and are not set up yet: shared by 2+ households, or with a unit number.
 * Addresses with a saved house pin count as "handled" and are skipped.
 */
export function detectComplexes(stops, complexes = [], pins = []) {
  const known = indexComplexes(complexes);
  const pinned = new Set(pins.map((p) => p.key));
  const groups = new Map();
  for (const s of stops) {
    const key = s.key || addressKey(s);
    if (!key || known.has(key) || pinned.has(key)) continue;
    if (!groups.has(key)) {
      groups.set(key, { key, street: s.street, city: s.city, state: s.state, zip: s.zip, lat: null, lng: null, stops: [], units: new Set(), hasUnit: false });
    }
    const g = groups.get(key);
    g.stops.push(s);
    if (s.unit) g.units.add(s.unit);
    if (s.unitWords || s.unit) g.hasUnit = true;
    if (g.lat === null && s.lat !== null && s.lng !== null) {
      g.lat = s.lat;
      g.lng = s.lng;
    }
  }
  return [...groups.values()]
    .filter((g) => g.stops.length >= 2 || g.hasUnit)
    .map((g) => ({
      key: g.key,
      street: g.street,
      city: g.city,
      state: g.state,
      zip: g.zip,
      lat: g.lat,
      lng: g.lng,
      households: g.stops.length,
      units: [...g.units],
      routes: [...new Set(g.stops.map((s) => s.route))],
      reason: g.stops.length >= 2 ? 'shared' : 'unit',
    }))
    .sort((a, b) => b.households - a.households || a.street.localeCompare(b.street));
}

/**
 * Other addresses this week that are probably part of the same complex:
 * same street name and ZIP, house number within `spread`.
 */
export function suggestRelatedAddresses(target, candidates, spread = 60) {
  const t = houseNumber(target.street);
  if (t.number === null) return [];
  const tz = target.key.split('|')[1];
  return candidates.filter((c) => {
    if (c.key === target.key || c.key.split('|')[1] !== tz) return false;
    const h = houseNumber(c.street);
    return h.number !== null && h.name === t.name && Math.abs(h.number - t.number) <= spread;
  });
}

/**
 * Work out where each stop should go.
 * Adds `key` and `place` to every stop:
 *   place.kind:   'building' | 'pin' | 'address'
 *   place.status: 'ok' | 'unmatched' (complex set up, unit not covered) | 'not-set-up' (looks like a complex)
 */
export function resolveStops(stops, { complexes = [], pins = [] } = {}) {
  const complexByKey = indexComplexes(complexes);
  const pinByKey = new Map(pins.map((p) => [p.key, p]));
  const withKeys = stops.map((s) => ({ ...s, key: addressKey(s) }));
  const candidateKeys = new Set(detectComplexes(withKeys, complexes, pins).map((c) => c.key));

  return withKeys.map((s) => {
    const complex = complexByKey.get(s.key);
    if (complex) {
      const m = matchUnit(s, complex);
      const b = m.buildingId && (complex.buildings || []).find((x) => x.id === m.buildingId);
      if (b) {
        return {
          ...s,
          place: {
            kind: 'building', status: 'ok', lat: b.lat, lng: b.lng, label: b.label, note: b.note || '',
            complexId: complex.id, complexName: complex.name, buildingId: b.id, via: m.via,
            conflict: m.conflicts.length > 0,
          },
        };
      }
      return { ...s, place: { kind: 'address', status: 'unmatched', complexId: complex.id, complexName: complex.name, label: '', note: '' } };
    }
    const pin = pinByKey.get(s.key);
    if (pin) {
      return { ...s, place: { kind: 'pin', status: 'ok', lat: pin.lat, lng: pin.lng, label: '', note: pin.note || '', pinId: pin.id } };
    }
    return { ...s, place: { kind: 'address', status: candidateKeys.has(s.key) ? 'not-set-up' : 'ok', label: '', note: '' } };
  });
}

/** Units at a complex this week, with the building each maps to (for the setup preview). */
export function previewUnits(complex, stops) {
  const keys = new Set((complex.addresses || []).map((a) => a.key));
  const seen = new Map();
  for (const s of stops) {
    if (!keys.has(s.key || addressKey(s))) continue;
    const id = s.unit || '(no unit)';
    if (seen.has(id)) {
      seen.get(id).households++;
      continue;
    }
    const m = matchUnit(s, complex);
    seen.set(id, { unit: s.unit, buildingId: m.buildingId, via: m.via, conflict: m.conflicts.length > 0, households: 1 });
  }
  return [...seen.values()].sort((a, b) => String(a.unit).localeCompare(String(b.unit), undefined, { numeric: true }));
}
