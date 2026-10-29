// Step 3: print driver sheets and copy links for texting.

import { state, recompute, totals } from '../state.js';
import { MAX_STOPS_PER_LINK } from '../lib/mapsLinks.js';
import { getSetting, setSetting, list } from '../store/db.js';
import { downloadBackup } from '../store/backup.js';
import { html, raw, mount, icons, plural, copyText, toast } from './dom.js';
import { renderSheet, routeMessage, prepareQrs } from './sheet.js';

export async function printAll() {
  toast('Getting driver sheets ready…');
  await prepareQrs(state.routes);
  mount(document.getElementById('print-root'), state.routes.map((r) => renderSheet(r, { mode: 'print' })));
  // Give the browser a moment to lay out the SVGs before the print dialog.
  requestAnimationFrame(() => setTimeout(() => window.print(), 50));
}

export function renderSend(main, app) {
  const t = totals();
  mount(
    main,
    html`
      <div class="narrow">
        <h1 class="page-title">Print &amp; send</h1>
        <p class="page-sub">${plural(t.routes, 'route')} ready. Print one sheet per route, or copy links to text to drivers.</p>

        ${t.householdsAtEntrance
          ? html`<div class="attention" style="display:flex;justify-content:space-between;gap:16px;align-items:center;flex-wrap:wrap">
              <p><strong>${plural(t.householdsAtEntrance, 'household')}</strong> will go to a main entrance instead of their building.</p>
              <button class="btn btn-outline btn-small" data-review>Fix in review</button>
            </div>`
          : ''}

        <div class="send-actions">
          <button class="btn btn-primary" data-print>${raw(icons.print)} Print driver sheets</button>
          <button class="btn btn-outline" data-copy-all>${raw(icons.copy)} Copy all links</button>
        </div>

        <ul class="send-list" aria-label="Routes">
          ${state.routes.map(
            (r) => html`<li>
              <div>
                <strong>Route ${r.id}</strong>${r.driver ? html` <span class="muted">· ${r.driver}</span>` : ''}
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
        </details>
      </div>`,
  );

  showBackupNudge(main.querySelector('#backup-slot'));

  main.querySelector('[data-print]').addEventListener('click', printAll);
  main.querySelector('[data-review]')?.addEventListener('click', () => app.go('review'));
  main.querySelector('[data-copy-all]').addEventListener('click', () => copyText(state.routes.map(routeMessage).join('\n\n'), `Copied links for ${plural(state.routes.length, 'route')}.`));
  main.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', () => copyText(routeMessage(state.routes.find((r) => r.id === b.dataset.copy)))));
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
    next: { label: 'Print driver sheets', icon: icons.print, onClick: printAll },
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
