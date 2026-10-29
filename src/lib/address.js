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

/**
 * Split "400 Sycamore Ln, Chapel Hill, NC 27514" into parts.
 * Only used when the file has no separate city / ZIP columns.
 */
export function parseFullAddress(text) {
  const s = String(text ?? '').trim().replace(/,?\s*(USA|United States)$/i, '');
  const m = s.match(/^(.*?),\s*([^,]+?),\s*([A-Za-z]{2})\.?\s*(\d{5})?(?:-\d{4})?$/);
  if (m) return { street: m[1].trim(), city: m[2].trim(), state: m[3].toUpperCase(), zip: m[4] || '' };
  const m2 = s.match(/^(.*?),\s*([^,]+?)\s+([A-Za-z]{2})\.?\s+(\d{5})(?:-\d{4})?$/);
  if (m2) return { street: m2[1].trim(), city: m2[2].trim(), state: m2[3].toUpperCase(), zip: m2[4] };
  return { street: s, city: '', state: '', zip: '' };
}

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

/** One-line address for display and for Maps links (never includes unit). */
export function formatAddress({ street, city, state, zip }) {
  const tail = [state, zip].filter(Boolean).join(' ');
  return [street, city, tail].filter(Boolean).join(', ');
}

/** Natural sort compare: "2" < "10", "B2" < "B10". */
export function naturalCompare(a, b) {
  return String(a ?? '').localeCompare(String(b ?? ''), undefined, { numeric: true, sensitivity: 'base' });
}
