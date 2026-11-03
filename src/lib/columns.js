// Column detection: guess which spreadsheet column holds which field,
// find the header row in messy spreadsheets, and turn rows into stops.
//
// Works with a Routific export (one row per household, routes filled in) and
// with TABLE's "Current Numbers" workbook (MASTER sheet: one row per child,
// often no routes yet). Rows sharing a route, day and door are one household.

import { splitUnit, parseFullAddress, normalizeUnit, hasUnitWords, addressKey } from './address.js';

/** Every field the app understands, with the words we look for in headers. */
export const FIELDS = [
  { key: 'route', label: 'Route', synonyms: ['route', 'route number', 'route #', 'route no', 'route id', 'route name', 'vehicle', 'run', 'delivery locations name', 'delivery location name', 'location name'] },
  { key: 'street', label: 'Street address', required: true, synonyms: ['street', 'street address', 'address', 'address 1', 'address line 1', 'address1', 'mailing street', 'mailing address', 'home street', 'location'], exclude: /dup|e ?mail/ },
  { key: 'unit', label: 'Apt / unit', synonyms: ['apt', 'apt #', 'apartment', 'unit', 'unit #', 'address 2', 'address line 2', 'address2', 'suite', 'apt/unit', 'apt / unit'] },
  { key: 'city', label: 'City', synonyms: ['city', 'town', 'mailing city', 'home city'] },
  { key: 'state', label: 'State', synonyms: ['state', 'st', 'mailing state', 'state/province', 'home state'] },
  { key: 'zip', label: 'ZIP', synonyms: ['zip', 'zip code', 'zipcode', 'postal code', 'postcode', 'mailing zip/postal code', 'mailing zip', 'zip/postal code'] },
  { key: 'day', label: 'Delivery day', synonyms: ['day', 'delivery day', 'dropoff day', 'drop off day', 'weekday'] },
  { key: 'stop', label: 'Stop order', synonyms: ['stop', 'stop number', 'stop #', 'stop no', 'stop order', 'order', 'sequence', 'seq', 'position'] },
  { key: 'name', label: 'Household name', synonyms: ['name', 'household', 'household name', 'family', 'family name', 'visit name', 'contact', 'contact name', 'client', 'recipient', 'full name', 'account name'], exclude: /language|label/ },
  { key: 'bags', label: 'Bags', synonyms: ['bags', '# bags', 'bag count', 'number of bags', 'load', 'quantity', 'qty', 'boxes', 'kids', 'children'], exclude: /allerg/ },
  { key: 'special', label: 'Special-diet flag', synonyms: ['needslabel', 'needs label', 'special diet', 'special'] },
  { key: 'diet', label: 'Special-diet notes', synonyms: ['preflabel', 'pref label', 'diet notes', 'dietary notes', 'diet'] },
  { key: 'language', label: 'Language', synonyms: ['language', 'primary language', 'language spoken at home'] },
  { key: 'program', label: 'Program', synonyms: ['program'] },
  { key: 'phone', label: 'Phone', synonyms: ['phone', 'phone number', 'mobile', 'cell', 'telephone', 'home phone', 'mobile phone', 'contact phone'] },
  { key: 'notes', label: 'Notes', synonyms: ['notes', 'note', 'instructions', 'delivery notes', 'comments', 'driver notes', 'special instructions'], exclude: /diet|allerg|pref/ },
  { key: 'driver', label: 'Driver', synonyms: ['driver', 'driver name', 'volunteer', 'volunteer driver', 'assigned driver'] },
  { key: 'lat', label: 'Latitude', synonyms: ['lat', 'latitude', 'y'] },
  { key: 'lng', label: 'Longitude', synonyms: ['lng', 'lon', 'long', 'longitude', 'x'] },
];

const norm = (h) => String(h ?? '').toLowerCase().replace(/[_\s:-]+/g, ' ').replace(/[^a-z0-9#/ ]/g, '').replace(/\s+/g, ' ').trim();

/** How well does a header match a field? 0 = no match. */
function score(header, field) {
  const h = norm(header);
  if (!h || field.exclude?.test(h)) return 0;
  let best = 0;
  for (const syn of field.synonyms) {
    if (h === syn) return 100;
    // Whole-word containment ("Food Location: Drop-off Day" -> day), but
    // short synonyms like "st" or "x" must match exactly.
    if (syn.length >= 3 && new RegExp(`(^|[ #/])${syn.replace(/[#/]/g, '\\$&')}($|[ #/])`).test(h)) {
      best = Math.max(best, 50 + syn.length);
    }
  }
  return best;
}

/**
 * Guess a mapping { fieldKey: headerName | null } from header names.
 * Each header is used at most once; strongest matches win.
 */
export function detectColumns(headers) {
  const candidates = [];
  headers.forEach((header, col) => {
    for (const field of FIELDS) {
      const s = score(header, field);
      if (s > 0) candidates.push({ field: field.key, header, col, s });
    }
  });
  candidates.sort((a, b) => b.s - a.s || a.col - b.col);
  const mapping = Object.fromEntries(FIELDS.map((f) => [f.key, null]));
  const usedCols = new Set();
  for (const c of candidates) {
    if (mapping[c.field] !== null || usedCols.has(c.col)) continue;
    mapping[c.field] = c.header;
    usedCols.add(c.col);
  }
  return mapping;
}

/** Fields that are required but not mapped. */
export function missingRequired(mapping) {
  return FIELDS.filter((f) => f.required && !mapping[f.key]).map((f) => f.key);
}

/** Order-independent fingerprint of a header row, to recognize "same file layout as last week". */
export function headerSignature(headers) {
  return headers.map(norm).filter(Boolean).sort().join('|');
}

/** A saved mapping is still valid if every header it uses still exists. */
export function mappingFits(mapping, headers) {
  const set = new Set(headers);
  return Object.values(mapping).every((h) => !h || set.has(h)) && missingRequired(mapping).length === 0;
}

/**
 * Spreadsheets from Excel macros often have title rows above the headers.
 * Look at the first rows and pick the one that looks most like headers.
 */
export function findHeaderRow(matrix, maxScan = 15) {
  let bestRow = 0;
  let bestScore = -1;
  for (let r = 0; r < Math.min(matrix.length, maxScan); r++) {
    const row = matrix[r] || [];
    const mapping = detectColumns(row.map((c) => String(c ?? '')));
    const hits = Object.values(mapping).filter(Boolean).length;
    const bonus = mapping.street ? 5 : 0;
    if (hits + bonus > bestScore) {
      bestScore = hits + bonus;
      bestRow = r;
    }
  }
  return bestRow;
}

/** Turn a 2D array (header row + data) into { headers, rows: [ {header: value} ] }. */
export function matrixToRows(matrix) {
  const headerRow = findHeaderRow(matrix);
  const rawHeaders = (matrix[headerRow] || []).map((h) => String(h ?? '').trim());
  // Give blank / duplicate headers a usable name.
  const seen = new Map();
  const headers = rawHeaders.map((h, i) => {
    let name = h || `Column ${i + 1}`;
    const n = seen.get(name) || 0;
    seen.set(name, n + 1);
    if (n) name = `${name} (${n + 1})`;
    return name;
  });
  const rows = [];
  for (const line of matrix.slice(headerRow + 1)) {
    if (!line || line.every((c) => String(c ?? '').trim() === '')) continue;
    const row = {};
    headers.forEach((h, i) => (row[h] = line[i] == null ? '' : String(line[i]).trim()));
    rows.push(row);
  }
  return { headers, rows };
}

// ---------- Delivery days ----------
const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

/** "01-Tues" -> { label: 'Tuesday', order: 1 }. Unknown text is kept as-is. */
export function dayInfo(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return { label: '', order: 99 };
  const word = s.replace(/^\d+\s*[-.:)]\s*/, '').trim();
  const idx = WEEKDAYS.findIndex((d) => word.toLowerCase().startsWith(d.slice(0, 3)));
  if (idx >= 0) return { label: WEEKDAYS[idx][0].toUpperCase() + WEEKDAYS[idx].slice(1), order: idx };
  return { label: word || s, order: 98 };
}

/** "Tuesday" -> "Tue" */
export const dayShort = (label) => (WEEKDAYS.includes(String(label).toLowerCase()) ? label.slice(0, 3) : label);

// ---------- Rows -> households ----------
const toNumber = (v) => {
  const n = parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const FLAG_RE = /^(x|y|yes|true|1|✓|✔)$/i;
const NO_RE = /^(n|no|false|none|n\/a|0)$/i;
// Pickup households collect their food at TABLE: they're on no delivery route.
const PICKUP_RE = /\bpick\s*-?\s*up\b/i;

/**
 * Apply a column mapping to rows and group them into households (stops).
 * Returns { stops, skipped, pickups, hasRoutes, hasDays, perChildRows }.
 *
 * - Rows sharing a route, day and door (street + unit) are one household.
 *   TABLE's export has one row per child, so bags = number of rows unless the
 *   file has a bags column.
 * - Blank route cells under a filled one belong to that route (merged cells).
 * - "TABLE Pickup" routes and "Marketplace Pick Up" programs are skipped.
 * - No route column, or only blanks: stops get route '' and wait for
 *   "Make routes".
 */
export function rowsToStops(rows, mapping) {
  const get = (row, key) => {
    if (!mapping[key]) return '';
    const v = String(row[mapping[key]] ?? '').trim();
    return v === '-' ? '' : v;
  };
  const hasRoutes = Boolean(mapping.route) && rows.some((r) => get(r, 'route') && get(r, 'street') && !PICKUP_RE.test(get(r, 'route')));
  const skipped = [];
  const pickupKeys = new Set();
  const households = new Map();
  let lastRoute = '';

  rows.forEach((row, i) => {
    let streetText = get(row, 'street');
    let route = get(row, 'route');
    if (hasRoutes) {
      if (route) lastRoute = route;
      else route = lastRoute;
    }
    if (!streetText) {
      if (Object.values(row).some((v) => String(v).trim())) skipped.push({ rowNumber: i + 2, reason: 'no street address' });
      return;
    }

    let city = get(row, 'city');
    let state = get(row, 'state');
    let zip = get(row, 'zip');
    let unitFromAddress = '';
    // Whole address in one cell? Split it when city/ZIP columns are absent.
    if (!city && !zip && streetText.includes(',')) {
      const p = parseFullAddress(streetText);
      streetText = p.street;
      city = p.city;
      state = state || p.state;
      zip = p.zip;
      unitFromAddress = p.unit;
    }
    const split = splitUnit(streetText);
    const unitCol = get(row, 'unit');
    const unit = normalizeUnit(unitCol) || split.unit || unitFromAddress;
    const door = `${addressKey({ street: split.street, city, zip })}#${unit}`;

    if (PICKUP_RE.test(route) || (!hasRoutes && PICKUP_RE.test(get(row, 'program')))) {
      pickupKeys.add(door);
      return;
    }
    if (!hasRoutes) route = '';
    route = route.replace(/^route\s*/i, '');
    const day = dayInfo(get(row, 'day'));
    const id = `${day.label}|${route}|${door}`;

    let h = households.get(id);
    if (!h) {
      h = {
        id: `s${households.size}`,
        door,
        fileIndex: i,
        route,
        day: day.label,
        dayOrder: day.order,
        order: null,
        street: split.street,
        unit,
        buildingHint: split.building,
        city,
        state,
        zip,
        name: '',
        rows: 0,
        bagsSum: null,
        special: 0,
        dietNotes: [],
        language: '',
        phone: '',
        notesList: [],
        driver: '',
        lat: null,
        lng: null,
        unitWords: Boolean(unit || split.building || hasUnitWords(unitCol)),
      };
      households.set(id, h);
    }
    h.rows++;
    // A household is ordered by its lowest stop number (its kids are 3, 3.1, ...).
    const order = toNumber(get(row, 'stop'));
    if (order !== null) h.order = h.order === null ? order : Math.min(h.order, order);
    const bags = toNumber(get(row, 'bags'));
    if (bags !== null && bags > 0) h.bagsSum = (h.bagsSum ?? 0) + bags;

    // The special-diet column may be a flag (TABLE's "X"), a count, or the diet itself.
    const flag = get(row, 'special');
    let diet = get(row, 'diet');
    let specialCount = 0;
    if (mapping.special) {
      if (FLAG_RE.test(flag)) specialCount = 1;
      else if (/^\d+$/.test(flag)) specialCount = parseInt(flag, 10);
      else if (flag && !NO_RE.test(flag)) {
        specialCount = 1;
        diet = diet || flag;
      }
    } else if (diet) specialCount = 1;
    if (specialCount) {
      h.special += specialCount;
      if (diet) h.dietNotes.push(diet);
    }

    h.name ||= get(row, 'name');
    h.language ||= get(row, 'language');
    h.phone ||= get(row, 'phone');
    h.driver ||= get(row, 'driver');
    const note = get(row, 'notes');
    if (note && !h.notesList.includes(note)) h.notesList.push(note);
    if (h.lat === null) {
      const lat = toNumber(get(row, 'lat'));
      const lng = toNumber(get(row, 'lng'));
      if (lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && lat !== 0) {
        h.lat = lat;
        h.lng = lng;
      }
    }
  });

  // Without routes there's no fill-down, so a pickup flag on one child's row
  // still takes the whole household off the delivery list.
  const list = [...households.values()].filter((h) => hasRoutes || !pickupKeys.has(h.door));
  const perChildRows = list.some((h) => h.rows > 1);
  const stops = list.map(({ rows, bagsSum, notesList, ...h }) => ({
    ...h,
    // One bag per child row, unless the file says how many bags.
    bags: bagsSum ?? (perChildRows ? rows : null),
    special: Math.min(h.special, bagsSum ?? rows),
    notes: notesList.join(' · '),
  }));
  return {
    stops,
    skipped,
    pickups: pickupKeys.size,
    hasRoutes,
    hasDays: stops.some((s) => s.day),
    perChildRows,
  };
}
