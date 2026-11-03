// The single "Needs attention" list shown at the top of the review screen.

import { detectComplexes } from './complexes.js';

/**
 * Returns [{ kind, title, detail, households, ... }]; each item links to its fix.
 * kind: 'not-routed' | 'over-limit' | 'setup-complex' | 'unmatched-units' | 'conflicts' | 'skipped-rows'
 */
export function findIssues({ stops, complexes, pins = [], skipped = [], routes = [], waiting = [], rules = null }) {
  const issues = [];

  if (waiting.length) {
    const bags = waiting.reduce((n, s) => n + (s.bags ?? 1), 0);
    issues.push({
      kind: 'not-routed',
      title: `${waiting.length} ${waiting.length === 1 ? 'household is' : 'households are'} not on a route yet`,
      detail: `${bags} ${bags === 1 ? 'bag' : 'bags'}. Make routes to give every household a driver.`,
      households: waiting.length,
    });
  }

  const over = rules ? routes.filter((r) => r.overBags || r.overTime) : [];
  if (over.length) {
    issues.push({
      kind: 'over-limit',
      title: `${over.length} ${over.length === 1 ? 'route is' : 'routes are'} over the limits`,
      detail: over
        .map((r) => `${r.title}: ${[r.overBags && `${r.bags} bags`, r.overTime && 'over 2 hours'].filter(Boolean).join(', ')}`)
        .join(' · '),
      households: over.reduce((n, r) => n + r.households, 0),
      routeId: over[0].id,
    });
  }

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
