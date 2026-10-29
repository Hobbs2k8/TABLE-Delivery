// "Saved complexes & pins": see, edit or delete what's saved, and back up / restore.

import { state } from '../state.js';
import { remove } from '../store/db.js';
import { downloadBackup, restoreBackup } from '../store/backup.js';
import { html, raw, mount, icons, plural, openModal, toast } from './dom.js';
import { openComplexSetup } from './complexSetup.js';
import { openPinMap } from './pinMap.js';

export function openSavedPlaces(app, { action } = {}) {
  const m = openModal({ title: 'Saved complexes & pins', wide: true });

  const draw = (message = '') => {
    mount(
      m.body,
      html`
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px">
          <button class="btn btn-outline btn-small" data-backup>${raw(icons.download)} Download a backup</button>
          <label class="btn btn-outline btn-small" style="cursor:pointer">${raw(icons.upload)} Restore from a backup
            <input type="file" accept="application/json,.json" class="visually-hidden" data-restore />
          </label>
        </div>
        ${message ? html`<div class="all-good" role="status">${message}</div>` : ''}
        <h3 style="margin-bottom:12px">Apartment complexes (${state.complexes.length})</h3>
        ${state.complexes.length
          ? html`<ul class="place-list">${[...state.complexes].sort((a, b) => a.name.localeCompare(b.name)).map(
              (c) => html`<li>
                <span><strong>${c.name}</strong><br /><span class="muted small">${c.addresses.map((a) => a.street).join(' · ')} — ${plural(c.buildings.length, 'building')}, ${plural(c.rules.length, 'rule')}</span></span>
                <span style="display:flex;gap:8px"><button class="btn btn-outline btn-small" data-edit="${c.id}">Edit</button><button class="link-btn" data-delete-complex="${c.id}">Delete</button></span>
              </li>`,
            )}</ul>`
          : html`<p class="muted">None yet. When a complex shows up in a week's file, you'll be asked to set it up.</p>`}
        <h3 style="margin:28px 0 12px">House pins (${state.pins.length})</h3>
        ${state.pins.length
          ? html`<ul class="place-list">${state.pins.map(
              (p) => html`<li>
                <span><strong>${p.street}</strong><br /><span class="muted small">${[p.city, p.zip].filter(Boolean).join(' ')}${p.note ? ` · ${p.note}` : ''}</span></span>
                <span style="display:flex;gap:8px"><button class="btn btn-outline btn-small" data-move="${p.id}">Move</button><button class="link-btn" data-delete-pin="${p.id}">Delete</button></span>
              </li>`,
            )}</ul>`
          : html`<p class="muted">None yet. Use “Pin exact spot” on any stop for hard-to-find houses.</p>`}`,
    );
    m.body.querySelector('[data-restore]').addEventListener('change', onRestore);
  };

  async function onRestore(e) {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const result = await restoreBackup(JSON.parse(await file.text()));
      await app.reloadPlaces();
      draw(`Restored ${plural(result.complexes, 'complex', 'complexes')} and ${plural(result.pins, 'pin')}. Anything newer on this computer was kept.`);
    } catch (err) {
      draw();
      m.body.insertAdjacentHTML('afterbegin', html`<div class="error-box" role="alert"><strong>Couldn't restore.</strong> ${err instanceof SyntaxError ? 'This file is not a backup.' : err.message}</div>`.__html);
    }
  }

  m.body.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if ('backup' in t.dataset) {
      await downloadBackup();
      toast('Backup downloaded. Keep it somewhere safe, like a shared drive.');
    } else if (t.dataset.edit) {
      m.close();
      openComplexSetup(app, { complexId: t.dataset.edit });
    } else if (t.dataset.move) {
      m.close();
      openPinMap(app, null, state.pins.find((p) => p.id === t.dataset.move));
    } else if (t.dataset.deleteComplex) {
      const c = state.complexes.find((x) => x.id === t.dataset.deleteComplex);
      if (!confirm(`Delete ${c.name} and all its building pins? Its households will go to the main address until you set it up again.`)) return;
      await remove('complexes', c.id);
      await app.reloadPlaces();
      await app.noteChange();
      draw(`Deleted ${c.name}.`);
    } else if (t.dataset.deletePin) {
      const p = state.pins.find((x) => x.id === t.dataset.deletePin);
      if (!confirm(`Delete the pin for ${p.street}?`)) return;
      await remove('pins', p.id);
      await app.reloadPlaces();
      await app.noteChange();
      draw(`Deleted the pin for ${p.street}.`);
    }
  });

  draw();
  if (action === 'backup') m.body.querySelector('[data-backup]').focus();
  if (action === 'restore') m.body.querySelector('[data-restore]').click();
}
