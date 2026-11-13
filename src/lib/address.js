// Address helpers: split unit numbers out of street text, normalize streets
// so the same place always produces the same key, and parse "full address"
// strings like "400 Sycamore Ln, Chapel Hill, NC 27514".

const SUFFIXES = {
  STREET: 'ST', ST: 'ST', ROAD: 'RD', RD: 'RD', LANE: 'LN', LN: 'LN',
  DRIVE: 'DR', DR: 'DR', AVENUE: 'AVE', AVE: 'AVE', AV: 'AVE',
  COURT: 'CT', CT: 'CT', CIRCLE: 'CIR', CIR: 'CIR', BOULEVARD: 'BLVD',
  BLVD: 'BLVD', PLACE: 'PL', PL: 'PL', TERRACE: 'TER', TER: 'TER',
  PARKWAY: 'PKWY', PKWY: 'PKWY', HIGHWAY: 'HWY', HWY: 'HWY', TRAIL: 'TRL',
  TRL: 'TRL', WAY: 'WAY', SQUARE: 'SQ', SQ: 'SQ', LOOP: 'LOOP',
  EXTENSION: 'EXT', EXT: 'EXT', CROSSING: 'XING', XING: 'XING',
};
const DIRECTIONS = {
  NORTH: 'N', SOUTH: 'S', EAST: 'E', WEST: 'W',
  NORTHEAST: 'NE', NORTHWEST: 'NW', SOUTHEAST: 'SE', SOUTHWEST: 'SW',
};

// A unit/building token must contain a digit or be a single letter, so
// "100 Lot Rd" is not read as unit "RD".
const TOKEN = '([A-Z]*\\d[A-Z0-9-]*|[A-Z])';

// Words that introduce a unit or building inside an address line.
const UNIT_WORDS = 'APT|APARTMENT|UNIT|STE|SUITE|RM|ROOM|LOT|TRLR|TRAILER|SPC|SPACE';
const BLDG_WORDS = 'BLDG|BUILDING|BLD';

const UNIT_RE = new RegExp(`(?:,\\s*|\\s+)(?:(?:${UNIT_WORDS})\\.?\\s*#?\\s*|#\\s*)${TOKEN}\\b`, 'i');
const BLDG_RE = new RegExp(`(?:,\\s*|\\s+)(?:${BLDG_WORDS})\\.?\\s*#?\\s*${TOKEN}\\b`, 'i');
const HAS_UNIT_WORD_RE = new RegExp(`(?:\\b(?:${UNIT_WORDS}|${BLDG_WORDS})\\b|#)`, 'i');

/** True if the text mentions an apartment, unit, building or "#". */
export function hasUnitWords(text) {
  return HAS_UNIT_WORD_RE.test(String(text || ''));
}

/** Clean up a unit: "Apt. #04b" -> "4B". Empty string if nothing left. */
export function normalizeUnit(unit) {
  let u = String(unit ?? '').toUpperCase().trim();
  u = u.replace(new RegExp(`^(?:${UNIT_WORDS})\\.?\\s*`), '');
  u = u.replace(/^#\s*/, '').replace(/\s+/g, '').replace(/[.,]/g, '');
  u = u.replace(/^0+(?=\d)/, ''); // "0214" -> "214"
  return u;
}

/**
 * Pull unit and building text out of a street line.
 * "400 Sycamore Ln Bldg 4 Apt 214" -> { street: "400 Sycamore Ln", unit: "214", building: "4" }
 */
export function splitUnit(line) {
  let street = String(line ?? '').trim();
  let unit = '';
  let building = '';
  const b = street.match(BLDG_RE);
  if (b) {
    building = b[1].toUpperCase();
    street = (street.slice(0, b.index) + street.slice(b.index + b[0].length)).trim();
  }
  const u = street.match(UNIT_RE);
  if (u) {
    unit = normalizeUnit(u[1]);
    street = (street.slice(0, u.index) + street.slice(u.index + u[0].length)).trim();
  }
  street = street.replace(/[,\s]+$/, '');
  return { street, unit, building };
}

// TABLE's workbook writes the unit as its own middle segment:
// "820 Eno Mill Rd, 1A, Hillsborough". A short letter/number token (or
// "upstairs", "2nd floor"...) between the street and the town is the unit.
// (Pattern from monocoder77/table-route-packets.)
const MIDDLE_UNIT_RE =
  /^#?\s*(?:[A-Za-z]{0,2}-?\d{1,5}(?:-?[A-Za-z]|-\d{1,4})?|[A-Za-z](?:-?\d{1,4})?|upstairs|downstairs|upper|lower|rear|front|back|basement|(?:\d+(?:st|nd|rd|th)|first|second|third)\s+fl(?:oor)?|fl(?:oor)?\s*\d+)$/i;

const STATE_ZIP_RE = /^(?:([A-Za-z]{2})\.?)?\s*(\d{5})?(?:-\d{4})?$/;
const CITY_STATE_ZIP_RE = /^(.*?)\s+([A-Za-z]{2})\.?\s+(\d{5})(?:-\d{4})?$/;

/**
 * Split a one-cell address into parts. Handles:
 *   "400 Sycamore Ln, Chapel Hill, NC 27514"
 *   "400 Sycamore Ln, Chapel Hill NC 27514"
 *   "112 N Churton St, Hillsborough"          (TABLE's export: no state or ZIP)
 *   "820 Eno Mill Rd, 1A, Hillsborough"       (unit as the middle segment)
 * Only used when the file has no separate city / ZIP columns.
 */
export function parseFullAddress(text) {
  const s = String(text ?? '').trim().replace(/,?\s*(USA|United States)$/i, '');
  const parts = s.split(',').map((p) => p.trim()).filter(Boolean);
  const out = { street: parts[0] || s, unit: '', city: '', state: '', zip: '' };
  const rest = parts.slice(1);
  if (!rest.length) return out;

  // Peel the state / ZIP off the end.
  const last = rest[rest.length - 1];
  const sz = last.match(STATE_ZIP_RE);
  const csz = last.match(CITY_STATE_ZIP_RE);
  if (sz && (sz[2] || (sz[1] && rest.length >= 2))) {
    out.state = (sz[1] || '').toUpperCase();
    out.zip = sz[2] || '';
    rest.pop();
  } else if (csz) {
    out.city = csz[1].trim();
    out.state = csz[2].toUpperCase();
    out.zip = csz[3];
    rest.pop();
  }
  if (!out.city && rest.length) out.city = rest.pop();

  // Anything left between street and town: a unit, or more street text.
  for (const middle of rest) {
    const worded = ` ${middle}`.match(UNIT_RE); // "Apt 12", "#4B"
    if (!out.unit && MIDDLE_UNIT_RE.test(middle)) out.unit = normalizeUnit(middle);
    else if (!out.unit && worded) out.unit = normalizeUnit(worded[1]);
    else out.street += `, ${middle}`;
  }
  return out;
}

// TABLE's export carries no state; every stop is in North Carolina. Added to
// Maps links and map lookups so "Hillsborough" can't land in another state.
export const DEFAULT_STATE = 'NC';

/** "400 sycamore lane." -> "400 SYCAMORE LN" */
export function normalizeStreet(street) {
  const words = String(street ?? '')
    .toUpperCase()
    .replace(/[.,#]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  return words
    .map((w, i) => {
      if (DIRECTIONS[w]) return DIRECTIONS[w];
      // Only the last word is a suffix ("Court Street" -> "COURT ST"),
      // or the second-to-last when a direction follows ("Main Street North").
      const last = words.length - 1;
      const dirAfter = i === last - 1 && Object.values(DIRECTIONS).includes(DIRECTIONS[words[last]] || words[last]);
      const isSuffixSpot = i === last || dirAfter;
      if (i > 0 && SUFFIXES[w] && isSuffixSpot) return SUFFIXES[w];
      return w;
    })
    .join(' ');
}

export function zip5(zip) {
  const m = String(zip ?? '').match(/\d{5}/);
  return m ? m[0] : '';
}

/**
 * Stable key for "the same street address", ignoring unit.
 * Uses ZIP when known, otherwise city.
 */
export function addressKey({ street, city, zip }) {
  const s = normalizeStreet(street);
  if (!s) return '';
  const z = zip5(zip);
  return z ? `${s}|${z}` : `${s}|${String(city ?? '').toUpperCase().trim()}`;
}

/** Split "400 SYCAMORE LN" into house number and street name. */
export function houseNumber(street) {
  const m = normalizeStreet(street).match(/^(\d+)[A-Z]?\s+(.*)$/);
  return m ? { number: Number(m[1]), name: m[2] } : { number: null, name: normalizeStreet(street) };
}

// Towns TABLE delivers to and nearby. Only these get corrected; anything else is kept as typed.
export const KNOWN_TOWNS = [
  'Carrboro', 'Chapel Hill', 'Hillsborough', 'Durham', 'Efland', 'Cedar Grove', 'Mebane',
  'Rougemont', 'Bahama', 'Graham', 'Burlington', 'Pittsboro', 'Saxapahaw', 'Hurdle Mills', 'Orange Grove',
];

// Edit distance with swaps of neighbors counted as one edit.
function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/**
 * Fix the spelling of a known town: "Chapel HIll" -> "Chapel Hill", "Carborro" -> "Carrboro".
 * Corrects only when exactly one known town is within 1 edit (2 for names of 7+ letters).
 * Anything else is returned unchanged.
 */
export function normalizeTown(city) {
  const raw = String(city ?? '').trim().replace(/\s+/g, ' ');
  if (!raw) return '';
  const low = raw.toLowerCase();
  const exact = KNOWN_TOWNS.find((t) => t.toLowerCase() === low);
  if (exact) return exact;
  const max = low.length >= 7 ? 2 : 1;
  const close = KNOWN_TOWNS.filter((t) => editDistance(low, t.toLowerCase()) <= max);
  return close.length === 1 ? close[0] : raw;
}

/** One-line address for display and for Maps links (never includes unit). */
export function formatAddress({ street, city, state, zip }) {
  const tail = [state || (zip ? '' : DEFAULT_STATE), zip].filter(Boolean).join(' ');
  return [street, city, tail].filter(Boolean).join(', ');
}

/** Natural sort compare: "2" < "10", "B2" < "B10". */
export function naturalCompare(a, b) {
  return String(a ?? '').localeCompare(String(b ?? ''), undefined, { numeric: true, sensitivity: 'base' });
}
