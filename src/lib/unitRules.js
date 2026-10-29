// Unit-to-building rules for an apartment complex.
//
// Rule shapes (all have id and buildingId):
//   { type: 'unit',       unit: '7' }              one specific unit
//   { type: 'range',      from: '101', to: '124' } numbers 101..124 (or letters A..D)
//   { type: 'startsWith', value: '2' }             2, 201, 2B...
//   { type: 'endsWith',   value: 'B' }             4B, 11B...
//   { type: 'pattern',    value: '1xx' }           x = any one digit, * = anything
//   { type: 'rest' }                               everything not matched above
//
// Checked in this order: one-off units, "Bldg" text in the address,
// ranges, starts/ends/patterns, then "everything else".

import { normalizeUnit, normalizeStreet } from './address.js';

const PRIORITY = { unit: 0, range: 2, startsWith: 3, endsWith: 3, pattern: 3, rest: 9 };

function inRange(unit, from, to) {
  const f = normalizeUnit(from);
  const t = normalizeUnit(to);
  if (/^\d+$/.test(f) && /^\d+$/.test(t)) {
    if (!/^\d+$/.test(unit)) return false;
    const n = Number(unit);
    return n >= Math.min(+f, +t) && n <= Math.max(+f, +t);
  }
  if (/^[A-Z]$/.test(f) && /^[A-Z]$/.test(t) && /^[A-Z]$/.test(unit)) {
    const [lo, hi] = [f, t].sort();
    return unit >= lo && unit <= hi;
  }
  return false;
}

function patternToRegExp(pattern) {
  const p = normalizeUnit(pattern);
  const body = p
    .split('')
    .map((ch) => (ch === 'X' ? '\\d' : ch === '*' ? '.*' : ch.replace(/[.+?^${}()|[\]\\-]/g, '\\$&')))
    .join('');
  return new RegExp(`^${body}$`);
}

/** Does one rule match a (normalized) unit? */
export function ruleMatches(rule, unit) {
  const u = normalizeUnit(unit);
  switch (rule.type) {
    case 'unit':
      return u !== '' && u === normalizeUnit(rule.unit);
    case 'range':
      return u !== '' && inRange(u, rule.from, rule.to);
    case 'startsWith':
      return u !== '' && !!rule.value && u.startsWith(normalizeUnit(rule.value));
    case 'endsWith':
      return u !== '' && !!rule.value && u.endsWith(normalizeUnit(rule.value));
    case 'pattern':
      return u !== '' && !!rule.value && patternToRegExp(rule.value).test(u);
    case 'rest':
      return true;
    default:
      return false;
  }
}

/** "BLDG 4", "Building 4", "4" all compare equal to address text "Bldg 4". */
function labelToken(label) {
  return normalizeStreet(label).replace(/^(BUILDING|BLDG|BLD)\s*/, '').replace(/\s+/g, '');
}

/**
 * Find the building for a unit.
 * Returns { buildingId, via, conflicts } where via is 'unit' | 'address' | rule type,
 * and conflicts lists other buildings that equally-ranked rules point to.
 */
export function matchUnit({ unit, buildingHint }, complex) {
  const rules = complex.rules || [];
  const buildings = complex.buildings || [];

  const oneOff = rules.find((r) => r.type === 'unit' && ruleMatches(r, unit));
  if (oneOff) return { buildingId: oneOff.buildingId, via: 'unit', ruleId: oneOff.id, conflicts: [] };

  if (buildingHint) {
    const hint = labelToken(buildingHint);
    const b = buildings.find((x) => labelToken(x.label) === hint);
    if (b) return { buildingId: b.id, via: 'address', ruleId: null, conflicts: [] };
  }

  const ordered = rules
    .filter((r) => r.type !== 'unit')
    .map((r, i) => ({ r, i }))
    .sort((a, b) => PRIORITY[a.r.type] - PRIORITY[b.r.type] || a.i - b.i)
    .map((x) => x.r);

  const hit = ordered.find((r) => ruleMatches(r, unit));
  if (!hit) return { buildingId: null, via: null, ruleId: null, conflicts: [] };

  const conflicts = ordered
    .filter((r) => r !== hit && PRIORITY[r.type] === PRIORITY[hit.type] && r.buildingId !== hit.buildingId && ruleMatches(r, unit))
    .map((r) => r.buildingId);
  return { buildingId: hit.buildingId, via: hit.type, ruleId: hit.id, conflicts: [...new Set(conflicts)] };
}

/** Plain-English description, for lists and previews. */
export function describeRule(rule) {
  switch (rule.type) {
    case 'unit': return `Unit ${rule.unit}`;
    case 'range': return `Units ${rule.from}–${rule.to}`;
    case 'startsWith': return `Units starting with “${rule.value}”`;
    case 'endsWith': return `Units ending with “${rule.value}”`;
    case 'pattern': return `Units like “${rule.value}”`;
    case 'rest': return 'Every other unit';
    default: return 'Unknown rule';
  }
}

/** Basic checks before saving a rule. Returns an error message or ''. */
export function validateRule(rule) {
  if (!rule.buildingId) return 'Pick a building for this rule.';
  if (rule.type === 'unit' && !normalizeUnit(rule.unit)) return 'Type a unit number.';
  if (rule.type === 'range') {
    const f = normalizeUnit(rule.from);
    const t = normalizeUnit(rule.to);
    const bothNum = /^\d+$/.test(f) && /^\d+$/.test(t);
    const bothLetter = /^[A-Z]$/.test(f) && /^[A-Z]$/.test(t);
    if (!bothNum && !bothLetter) return 'A range needs two numbers (101 to 124) or two letters (A to D).';
  }
  if (['startsWith', 'endsWith', 'pattern'].includes(rule.type) && !normalizeUnit(rule.value)) {
    return 'Type the letters or numbers to match.';
  }
  return '';
}
