// Step 1b: check which column is which. Shown the first time, or when the
// file's columns change. The answer is remembered for next week.

import { state } from '../state.js';
import { FIELDS, missingRequired, headerSignature } from '../lib/columns.js';
import { getSetting, setSetting } from '../store/db.js';
import { html, raw, mount } from './dom.js';
import { loadStops } from './upload.js';

const MAIN_FIELDS = ['route', 'street', 'unit', 'name'];

function example(header) {
  if (!header) return '';
  const v = state.rows.map((r) => r[header]).find((x) => String(x ?? '').trim());
  return v ? `e.g. ${String(v).slice(0, 40)}` : 'empty in this file';
}

function fieldRow(field) {
  const current = state.mapping[field.key];
  const id = `map-${field.key}`;
  return html`
    <div class="map-row">
      <div>
        <label class="label" for="${id}">${field.label}${field.required ? html` <span class="muted">(needed)</span>` : ''}</label>
        <p class="example" data-example="${field.key}">${example(current)}</p>
      </div>
      <label class="field">
        <span>Column in your file</span>
        <select id="${id}" data-field="${field.key}">
          <option value="">${field.required ? 'Choose a column…' : '— Not in this file —'}</option>
          ${state.headers.map((h) => html`<option value="${h}" ${h === current ? raw('selected') : ''}>${h}</option>`)}
        </select>
      </label>
    </div>`;
}

export function renderMapping(main, app) {
  const missing = missingRequired(state.mapping);
  mount(
    main,
    html`
      <div class="narrow">
        <h1 class="page-title">Check that we read your file correctly</h1>
        <p class="page-sub">We matched the columns in <strong>${state.fileName}</strong>. Fix any that look wrong. We'll remember this for next week.</p>
        <div class="card">
          ${FIELDS.filter((f) => MAIN_FIELDS.includes(f.key)).map(fieldRow)}
          <details class="more">
            <summary>${FIELDS.length - MAIN_FIELDS.length} more columns (city, ZIP, bags, phone…)</summary>
            ${FIELDS.filter((f) => !MAIN_FIELDS.includes(f.key)).map(fieldRow)}
          </details>
        </div>
        ${missing.length ? html`<p class="field-error" role="alert" style="margin-top:16px">Choose the column for ${missing.map((k) => FIELDS.find((f) => f.key === k).label.toLowerCase()).join(' and ')} to continue.</p>` : ''}
      </div>`,
  );

  // If a less common field was auto-matched, open the extra section so it can be checked.
  main.querySelectorAll('select').forEach((sel) =>
    sel.addEventListener('change', () => {
      state.mapping = { ...state.mapping, [sel.dataset.field]: sel.value || null };
      // A column can only be used once.
      for (const [k, v] of Object.entries(state.mapping)) if (k !== sel.dataset.field && v && v === sel.value) state.mapping[k] = null;
      app.render();
      main.querySelector(`#map-${sel.dataset.field}`)?.focus();
      if (!MAIN_FIELDS.includes(sel.dataset.field)) main.querySelector('details.more').open = true;
    }),
  );

  return {
    back: { label: 'Back', onClick: () => app.go('upload') },
    hint: `${state.rows.length} rows found`,
    next: {
      label: 'Use these columns',
      disabled: missing.length > 0,
      onClick: async () => {
        const saved = (await getSetting('mappings', {}).catch(() => ({}))) || {};
        saved[headerSignature(state.headers)] = state.mapping;
        await setSetting('mappings', saved).catch(() => {});
        await loadStops(app);
        app.go('review');
      },
    },
  };
}
