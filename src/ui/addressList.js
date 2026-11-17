// The address list on screen: start it, save each week's new doors, review
// new addresses, and move a new household to its best route.
// See lib/addressBook.js for what is stored (no names, ever).

import { state, recompute } from '../state.js';
import { list, put, putMany } from '../store/db.js';
import { scheduleSync } from '../store/sync.js';
import { startBook, suggestRoute, doorKey } from '../lib/addressBook.js';
import { moveStopAssignments, formatMinutes } from '../lib/makeRoutes.js';
import { weekOf } from '../lib/checkin.js';
import { routeTitle } from '../lib/routes.js';
import { html, raw, mount, icons, plural, openModal, toast } from './dom.js';
import { openPinMap } from './pinMap.js';

async function reloadBook() {
  state.addressBook = await list('addresses').catch(() => state.addressBook);
  recompute();
}

/** After an upload: add this week's new doors (as "not reviewed") and note when known doors were last seen. */
export async function saveWeek() {
  if (!state.freshToSave.length) return;
  const now = new Date().toISOString();
  await putMany('addresses', state.freshToSave.map((r) => ({ ...r, schemaVersion: 1, updatedAt: now, createdAt: r.createdAt || now }))).catch(() => {});
  await reloadBook();
  scheduleSync();
}

export async function startList(app) {
  const now = new Date().toISOString();
  const records = startBook(state.stops, weekOf()).map((r) => ({ ...r, schemaVersion: 1, updatedAt: now, createdAt: now }));
  await putMany('addresses', records);
  await reloadBook();
  scheduleSync();
  app.render();
  toast(`Saved ${plural(records.length - 1, 'address', 'addresses')}. From next week, new ones are flagged for review.`);
}

async function markReviewed(stops) {
  const byId = new Map(state.addressBook.map((r) => [r.id, r]));
  for (const s of stops) {
    const r = byId.get(doorKey(s));
    if (r && !r.reviewed) await put('addresses', { ...r, reviewed: true });
  }
  await reloadBook();
  scheduleSync();
}

/** The card shown on Review until the list is started. */
export function startCard() {
  return html`<section class="card address-start" aria-labelledby="al-title">
    <div>
      <h2 id="al-title" class="card-title">Spot new addresses every week</h2>
      <p class="muted small">Save this week's ${plural(new Set(state.stops.map(doorKey)).size, 'address', 'addresses')} as TABLE's address list. Each week after, the app flags addresses that aren't on it, so you can check them, pin hard-to-find ones once, and put them on the best route.
      It saves street, town and unit only, never names or phones, in this browser${state.checkin?.url ? ' and TABLE’s Google account' : ''}.</p>
    </div>
    <button class="btn btn-primary" data-start-list>Start the address list</button>
  </section>`;
}

function suggestionFor(s) {
  if (!s.route) return { text: 'Not on a route yet. Make routes to place it.' };
  const sug = suggestRoute(s, state.routes, state.rules, state.lookups);
  if (sug.reason === 'no-point') return { text: 'Pin it to see which route it fits best.' };
  if (sug.reason === 'routes-not-pinned') return { text: 'Can’t compare routes yet: some stops on this day’s routes have no map location.' };
  if (sug.reason === 'no-room') return { text: `No route on ${s.day || 'this day'} has room for ${plural(s.bags ?? 0, 'more bag')}.` };
  if (sug.current) return { text: `On the best route (${sug.route.title}).`, ok: true };
  return { text: `Fits best on ${sug.route.title} (adds about ${formatMinutes(sug.addedMinutes)}).`, move: sug.route };
}

export function openNewAddresses(app) {
  const m = openModal({ title: 'New addresses this week', wide: true });
  const draw = () => {
    const fresh = state.fresh;
    if (!fresh.length) {
      mount(m.body, html`<p>${raw(icons.check)} All new addresses are checked.</p><div style="margin-top:16px"><button class="btn btn-primary" data-close-list>Done</button></div>`);
      return;
    }
    mount(
      m.body,
      html`<p class="muted small" style="margin-bottom:12px">These doors weren't on TABLE's address list. For each one: pin it if drivers would have trouble finding it, move it if another route fits better, then mark it checked.</p>
        <ul class="place-list">
          ${fresh.map((s) => {
            const sug = suggestionFor(s);
            const where = s.place.kind === 'building' ? `goes to ${s.place.label}` : s.place.kind === 'pin' ? 'pinned' : 'goes to the street address';
            return html`<li style="align-items:flex-start">
              <span><strong>${s.street}${s.unit ? `, Apt ${s.unit}` : ''}</strong> <span class="muted">· ${s.city}</span><br />
                <span class="muted small">${s.route ? `${s.day ? `${s.day}, ` : ''}${routeTitle(s.route)}` : 'no route'} · ${plural(s.bags ?? 0, 'bag')} · ${where}</span><br />
                <span class="small" style="color:${sug.ok ? 'var(--ok)' : 'inherit'}">${sug.text}</span></span>
              <span style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
                ${sug.move ? html`<button class="btn btn-primary btn-small" data-move="${s.id}" data-to="${sug.move.id}">Move to ${sug.move.title}</button>` : ''}
                <button class="btn btn-outline btn-small" data-pin="${s.id}">${s.place.kind === 'pin' ? 'Move pin' : s.unit ? 'Pin this unit' : 'Pin this house'}</button>
                <button class="btn btn-outline btn-small" data-ok="${s.id}">Looks right</button>
              </span>
            </li>`;
          })}
        </ul>
        <div style="display:flex;justify-content:flex-end;gap:12px;margin-top:16px"><button class="btn btn-outline" data-ok-all>Mark all ${fresh.length} as checked</button></div>`,
    );
  };
  m.body.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if ('closeList' in t.dataset) {
      m.close();
      app.render();
    } else if (t.dataset.ok) {
      await markReviewed(state.fresh.filter((s) => s.id === t.dataset.ok));
      draw();
    } else if ('okAll' in t.dataset) {
      await markReviewed(state.fresh);
      draw();
    } else if (t.dataset.move) {
      const stop = state.stops.find((s) => s.id === t.dataset.move);
      const target = state.routes.find((r) => r.id === t.dataset.to);
      for (const [k, v] of moveStopAssignments(stop, target, state.rules, state.lookups)) state.assignments.set(k, v);
      recompute();
      toast(`Moved ${stop.street} to ${target.title}.`);
      draw();
    } else if (t.dataset.pin) {
      const stop = state.stops.find((s) => s.id === t.dataset.pin);
      m.close();
      openPinMap(app, stop, null, { door: Boolean(stop.unit), after: () => openNewAddresses(app) });
    }
  });
  draw();
}
