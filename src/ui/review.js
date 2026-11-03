// Step 2: review routes. "Make routes" (when the file has none) and
// "Needs attention" at the top, a delivery-day filter, the route list on the
// left and the selected route's driver sheet on the right.

import { state, totals, routeDays, visibleRoutes } from '../state.js';
import { formatMinutes } from '../lib/makeRoutes.js';
import { dayShort } from '../lib/columns.js';
import { html, raw, mount, icons, plural, copyText, openModal } from './dom.js';
import { renderSheet, routeMessage, prepareQrs } from './sheet.js';
import { openComplexSetup } from './complexSetup.js';
import { openPinMap } from './pinMap.js';
import { renderRoutesCard, shouldShowRoutesCard } from './routesCard.js';

let filter = '';
const smallIcon = (svg) => raw(svg.replace('class="icon"', 'class="icon" style="width:14px;height:14px"'));
const routeList = (routes) => (routes.length ? `${routes.length > 1 ? 'routes' : 'route'} ${routes.join(', ')}` : 'not on a route yet');

function attentionBox() {
  if (!state.issues.length) {
    return state.routes.length
      ? html`<div class="all-good">${raw(icons.check)} Everything is ready. Every apartment goes to its building.</div>`
      : '';
  }
  const t = totals();
  const items = state.issues.map((issue) => {
    if (issue.kind === 'setup-complex') {
      const shown = issue.items.slice(0, 4);
      return html`
        <li style="display:block">
          <p><strong>${issue.title}</strong></p>
          <p class="muted small" style="margin-bottom:10px">${issue.detail} Set each one up once and it works every week after.</p>
          <div style="display:grid;gap:8px">
            ${shown.map(
              (c) => html`<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
                <span><strong>${c.street}</strong> <span class="muted">· ${plural(c.households, 'household')} · ${routeList(c.routes.filter(Boolean))}</span></span>
                <button class="btn btn-primary btn-small" data-setup-key="${c.key}">Set up buildings</button>
              </div>`,
            )}
            ${issue.items.length > shown.length ? html`<button class="link-btn" style="justify-self:start" data-show-all-complexes>Show ${issue.items.length - shown.length} more</button>` : ''}
          </div>
        </li>`;
    }
    const action =
      issue.kind === 'not-routed' ? html`<button class="btn btn-primary btn-small" data-jump-make>Go to Make routes</button>`
      : issue.kind === 'over-limit' ? html`<button class="btn btn-outline btn-small" data-route="${issue.routeId}">Show route</button>`
      : issue.kind === 'unmatched-units' ? html`<button class="btn btn-primary btn-small" data-edit-complex="${issue.complexId}">Add units to buildings</button>`
      : issue.kind === 'conflicts' ? html`<button class="btn btn-outline btn-small" data-edit-complex="${issue.complexId}">Open complex</button>`
      : html`<button class="btn btn-outline btn-small" data-go-mapping>Check columns</button>`;
    return html`<li><div><p>${issue.title}</p><p class="muted small">${issue.detail}</p></div>${action}</li>`;
  });
  return html`
    <section class="attention" aria-labelledby="attention-title">
      <h2 id="attention-title">${raw(icons.alert)} Needs attention ${t.householdsAtEntrance ? html`<span class="muted small" style="font-weight:600">· ${plural(t.householdsAtEntrance, 'household')} will go to a main entrance</span>` : ''}</h2>
      <ul>${items}</ul>
    </section>`;
}

function dayFilter() {
  const days = routeDays();
  if (days.length < 2) return '';
  const chip = (value, label, count) =>
    html`<button class="day-chip" data-day="${value}" aria-pressed="${state.day === value}">${label} <span class="muted">${count}</span></button>`;
  return html`<div class="day-chips" role="group" aria-label="Delivery day">
    ${chip('all', 'All days', state.routes.length)}
    ${days.map((d) => chip(d.label, d.label, d.routes))}
  </div>`;
}

function routeItem(r) {
  const limits = [r.overBags && `${r.bags} bags`, r.overTime && 'over 2 h'].filter(Boolean);
  const meta = [plural(r.households, 'stop'), r.hasBags && plural(r.bags, 'bag'), r.minutes != null && `~${formatMinutes(r.minutes)}`].filter(Boolean).join(' · ');
  const short = r.name.match(/\d+[a-z]?/i)?.[0] ?? r.name.slice(0, 3); // "Tue 03 · Carrboro" -> "03", "01a-Efland" -> "01a
  return html`
    <li>
      <button class="route-item" data-route="${r.id}" aria-current="${r.id === state.selectedRoute}">
        <span class="route-num" title="${r.title}">${short}</span>
        <span>
          <strong>${r.driver || r.title}</strong>
          <span class="route-meta" style="display:block">${state.day === 'all' && r.day && !r.name.startsWith(dayShort(r.day)) ? `${dayShort(r.day)} · ` : ''}${meta}</span>
        </span>
        ${limits.length
          ? html`<span class="badge badge-warn" title="Over the limits: ${limits.join(', ')}">${smallIcon(icons.alert)}Over</span>`
          : r.status === 'ready'
            ? html`<span class="badge badge-ok"><span class="dot"></span>Ready</span>`
            : html`<span class="badge badge-warn">${smallIcon(icons.alert)}${r.problems}</span>`}
      </button>
    </li>`;
}

export function renderReview(main, app) {
  const t = totals();
  const routes = visibleRoutes();
  const route = routes.find((r) => r.id === state.selectedRoute);
  const q = filter.trim().toLowerCase();
  const shown = routes.filter((r) => !q || r.title.toLowerCase().includes(q) || r.driver.toLowerCase().includes(q));
  const waitingBags = state.waiting.reduce((n, s) => n + (s.bags ?? 0), 0);
  const facts = [
    state.routes.length ? plural(t.routes, 'route') : 'No routes yet',
    state.routes.length ? plural(t.stops, 'stop') : plural(state.waiting.length, 'household'),
    state.routes.length ? t.bags && `${plural(t.bags, 'bag')}${t.special ? ` (${t.special} special diet)` : ''}` : waitingBags && plural(waitingBags, 'bag'),
    state.pickups && `${plural(state.pickups, 'pickup household')} left out`,
    `from ${state.fileName}`,
  ].filter(Boolean);

  mount(
    main,
    html`
      <div class="review-head">
        <div>
          <h1 class="page-title">Review routes</h1>
          <p class="muted">${facts.join(' · ')}</p>
        </div>
        <button class="link-btn" data-go-mapping>Change columns</button>
      </div>
      <div id="routes-card-slot"></div>
      ${attentionBox()}
      ${state.routes.length
        ? html`
          ${dayFilter()}
          <label class="field route-select">
            <span>Route</span>
            <select id="route-select">
              ${routes.map((r) => html`<option value="${r.id}" ${r.id === state.selectedRoute ? raw('selected') : ''}>${r.title}${r.driver ? ` · ${r.driver}` : ''} · ${r.status === 'ready' ? 'Ready' : 'Needs attention'}</option>`)}
            </select>
          </label>
          <div class="review-layout">
            <aside class="route-list" aria-label="Routes">
              <label class="field route-search"><span>Find a route or driver</span><input id="route-filter" type="search" value="${filter}" autocomplete="off" /></label>
              <ul class="route-items">${shown.map(routeItem)}</ul>
              ${shown.length ? '' : html`<p class="empty">No route matches “${filter}”.</p>`}
            </aside>
            <section id="sheet-slot">${route ? renderSheet(route) : html`<p class="empty">Pick a route to see its sheet.</p>`}</section>
          </div>`
        : ''}`,
  );

  if (shouldShowRoutesCard()) renderRoutesCard(main.querySelector('#routes-card-slot'), app);

  // Draw QR codes for the selected route once they're ready.
  if (route) {
    prepareQrs([route]).then(() => {
      const slot = main.querySelector('#sheet-slot');
      if (slot && state.selectedRoute === route.id && state.step === 'review') mount(slot, renderSheet(route));
    });
  }

  main.querySelector('#route-select')?.addEventListener('change', (e) => {
    state.selectedRoute = e.target.value;
    app.render();
  });
  const filterInput = main.querySelector('#route-filter');
  filterInput?.addEventListener('input', () => {
    filter = filterInput.value;
    const pos = filterInput.selectionStart;
    app.render();
    const f = main.querySelector('#route-filter');
    f.focus();
    f.setSelectionRange(pos, pos);
  });

  main.onclick = (e) => {
    const t = e.target.closest('button, a');
    if (!t) return;
    if (t.dataset.route) {
      state.selectedRoute = t.dataset.route;
      const r = state.routes.find((x) => x.id === t.dataset.route);
      if (r && state.day !== 'all' && r.day !== state.day) state.day = 'all';
      app.render();
      main.querySelector(`.route-item[data-route="${CSS.escape(t.dataset.route)}"]`)?.focus();
    } else if (t.dataset.day) {
      state.day = t.dataset.day;
      const visible = visibleRoutes();
      if (!visible.some((r) => r.id === state.selectedRoute)) state.selectedRoute = (visible.find((r) => r.status === 'attention') || visible[0])?.id ?? null;
      app.render();
      main.querySelector(`[data-day="${CSS.escape(t.dataset.day)}"]`)?.focus();
    } else if ('jumpMake' in t.dataset) {
      main.querySelector('#make-routes')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      main.querySelector('#make-routes [data-make]')?.focus({ preventScroll: true });
    } else if (t.dataset.setupKey) {
      const c = state.issues.find((i) => i.kind === 'setup-complex')?.items.find((x) => x.key === t.dataset.setupKey);
      if (c) openComplexSetup(app, { candidate: c });
    } else if (t.dataset.editComplex) {
      openComplexSetup(app, { complexId: t.dataset.editComplex, focusUnit: t.dataset.unit });
    } else if (t.dataset.pinStop) {
      const s = state.stops.find((x) => x.id === t.dataset.pinStop);
      if (s) openPinMap(app, s);
    } else if (t.dataset.copyRoute) {
      copyText(routeMessage(state.routes.find((r) => r.id === t.dataset.copyRoute)));
    } else if ('goMapping' in t.dataset) {
      app.go('mapping');
    } else if ('showAllComplexes' in t.dataset) {
      showAllComplexes(app);
    }
  };

  const hint = !state.routes.length
    ? 'Make routes first.'
    : t.needAttention
      ? `${plural(t.needAttention, 'route')} still need attention. You can still continue.`
      : 'All routes are ready.';
  return {
    back: { label: 'Upload a different file', onClick: () => app.go('upload') },
    hint,
    next: { label: 'Continue to print & send', disabled: !state.routes.length, onClick: () => app.go('send') },
  };
}

function showAllComplexes(app) {
  const issue = state.issues.find((i) => i.kind === 'setup-complex');
  const m = openModal({ title: 'Complexes that need building locations' });
  mount(
    m.body,
    html`<ul class="place-list">${issue.items.map(
      (c) => html`<li><span><strong>${c.street}</strong><br /><span class="muted small">${plural(c.households, 'household')} · ${routeList(c.routes.filter(Boolean))}</span></span>
        <button class="btn btn-primary btn-small" data-key="${c.key}">Set up buildings</button></li>`,
    )}</ul>`,
  );
  m.body.addEventListener('click', (e) => {
    const k = e.target.closest('[data-key]')?.dataset.key;
    if (!k) return;
    m.close();
    openComplexSetup(app, { candidate: issue.items.find((c) => c.key === k) });
  });
}
