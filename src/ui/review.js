// Step 2: review routes. "Needs attention" at the top, route list on the
// left, the selected route's driver sheet on the right.

import { state, totals } from '../state.js';
import { html, raw, mount, icons, plural, copyText, openModal } from './dom.js';
import { renderSheet, routeMessage, prepareQrs } from './sheet.js';
import { openComplexSetup } from './complexSetup.js';
import { openPinMap } from './pinMap.js';

let filter = '';

function attentionBox() {
  if (!state.issues.length) {
    return html`<div class="all-good">${raw(icons.check)} Everything is ready. Every apartment goes to its building.</div>`;
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
                <span><strong>${c.street}</strong> <span class="muted">· ${plural(c.households, 'household')} · ${c.routes.length > 1 ? 'routes' : 'route'} ${c.routes.join(', ')}</span></span>
                <button class="btn btn-primary btn-small" data-setup-key="${c.key}">Set up buildings</button>
              </div>`,
            )}
            ${issue.items.length > shown.length ? html`<button class="link-btn" style="justify-self:start" data-show-all-complexes>Show ${issue.items.length - shown.length} more</button>` : ''}
          </div>
        </li>`;
    }
    const action =
      issue.kind === 'unmatched-units' ? html`<button class="btn btn-primary btn-small" data-edit-complex="${issue.complexId}">Add units to buildings</button>`
      : issue.kind === 'conflicts' ? html`<button class="btn btn-outline btn-small" data-edit-complex="${issue.complexId}">Open complex</button>`
      : html`<button class="btn btn-outline btn-small" data-go-mapping>Check columns</button>`;
    return html`<li><div><p>${issue.title}</p><p class="muted small">${issue.detail}</p></div>${action}</li>`;
  });
  return html`
    <section class="attention" aria-labelledby="attention-title">
      <h2 id="attention-title">${raw(icons.alert)} Needs attention <span class="muted small" style="font-weight:600">· ${plural(t.householdsAtEntrance, 'household')} will go to a main entrance</span></h2>
      <ul>${items}</ul>
    </section>`;
}

function routeItem(r) {
  return html`
    <li>
      <button class="route-item" data-route="${r.id}" aria-current="${r.id === state.selectedRoute}">
        <span class="route-num">${r.id}</span>
        <span>
          <strong>${r.driver || `Route ${r.id}`}</strong>
          <span class="route-meta" style="display:block">${plural(r.households, 'stop')}${r.hasBags ? ` · ${plural(r.bags, 'bag')}` : ''}</span>
        </span>
        ${r.status === 'ready'
          ? html`<span class="badge badge-ok"><span class="dot"></span>Ready</span>`
          : html`<span class="badge badge-warn">${raw(icons.alert.replace('class="icon"', 'class="icon" style="width:14px;height:14px"'))}${r.problems}</span>`}
      </button>
    </li>`;
}

export function renderReview(main, app) {
  const t = totals();
  const route = state.routes.find((r) => r.id === state.selectedRoute);
  const q = filter.trim().toLowerCase();
  const shown = state.routes.filter((r) => !q || r.id.toLowerCase().includes(q) || r.driver.toLowerCase().includes(q));

  mount(
    main,
    html`
      <div class="review-head">
        <div>
          <h1 class="page-title">Review routes</h1>
          <p class="muted">${plural(t.routes, 'route')} · ${plural(t.stops, 'stop')}${t.bags ? ` · ${plural(t.bags, 'bag')}` : ''} · from ${state.fileName}</p>
        </div>
        <button class="link-btn" data-go-mapping>Change columns</button>
      </div>
      ${attentionBox()}
      <label class="field route-select">
        <span>Route</span>
        <select id="route-select">
          ${state.routes.map((r) => html`<option value="${r.id}" ${r.id === state.selectedRoute ? raw('selected') : ''}>Route ${r.id}${r.driver ? ` · ${r.driver}` : ''} · ${r.status === 'ready' ? 'Ready' : 'Needs attention'}</option>`)}
        </select>
      </label>
      <div class="review-layout">
        <aside class="route-list" aria-label="Routes">
          <label class="field route-search"><span>Find a route or driver</span><input id="route-filter" type="search" value="${filter}" autocomplete="off" /></label>
          <ul class="route-items">${shown.map(routeItem)}</ul>
          ${shown.length ? '' : html`<p class="empty">No route matches “${filter}”.</p>`}
        </aside>
        <section id="sheet-slot">${route ? renderSheet(route) : html`<p class="empty">Pick a route to see its sheet.</p>`}</section>
      </div>`,
  );

  // Draw QR codes for the selected route once they're ready.
  if (route) {
    prepareQrs([route]).then(() => {
      const slot = main.querySelector('#sheet-slot');
      if (slot && state.selectedRoute === route.id && state.step === 'review') mount(slot, renderSheet(route));
    });
  }

  main.querySelectorAll('[data-route]').forEach((b) =>
    b.addEventListener('click', () => {
      state.selectedRoute = b.dataset.route;
      app.render();
      main.querySelector(`[data-route="${CSS.escape(b.dataset.route)}"]`)?.focus();
    }),
  );
  main.querySelector('#route-select').addEventListener('change', (e) => {
    state.selectedRoute = e.target.value;
    app.render();
  });
  const filterInput = main.querySelector('#route-filter');
  filterInput.addEventListener('input', () => {
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
    if (t.dataset.setupKey) {
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

  return {
    back: { label: 'Upload a different file', onClick: () => app.go('upload') },
    hint: t.needAttention ? `${plural(t.needAttention, 'route')} still need attention. You can still continue.` : 'All routes are ready.',
    next: { label: 'Continue to print & send', onClick: () => app.go('send') },
  };
}

function showAllComplexes(app) {
  const issue = state.issues.find((i) => i.kind === 'setup-complex');
  const m = openModal({ title: 'Complexes that need building locations' });
  mount(
    m.body,
    html`<ul class="place-list">${issue.items.map(
      (c) => html`<li><span><strong>${c.street}</strong><br /><span class="muted small">${plural(c.households, 'household')} · route ${c.routes.join(', ')}</span></span>
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
