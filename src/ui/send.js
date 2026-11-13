// Step 3: print driver sheets and copy links for texting.

import { state, recompute, totals, visibleRoutes, routeDays } from '../state.js';
import { MAX_STOPS_PER_LINK } from '../lib/mapsLinks.js';
import { getSetting, setSetting, list } from '../store/db.js';
import { downloadBackup } from '../store/backup.js';
import { testConnection, status as syncStatus, enabled as syncEnabled } from '../store/sync.js';
import { html, raw, mount, icons, plural, copyText, toast } from './dom.js';
import { renderSheet, routeMessage, prepareQrs } from './sheet.js';

/** Prints the routes for the chosen delivery day (or all of them). */
export async function printAll() {
  const routes = visibleRoutes();
  toast('Getting driver sheets ready…');
  await prepareQrs(routes);
  mount(document.getElementById('print-root'), routes.map((r) => renderSheet(r, { mode: 'print' })));
  // Give the browser a moment to lay out the SVGs before the print dialog.
  requestAnimationFrame(() => setTimeout(() => window.print(), 50));
}

export function renderSend(main, app) {
  const t = totals();
  const routes = visibleRoutes();
  const days = routeDays();
  const which = state.day === 'all' ? '' : `${state.day}'s `;
  mount(
    main,
    html`
      <div class="narrow">
        <h1 class="page-title">Print &amp; send</h1>
        <p class="page-sub">${plural(t.routes, 'route')} ready${state.day === 'all' ? '' : ` for ${state.day}`}. Print one sheet per route, or copy links to text to drivers.</p>
        ${days.length > 1
          ? html`<div class="day-chips" role="group" aria-label="Delivery day">
              <button class="day-chip" data-day="all" aria-pressed="${state.day === 'all'}">All days</button>
              ${days.map((d) => html`<button class="day-chip" data-day="${d.label}" aria-pressed="${state.day === d.label}">${d.label} <span class="muted">${d.routes}</span></button>`)}
            </div>`
          : ''}

        ${t.householdsAtEntrance
          ? html`<div class="attention" style="display:flex;justify-content:space-between;gap:16px;align-items:center;flex-wrap:wrap">
              <p><strong>${plural(t.householdsAtEntrance, 'household')}</strong> will go to a main entrance instead of their building.</p>
              <button class="btn btn-outline btn-small" data-review>Fix in review</button>
            </div>`
          : ''}

        <div class="send-actions">
          <button class="btn btn-primary" data-print>${raw(icons.print)} Print ${which}driver sheets</button>
          <button class="btn btn-outline" data-copy-all>${raw(icons.copy)} Copy all links</button>
        </div>

        <ul class="send-list" aria-label="Routes">
          ${routes.map(
            (r) => html`<li>
              <div>
                <strong>${r.title}</strong>${[state.day === 'all' && r.day, r.driver].filter(Boolean).map((x) => html` <span class="muted">· ${x}</span>`)}
                <div class="send-links small">
                  ${r.links.map((l) => html`<a href="${l.url}" target="_blank" rel="noopener noreferrer">${l.label}</a>`)}
                </div>
              </div>
              <button class="btn btn-outline btn-small btn-pill" data-copy="${r.id}">${raw(icons.copy)} Copy link</button>
            </li>`,
          )}
        </ul>

        <div id="backup-slot"></div>

        <details class="more settings-box">
          <summary>Settings</summary>
          <div class="card">
            <label class="field" style="max-width:260px">
              <span>Stops per Google Maps link</span>
              <input id="per-link" type="number" min="1" max="${MAX_STOPS_PER_LINK}" value="${state.perLink}" inputmode="numeric" />
            </label>
            <p class="muted small" style="margin-top:10px">
              Long routes are split into parts. In the Google Maps app, a link can hold up to ${MAX_STOPS_PER_LINK} stops.
              If a driver opens links in a phone's web browser without the app, only 4 stops work, so set this to 4 for them.
              Several apartments in the same building count as one stop.
            </p>
          </div>
          <div class="card checkin-settings">
            <h2 class="card-title">Driver check-in and shared building pins</h2>
            <p class="muted small">
              Optional. Connects the app to a Google Sheet in TABLE's own Google account. Then each route sheet gets a
              <strong>Check in deliveries</strong> QR code: drivers tap Delivered (or Problem) at each stop, can add a photo, and every tap lands in
              the Sheet with the time. Building pins are also shared, so every computer sees the same apartment setup.
              Set-up takes about 10 minutes, once: <a href="https://github.com/Hobbs2k8/TABLE-Delivery/blob/main/docs/CHECKIN-SETUP.md" target="_blank" rel="noopener noreferrer">step-by-step guide</a>.
            </p>
            <label class="field"><span>Web app URL (ends in /exec)</span><input id="ci-url" type="url" autocomplete="off" spellcheck="false" placeholder="https://script.google.com/macros/s/…/exec" value="${state.checkin?.url || ''}" /></label>
            <label class="field"><span>Key</span><input id="ci-key" type="text" autocomplete="off" spellcheck="false" value="${state.checkin?.key || ''}" /></label>
            <div class="row-actions" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
              <button class="btn btn-primary btn-small" data-ci-save>Test and save</button>
              ${state.checkin?.url ? html`<button class="btn btn-outline btn-small" data-ci-off>Turn off</button>` : ''}
            </div>
            <p class="small" id="ci-status" role="status" aria-live="polite">${syncEnabled()
              ? syncStatus.error
                ? html`<span style="color:var(--warn)">Connected, but the last sync failed: ${syncStatus.error}</span>`
                : html`<span style="color:var(--ok)">Connected. Check-in codes are on the sheets.${syncStatus.lastAt ? ` Building pins synced at ${syncStatus.lastAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.` : ''}</span>`
              : ''}</p>
          </div>
        </details>
      </div>`,
  );

  showBackupNudge(main.querySelector('#backup-slot'));

  main.querySelector('[data-print]').addEventListener('click', printAll);
  main.querySelector('[data-review]')?.addEventListener('click', () => app.go('review'));
  main.querySelector('[data-copy-all]').addEventListener('click', () => copyText(routes.map(routeMessage).join('\n\n'), `Copied links for ${plural(routes.length, 'route')}.`));
  main.querySelectorAll('[data-day]').forEach((b) =>
    b.addEventListener('click', () => {
      state.day = b.dataset.day;
      app.render();
      main.querySelector(`[data-day="${CSS.escape(b.dataset.day)}"]`)?.focus();
    }),
  );
  main.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', () => copyText(routeMessage(state.routes.find((r) => r.id === b.dataset.copy)))));
  main.querySelector('[data-ci-save]').addEventListener('click', async () => {
    const url = main.querySelector('#ci-url').value.trim();
    const key = main.querySelector('#ci-key').value.trim();
    const out = main.querySelector('#ci-status');
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url)) {
      out.textContent = 'That doesn’t look like an Apps Script web app URL. It starts with https://script.google.com/macros/s/ and ends with /exec.';
      return;
    }
    if (!key) {
      out.textContent = 'Paste the key that setup() printed.';
      return;
    }
    out.textContent = 'Checking…';
    try {
      await testConnection(url, key);
    } catch (e) {
      out.textContent = e.message;
      return;
    }
    await app.setCheckin({ url, key });
    document.querySelector('details.settings-box').open = true;
    toast('Connected to TABLE’s sheet. Print new sheets to get the check-in codes.');
  });
  main.querySelector('[data-ci-off]')?.addEventListener('click', async () => {
    if (!confirm('Turn off driver check-in? New sheets won’t have the check-in code. Nothing in TABLE’s Sheet is deleted.')) return;
    await app.setCheckin(null);
    document.querySelector('details.settings-box').open = true;
  });
  main.querySelector('#per-link').addEventListener('change', async (e) => {
    const n = Math.max(1, Math.min(MAX_STOPS_PER_LINK, Math.round(Number(e.target.value)) || MAX_STOPS_PER_LINK));
    state.perLink = n;
    await setSetting('perLink', n).catch(() => {});
    recompute();
    app.render();
    main.querySelector('details.settings-box').open = true;
    toast(`Links now hold up to ${n} stops.`);
  });

  return {
    back: { label: 'Back', onClick: () => app.go('review') },
    next: { label: `Print ${which}driver sheets`, icon: icons.print, onClick: printAll },
  };
}

async function showBackupNudge(slot) {
  try {
    const [changes, last, complexes] = await Promise.all([getSetting('unsavedChanges', 0), getSetting('lastBackupAt'), list('complexes')]);
    if (!complexes.length || (!changes && last)) return;
    mount(
      slot,
      html`<div class="card backup-nudge">
        <div>
          <p><strong>${changes ? `You changed ${plural(changes, 'building setup')} since your last backup.` : 'You have never backed up your building pins.'}</strong></p>
          <p class="muted small">Pins are saved only in this browser. A backup file lets you restore them or move them to another computer.</p>
        </div>
        <button class="btn btn-outline btn-small" data-backup>${raw(icons.download)} Download backup</button>
      </div>`,
    );
    slot.querySelector('[data-backup]').addEventListener('click', async () => {
      await downloadBackup();
      slot.innerHTML = '';
      toast('Backup downloaded. Keep it somewhere safe, like a shared drive.');
    });
  } catch {
    /* storage unavailable: nothing to back up */
  }
}
