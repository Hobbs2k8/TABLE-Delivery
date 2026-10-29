// Step 1: upload the weekly file. If its columns match a mapping we saved
// before, skip straight to Review.

import { state, recompute } from '../state.js';
import { readRouteFile } from '../lib/parse.js';
import { detectColumns, headerSignature, mappingFits, rowsToStops } from '../lib/columns.js';
import { getSetting, setSetting } from '../store/db.js';
import { html, raw, mount, icons, toast, plural } from './dom.js';

let lastError = '';

export function renderUpload(main, app) {
  mount(
    main,
    html`
      <div class="narrow">
        <h1 class="page-title">Upload this week's route file</h1>
        <p class="page-sub">Use the Routific export or the Monday spreadsheet. Excel or CSV both work.</p>

        <label class="dropzone" id="dropzone">
          ${raw(icons.doc)}
          <h2>Drag your file here</h2>
          <p class="muted">or</p>
          <span class="btn btn-outline">Choose a file</span>
          <input type="file" id="file-input" class="visually-hidden" accept=".csv,.xlsx,.xls,.xlsm,.ods,text/csv" />
        </label>
        <div id="upload-status" role="status" aria-live="polite"></div>
        ${lastError ? html`<div class="error-box" role="alert"><strong>We couldn't use that file.</strong> ${lastError}</div>` : ''}

        <div class="privacy-note">
          ${raw(icons.lock)}
          <p><strong>Family information stays on this computer.</strong> Names, phone numbers and apartment numbers are never uploaded anywhere. Only apartment complex street addresses are looked up on the map.</p>
        </div>
        <p class="last-week muted" id="last-week"></p>
        <p style="margin-top:8px"><button class="link-btn" id="sample">No file handy? Try it with made-up sample data</button></p>
      </div>`,
  );

  getSetting('lastUpload').then((last) => {
    if (last) main.querySelector('#last-week').textContent = `Last upload: ${last.fileName} · ${plural(last.routes, 'route')} · ${plural(last.stops, 'stop')} · ${new Date(last.at).toLocaleDateString()}`;
  }).catch(() => {});

  const zone = main.querySelector('#dropzone');
  const input = main.querySelector('#file-input');
  input.addEventListener('change', () => input.files[0] && handleFile(input.files[0], app));
  ['dragenter', 'dragover'].forEach((t) => zone.addEventListener(t, (e) => (e.preventDefault(), zone.classList.add('dragging'))));
  ['dragleave', 'drop'].forEach((t) => zone.addEventListener(t, () => zone.classList.remove('dragging')));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f, app);
  });
  main.querySelector('#sample').addEventListener('click', async () => {
    const res = await fetch(`${import.meta.env.BASE_URL}sample-week.csv`);
    const blob = await res.blob();
    handleFile(new File([blob], 'sample-week.csv', { type: 'text/csv' }), app);
  });

  return { next: { label: 'Next', disabled: true }, hint: 'Upload a file to continue' };
}

async function handleFile(file, app) {
  const status = document.getElementById('upload-status');
  if (status) status.textContent = `Reading ${file.name}…`;
  lastError = '';
  try {
    const { headers, rows } = await readRouteFile(file);
    if (!rows.length) throw new Error('The file has no rows under the headings. Check that you exported the right sheet.');
    state.fileName = file.name;
    state.headers = headers;
    state.rows = rows;

    const saved = (await getSetting('mappings', {}).catch(() => ({}))) || {};
    const remembered = saved[headerSignature(headers)];
    if (remembered && mappingFits(remembered, headers)) {
      state.mapping = remembered;
      await loadStops(app);
      toast('Columns match last time, so we skipped that step.');
      app.go('review');
    } else {
      state.mapping = detectColumns(headers);
      app.go('mapping');
    }
  } catch (e) {
    lastError = e.message || String(e);
    app.render();
  }
}

/** Turn rows into stops with the current mapping, then remember the upload. */
export async function loadStops(app) {
  const { stops, skipped } = rowsToStops(state.rows, state.mapping);
  state.baseStops = stops;
  state.skipped = skipped;
  state.selectedRoute = null;
  recompute();
  setSetting('lastUpload', { fileName: state.fileName, routes: state.routes.length, stops: stops.length, at: new Date().toISOString() }).catch(() => {});
}
