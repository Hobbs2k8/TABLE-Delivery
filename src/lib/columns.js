// Column detection: guess which spreadsheet column holds which field,
// find the header row in messy spreadsheets, and turn rows into stops.

import { splitUnit, parseFullAddress, normalizeUnit, hasUnitWords } from './address.js';

/** Every field the app understands, with the words we look for in headers. */
export const FIELDS = [
  { key: 'route', label: 'Route number', required: true, synonyms: ['route', 'route number', 'route #', 'route no', 'route id', 'route name', 'vehicle', 'run'] },
  { key: 'street', label: 'Street address', required: true, synonyms: ['street', 'street address', 'address', 'address 1', 'address line 1', 'address1', 'mailing street', 'home street', 'location'] },
  { key: 'unit', label: 'Apt / unit', synonyms: ['apt', 'apt #', 'apartment', 'unit', 'unit #', 'address 2', 'address line 2', 'address2', 'suite', 'apt/unit', 'apt / unit'] },
  { key: 'city', label: 'City', synonyms: ['city', 'town', 'mailing city', 'home city'] },
  { key: 'state', label: 'State', synonyms: ['state', 'st', 'mailing state', 'state/province', 'home state'] },
  { key: 'zip', label: 'ZIP', synonyms: ['zip', 'zip code', 'zipcode', 'postal code', 'postcode', 'mailing zip/postal code', 'mailing zip', 'zip/postal code'] },
  { key: 'stop', label: 'Stop order', synonyms: ['stop', 'stop number', 'stop #', 'stop no', 'stop order', 'order', 'sequence', 'seq', 'position'] },
  { key: 'name', label: 'Household name', synonyms: ['name', 'household', 'household name', 'family', 'family name', 'visit name', 'contact', 'contact name', 'client', 'recipient', 'full name', 'account name'] },
  { key: 'bags', label: 'Bags', synonyms: ['bags', '# bags', 'bag count', 'number of bags', 'load', 'quantity', 'qty', 'boxes'] },
  { key: 'phone', label: 'Phone', synonyms: ['phone', 'phone number', 'mobile', 'cell', 'telephone', 'home phone', 'mobile phone', 'contact phone'] },
  { key: 'notes', label: 'Notes', synonyms: ['notes', 'note', 'instructions', 'delivery notes', 'comments', 'driver notes', 'special instructions'] },
  { key: 'driver', label: 'Driver', synonyms: ['driver', 'driver name', 'volunteer', 'volunteer driver', 'assigned driver'] },
  { key: 'lat', label: 'Latitude', synonyms: ['lat', 'latitude', 'y'] },
  { key: 'lng', label: 'Longitude', synonyms: ['lng', 'lon', 'long', 'longitude', 'x'] },
];

const norm = (h) => String(h ?? '').toLowerCase().replace(/[_\s]+/g, ' ').replace(/[^a-z0-9#/ ]/g, '').trim();

/** How well does a header match a field? 0 = no match. */
function score(header, field) {
  const h = norm(header);
  if (!h) return 0;
  let best = 0;
  for (const syn of field.synonyms) {
    if (h === syn) return 100;
    // Whole-word containment ("Driver Name (first)" -> driver), but short
    // synonyms like "st" or "x" must match exactly.
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
    const bonus = mapping.route && mapping.street ? 5 : 0;
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

const toNumber = (v) => {
  const n = parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
};

/**
 * Apply a column mapping to rows. Returns { stops, skipped }.
 * Stops keep the original file order in `fileIndex`.
 */
export function rowsToStops(rows, mapping) {
  const get = (row, key) => (mapping[key] ? String(row[mapping[key]] ?? '').trim() : '');
  const stops = [];
  const skipped = [];
  rows.forEach((row, i) => {
    const route = get(row, 'route').replace(/^route\s*/i, '');
    let streetText = get(row, 'street');
    let city = get(row, 'city');
    let state = get(row, 'state');
    let zip = get(row, 'zip');

    if (!route || !streetText) {
      if (Object.values(row).some((v) => String(v).trim())) {
        skipped.push({ rowNumber: i + 2, reason: !route ? 'no route number' : 'no street address' });
      }
      return;
    }

    // Whole address in one cell? Split it when city/ZIP columns are absent.
    if (!city && !zip && streetText.includes(',')) {
      const p = parseFullAddress(streetText);
      streetText = p.street;
      city = p.city;
      state = state || p.state;
      zip = p.zip;
    }

    const split = splitUnit(streetText);
    const unitCol = get(row, 'unit');
    const unit = normalizeUnit(unitCol) || split.unit;
    const lat = toNumber(get(row, 'lat'));
    const lng = toNumber(get(row, 'lng'));

    stops.push({
      id: `s${i}`,
      fileIndex: i,
      route,
      order: toNumber(get(row, 'stop')),
      street: split.street,
      unit,
      buildingHint: split.building,
      city,
      state,
      zip,
      name: get(row, 'name'),
      bags: toNumber(get(row, 'bags')),
      phone: get(row, 'phone'),
      notes: get(row, 'notes'),
      driver: get(row, 'driver'),
      lat: lat !== null && Math.abs(lat) <= 90 && lat !== 0 ? lat : null,
      lng: lng !== null && Math.abs(lng) <= 180 && lng !== 0 ? lng : null,
      unitWords: Boolean(unit || split.building || hasUnitWords(unitCol)),
    });
  });
  return { stops, skipped };
}
