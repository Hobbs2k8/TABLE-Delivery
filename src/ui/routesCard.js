// The "Make routes" card on Review, shown when the weekly file has no routes
// (TABLE's workbook often doesn't). One click groups every household into
// routes: start at TABLE, at most 30 bags, under 2 hours, no drive back.

import { state, recompute } from '../state.js';
import { build } from '../lib/routing.js';
import { routingGroups, assignmentsFrom, DEFAULT_RULES } from '../lib/makeRoutes.js';
import { findMany } from '../services/geocode.js';
import { setSetting } from '../store/db.js';
import { html, raw, mount, icons, plural, openModal, toast } from './dom.js';
import { openPinMap } from './pinMap.js';

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
let busy = false;

/** Households to route, with the delivery day from the file (not from earlier made routes). */
function routable() {
  const base = new Map(state.baseStops.map((s) => [s.id, s]));
  return state.stops.map((s) => ({ ...s, day: base.get(s.id).day, dayOrder: base.get(s.id).dayOrder }));
}

/** Run the search in a Web Worker; fall back to this thread if workers aren't available. */
function buildOffThread(households, opts) {
  return new Promise((resolve, reject) => {
    let worker;
    try {
      worker = new Worker(new URL('../lib/routeWorker.js', import.meta.url), { type: 'module' });
    } catch {
      resolve(build(households, opts));
      return;
    }
    worker.onmessage = (e) => {
      worker.terminate();
      if (e.data.ok) resolve(e.data.result);
      else reject(new Error(e.data.error));
    };
    worker.onerror = (e) => {
      e.preventDefault();
      worker.terminate();
      try {
        resolve(build(households, opts));
      } catch (err) {
        reject(err);
      }
    };
    worker.postMessage({ households, opts });
  });
}

export function shouldShowRoutesCard() {
  return !state.fileHasRoutes && state.baseStops.length > 0;
}

export function renderRoutesCard(slot, app) {
  const stops = routable();
  const { missing, fileDays } = routingGroups(stops, state.lookups);
  const waiting = state.waiting.length;
  const r = state.rules;
  const made = state.routesMadeAt && !waiting;

  mount(
    slot,
    html`
      <section class="card make-routes" id="make-routes" aria-labelledby="mr-title">
        <div class="mr-head">
          <div>
            <h2 id="mr-title">${made ? 'Routes are made' : 'Make routes'}</h2>
            <p class="muted">
              ${made
                ? `${plural(state.routes.length, 'route')} made at ${state.routesMadeAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}. Each starts at TABLE, carries at most ${r.maxBags} bags and takes under ${r.maxMinutes / 60} hours, with no drive back.`
                : `This file has no routes. The app can group ${plural(stops.length, 'household')} into routes that start at TABLE, carry at most ${r.maxBags} bags and take under ${r.maxMinutes / 60} hours, with no drive back.`}
            </p>
          </div>
          <button class="btn ${made ? 'btn-outline' : 'btn-primary'}" data-make ${busy ? raw('disabled') : ''}>${made ? 'Make routes again' : 'Make routes'}</button>
        </div>
        <p class="mr-status" role="status" aria-live="polite" id="mr-status"></p>

        ${missing.length
          ? html`<div class="mr-missing">
              <p><strong>${raw(icons.pin)} ${plural(missing.length, 'household')} ${missing.length === 1 ? 'has' : 'have'} no spot on the map yet</strong>, so ${missing.length === 1 ? 'it' : 'they'} can't go on a route.
                ${missing.length < stops.length ? 'The others can be routed now.' : ''}</p>
              <div class="mr-actions">
                <button class="btn btn-outline btn-small" data-find>Find ${missing.length === 1 ? 'it' : `these ${missing.length}`} on the map…</button>
                <button class="link-btn small" data-show-missing>Or pin them one by one</button>
              </div>
              <ul class="place-list mr-missing-list" hidden>
                ${missing.slice(0, 50).map(
                  (s) => html`<li><span><strong>${s.street}</strong>${s.unit ? ` · Apt ${s.unit}` : ''} <span class="muted small">${s.city}</span></span><button class="btn btn-outline btn-small" data-pin="${s.id}">Pin on map</button></li>`,
                )}
              </ul>
            </div>`
          : ''}

        <details class="more">
          <summary>Route rules</summary>
          <div class="mr-rules">
            <p class="small muted">Routes start at <strong>${r.depot.label}</strong>. Drive times are estimates from distance (no outside service), so check new routes against what drivers know.</p>
            <label class="field"><span>Most bags per car</span><input type="number" min="1" max="200" data-rule="maxBags" value="${r.maxBags}" /></label>
            <label class="field"><span>Longest route (minutes)</span><input type="number" min="15" max="600" step="5" data-rule="maxMinutes" value="${r.maxMinutes}" /></label>
            <label class="field"><span>Minutes at each door</span><input type="number" min="0" max="30" data-rule="stopMinutes" value="${r.stopMinutes}" /></label>
            ${fileDays
              ? html`<p class="small muted">The file gives each household a delivery day, so routes are made within each day.</p>`
              : html`<fieldset class="mr-days"><legend>Delivery days to spread routes over</legend>
                  ${WEEKDAYS.map((d) => html`<label><input type="checkbox" data-rule-day="${d}" ${r.days.includes(d) ? raw('checked') : ''} /> ${d}</label>`)}
                </fieldset>`}
            <button class="link-btn small" data-reset-rules>Reset to TABLE's rules</button>
          </div>
        </details>
      </section>`,
  );

  const status = slot.querySelector('#mr-status');
  slot.querySelector('[data-make]').addEventListener('click', () => make(app, status));
  slot.querySelector('[data-find]')?.addEventListener('click', () => confirmFind(app, missing));
  slot.querySelector('[data-show-missing]')?.addEventListener('click', () => {
    const list = slot.querySelector('.mr-missing-list');
    list.hidden = !list.hidden;
  });
  slot.querySelectorAll('[data-pin]').forEach((b) => b.addEventListener('click', () => openPinMap(app, missing.find((s) => s.id === b.dataset.pin))));

  const saveRules = async (rules) => {
    state.rules = rules;
    await setSetting('routeRules', rules).catch(() => {});
    recompute();
    app.render();
    document.querySelector('#make-routes details').open = true;
  };
  slot.querySelectorAll('[data-rule]').forEach((input) =>
    input.addEventListener('change', () => {
      const v = Number(input.value);
      if (Number.isFinite(v) && v >= Number(input.min)) saveRules({ ...state.rules, [input.dataset.rule]: v });
    }),
  );
  slot.querySelectorAll("[data-rule-day]").forEach((box) =>
    box.addEventListener('change', () => {
      const days = WEEKDAYS.filter((d) => (d === box.dataset.ruleDay ? box.checked : state.rules.days.includes(d)));
      saveRules({ ...state.rules, days });
    }),
  );
  slot.querySelector('[data-reset-rules]').addEventListener('click', () => saveRules(DEFAULT_RULES));
}

async function make(app, status) {
  if (busy) return;
  const stops = routable();
  const { groups, missing, fileDays } = routingGroups(stops, state.lookups);
  if (!groups.length) {
    status.textContent = 'No household has a spot on the map yet. Find them on the map first.';
    return;
  }
  if (!fileDays && !state.rules.days.length) {
    status.textContent = 'Tick at least one delivery day under Route rules.';
    return;
  }
  if (state.routesMadeAt && !confirm('Make all the routes again from scratch?')) return;

  busy = true;
  const button = document.querySelector('[data-make]');
  if (button) button.disabled = true;
  const results = [];
  try {
    for (const g of groups) {
      status.textContent = `Making ${g.day ? `${g.day} ` : ''}routes for ${plural(g.households.length, 'household')}…`;
      results.push(await buildOffThread(g.households, { ...state.rules, seed: 1 }));
    }
  } catch (err) {
    status.textContent = `Making routes didn't work: ${err.message}`;
    return;
  } finally {
    busy = false;
    if (button?.isConnected) button.disabled = false;
  }
  state.assignments = assignmentsFrom(groups, results, state.rules, state.lookups);
  state.routesMadeAt = new Date();
  state.selectedRoute = null;
  recompute();
  app.render();
  toast(`Made ${plural(state.routes.length, 'route')} for ${plural(state.assignments.size, 'household')}.${missing.length ? ` ${missing.length} still need a spot on the map.` : ''}`);
}

/** Opt-in: sending household street addresses out needs an explicit yes, every time. */
function confirmFind(app, missing) {
  const n = new Set(missing.map((s) => s.key)).size;
  const m = openModal({ title: 'Find addresses on the map' });
  let stopped = false;
  mount(
    m.body,
    html`
      <p style="margin-bottom:12px">To make routes, every household needs a spot on the map. This looks up <strong>${plural(n, 'street address', 'street addresses')}</strong> with OpenStreetMap's free map search.</p>
      <ul style="margin:0 0 12px;padding-left:20px">
        <li>Only the <strong>street and town</strong> are sent. Never names, phone numbers, unit numbers, diet or other details.</li>
        <li>It takes about <strong>${Math.ceil((n * 1.1) / 60)} ${Math.ceil((n * 1.1) / 60) === 1 ? 'minute' : 'minutes'}</strong> (one address per second, as the service asks).</li>
        <li>Answers are saved on this computer, so each address is only looked up once.</li>
      </ul>
      <p class="tip small muted" style="background:var(--bg-soft);padding:10px 14px;border-radius:var(--r-sm)">Check with TABLE that sending family street addresses to OpenStreetMap is OK before using this with real families. You can always pin households by hand instead.</p>
      <div class="mr-progress" hidden><div class="bar"><span></span></div><p class="small" role="status" aria-live="polite"></p></div>
      <div style="display:flex;justify-content:flex-end;gap:12px;margin-top:20px">
        <button class="link-btn" data-cancel>Cancel</button>
        <button class="btn btn-primary" data-go>Find ${plural(n, 'address', 'addresses')}</button>
      </div>`,
  );
  m.body.querySelector('[data-cancel]').onclick = () => {
    stopped = true;
    m.close();
  };
  m.body.querySelector('[data-go]').onclick = async (e) => {
    e.target.disabled = true;
    m.body.querySelector('[data-cancel]').textContent = 'Stop';
    const prog = m.body.querySelector('.mr-progress');
    prog.hidden = false;
    try {
      const { points, notFound } = await findMany(missing, {
        shouldContinue: () => !stopped,
        onProgress: (done, total, found) => {
          prog.querySelector('span').style.width = `${(100 * done) / total}%`;
          prog.querySelector('p').textContent = `Looked up ${done} of ${total}. Found ${found}.`;
        },
      });
      for (const [k, p] of points) state.lookups.set(k, p);
      recompute();
      app.render();
      m.close();
      toast(`Found ${plural(points.size, 'address', 'addresses')}.${notFound.length ? ` ${notFound.length} couldn't be found: pin ${notFound.length === 1 ? 'it' : 'them'} by hand.` : ''}`);
    } catch (err) {
      prog.querySelector('p').textContent = err.message;
      e.target.disabled = false;
    }
  };
}
