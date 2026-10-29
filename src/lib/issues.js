// The single "Needs attention" list shown at the top of the review screen.

import { detectComplexes } from './complexes.js';

/**
 * Returns [{ kind, title, detail, households, target }] — each item links to its fix.
 * kind: 'setup-complex' | 'unmatched-units' | 'skipped-rows'
 */
export function findIssues({ stops, complexes, pins = [], skipped = [] }) {
  const issues = [];

  const notSetUp = detectComplexes(stops, complexes, pins);
  if (notSetUp.length) {
    const households = notSetUp.reduce((n, c) => n + c.households, 0);
    issues.push({
      kind: 'setup-complex',
      title: `${notSetUp.length} ${notSetUp.length === 1 ? 'complex needs' : 'complexes need'} building locations`,
      detail: `${households} ${households === 1 ? 'household goes' : 'households go'} to the main address for now.`,
      households,
      items: notSetUp,
    });
  }

  const unmatched = new Map();
  for (const s of stops) {
    if (s.place?.status !== 'unmatched') continue;
    const id = s.place.complexId;
    if (!unmatched.has(id)) unmatched.set(id, { complexId: id, complexName: s.place.complexName, units: new Set(), households: 0 });
    const u = unmatched.get(id);
    u.units.add(s.unit || '(no unit)');
    u.households++;
  }
  for (const u of unmatched.values()) {
    const units = [...u.units];
    issues.push({
      kind: 'unmatched-units',
      title: `${u.complexName}: ${units.length} new ${units.length === 1 ? 'unit has' : 'units have'} no building`,
      detail: `Unit${units.length === 1 ? '' : 's'} ${units.join(', ')}. ${u.households === 1 ? 'This household goes' : 'These households go'} to the main address until you add ${units.length === 1 ? 'it' : 'them'}.`,
      households: u.households,
      complexId: u.complexId,
    });
  }

  const conflicts = stops.filter((s) => s.place?.conflict);
  if (conflicts.length) {
    issues.push({
      kind: 'conflicts',
      title: `${conflicts.length} ${conflicts.length === 1 ? 'unit matches' : 'units match'} two buildings`,
      detail: 'Two rules point the same unit to different buildings. We used the first one. Add a single-unit rule to settle it.',
      households: conflicts.length,
      complexId: conflicts[0].place.complexId,
    });
  }

  if (skipped.length) {
    issues.push({
      kind: 'skipped-rows',
      title: `${skipped.length} ${skipped.length === 1 ? 'row was' : 'rows were'} left out`,
      detail: skipped.slice(0, 6).map((r) => `Row ${r.rowNumber}: ${r.reason}`).join(' · ') + (skipped.length > 6 ? ' …' : ''),
      households: skipped.length,
    });
  }
  return issues;
}
