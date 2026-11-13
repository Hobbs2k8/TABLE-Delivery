// Driver check-in page (driver.html). Opened by scanning the "Check in"
// QR code on a route sheet. The route is in the link's #fragment, which the
// browser never sends to the web host. Taps are saved on the phone first,
// then sent to TABLE's Google Sheet (see apps-script/Code.gs), retrying
// until they get through.

import '@fontsource-variable/nunito-sans';
import '../styles/tokens.css';
import './driver.css';
import { decodePayload, stopsFromPayload, navigateUrl, makeEvent, stopStatuses, PROBLEM_REASONS } from '../lib/checkin.js';
import * as outbox from './outbox.js';

const app = document.getElementById('app');
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const payload = decodePayload(location.hash.slice(1));
let stops = [];
let events = [];
let queue = [];
let sending = false;
let lastError = '';
let openProblem = null;

function deviceId() {
  try {
    let id = localStorage.getItem('table-driver-device');
    if (!id) {
      id = Math.random().toString(36).slice(2, 10);
      localStorage.setItem('table-driver-device', id);
    }
    return id;
  } catch {
    return '';
  }
}

const routeEvents = () => events.filter((e) => e.week === payload.w && e.route === payload.r && e.day === payload.d);

async function refresh() {
  try {
    [events, queue] = await Promise.all([outbox.history(), outbox.pending()]);
  } catch {
    /* private window: keep what's in memory */
  }
  render();
}

async function record(type, stop = null, extra = {}) {
  const e = makeEvent(payload, type, stop, { device: deviceId(), ...extra });
  try {
    await outbox.add(e);
  } catch {
    events.push({ ...e, photo: e.photo ? 'yes' : '' });
    queue.push(e);
  }
  await refresh();
  flush();
}

/** Send everything waiting, oldest first. Stops at the first failure and tries again later. */
async function flush() {
  if (sending || !payload?.u) return;
  sending = true;
  try {
    const waiting = (await outbox.pending().catch(() => queue)).sort((a, b) => (a.at < b.at ? -1 : 1));
    for (const e of waiting) {
      const res = await fetch(payload.u, { method: 'POST', body: JSON.stringify({ action: 'checkin', key: payload.k, event: e }) });
      const body = await res.json().catch(() => null);
      if (!body?.ok) {
        lastError = body?.error === 'bad key' ? 'TABLE’s check-in sheet did not accept this route. Tell the coordinator.' : 'Could not reach TABLE’s sheet. Will keep trying.';
        break;
      }
      lastError = '';
      await outbox.sent(e.id).catch(() => {
        queue = queue.filter((q) => q.id !== e.id);
      });
    }
  } catch {
    lastError = navigator.onLine === false ? '' : 'Could not reach TABLE’s sheet. Will keep trying.';
  } finally {
    sending = false;
    refresh();
  }
}

/** Shrink a camera photo to at most 1024px on the long side, as JPEG base64 (about 100–200 KB). */
async function shrinkPhoto(file) {
  const img = await createImageBitmap(file);
  const scale = Math.min(1, 1024 / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.6).split(',')[1];
}

function statusLine() {
  if (!payload.u) return '<p class="d-sync warn">Check-ins are only saved on this phone (no TABLE sheet set up).</p>';
  const n = queue.length;
  if (!n) return '<p class="d-sync ok">All check-ins sent to TABLE.</p>';
  const offline = navigator.onLine === false;
  return `<p class="d-sync warn">${n} check-in${n === 1 ? '' : 's'} waiting to send${offline ? ' (no signal)' : ''}. They send by themselves. Keep this page open when you get signal.${lastError ? `<br>${esc(lastError)}` : ''}</p>`;
}

function stopCard(s, st) {
  const photoCount = routeEvents().filter((e) => e.type === 'photo' && e.stop === s.number).length;
  const where = [s.unit && `Apt ${esc(s.unit)}`, s.building && esc(/^[A-Z0-9-]{1,4}$/i.test(s.building) ? `Bldg ${s.building}` : s.building)].filter(Boolean).join(' · ');
  const badge = st?.status === 'delivered' ? '<span class="d-badge ok">Delivered</span>' : st?.status === 'problem' ? `<span class="d-badge warn">Problem: ${esc(st.reason)}</span>` : '';
  const problemForm =
    openProblem === String(s.number)
      ? `<form class="d-problem" data-problem-form="${s.number}">
          <fieldset><legend>What happened?</legend>
            ${PROBLEM_REASONS.map((r, i) => `<label><input type="radio" name="reason" value="${esc(r)}" ${i === 0 ? 'checked' : ''}> ${esc(r)}</label>`).join('')}
          </fieldset>
          <label class="d-note">Note (optional)<input name="note" maxlength="300" autocomplete="off"></label>
          <div class="d-row"><button class="d-btn primary" type="submit">Save</button><button class="d-btn" type="button" data-cancel>Cancel</button></div>
        </form>`
      : '';
  return `<li class="d-stop ${st?.status || ''}" id="stop-${s.number}">
    <div class="d-stop-head">
      <span class="d-num">${esc(s.number)}</span>
      <div class="d-addr"><strong>${esc(s.street)}</strong>${where ? `<div class="d-where">${where}</div>` : ''}<div class="d-muted">${esc(s.city)}${s.bags !== '' ? ` · ${esc(s.bags)} bag${s.bags == 1 ? '' : 's'}` : ''}</div></div>
      ${badge}
    </div>
    <div class="d-actions">
      <button class="d-btn ${st?.status === 'delivered' ? '' : 'primary'}" data-delivered="${s.number}">${st?.status === 'delivered' ? 'Delivered ✓' : 'Delivered'}</button>
      <button class="d-btn" data-problem="${s.number}">Problem</button>
      <label class="d-btn">${photoCount ? `Photo ✓${photoCount > 1 ? ` (${photoCount})` : ''}` : 'Photo'}<input type="file" accept="image/*" capture="environment" data-photo="${s.number}" hidden></label>
      <a class="d-btn" href="${esc(navigateUrl(s.destination))}" target="_blank" rel="noopener noreferrer">Directions</a>
    </div>
    ${problemForm}
  </li>`;
}

function render() {
  if (!payload) {
    app.innerHTML = `<div class="d-card"><h1>This link doesn’t work</h1><p>Scan the <strong>Check in</strong> QR code on your printed route sheet again. If it still doesn’t open, ask the coordinator for a new sheet.</p></div>`;
    return;
  }
  const evs = routeEvents();
  const statuses = stopStatuses(evs);
  const started = evs.find((e) => e.type === 'start');
  const finished = evs.find((e) => e.type === 'finish');
  const done = stops.filter((s) => statuses.has(s.number)).length;
  const bags = stops.reduce((n, s) => n + (Number(s.bags) || 0), 0);
  app.innerHTML = `
    <header class="d-head">
      <p class="d-muted">TABLE deliveries${payload.d ? ` · ${esc(payload.d)}` : ''}</p>
      <h1>${esc(payload.r)}</h1>
      <p><strong>${done} of ${stops.length}</strong> stops checked in${bags ? ` · ${bags} bags` : ''}</p>
      <div class="d-progress"><span style="width:${stops.length ? (100 * done) / stops.length : 0}%"></span></div>
      ${statusLine()}
      ${started ? '' : '<button class="d-btn primary big" data-start>Start route</button><p class="d-muted small">Tap when you leave TABLE. It helps TABLE plan route times.</p>'}
    </header>
    <ol class="d-stops">${stops.map((s) => stopCard(s, statuses.get(s.number))).join('')}</ol>
    <footer class="d-foot">
      ${finished ? `<p class="d-sync ok">Route finished. Thank you!</p>` : `<button class="d-btn big" data-finish ${done ? '' : 'disabled'}>Finish route</button>`}
      <p class="d-muted small">Your taps go to TABLE’s own Google Sheet with the time. No app to install, and nothing is shared with anyone else.</p>
    </footer>`;
}

app.addEventListener('click', async (e) => {
  const t = e.target.closest('button');
  if (!t) return;
  if ('start' in t.dataset) record('start');
  else if ('finish' in t.dataset) record('finish');
  else if (t.dataset.delivered) {
    const s = stops.find((x) => String(x.number) === t.dataset.delivered);
    openProblem = null;
    record('delivered', s);
  } else if (t.dataset.problem) {
    openProblem = openProblem === t.dataset.problem ? null : t.dataset.problem;
    render();
  } else if ('cancel' in t.dataset) {
    openProblem = null;
    render();
  }
});

app.addEventListener('submit', (e) => {
  const form = e.target.closest('[data-problem-form]');
  if (!form) return;
  e.preventDefault();
  const s = stops.find((x) => String(x.number) === form.dataset.problemForm);
  const data = new FormData(form);
  openProblem = null;
  record('problem', s, { reason: String(data.get('reason') || 'Other'), note: String(data.get('note') || '').trim() });
});

app.addEventListener('change', async (e) => {
  const input = e.target.closest('[data-photo]');
  if (!input?.files?.[0]) return;
  const s = stops.find((x) => String(x.number) === input.dataset.photo);
  try {
    const photo = await shrinkPhoto(input.files[0]);
    record('photo', s, { photo });
  } catch {
    alert('That photo could not be read. Try again.');
  }
});

if (payload) {
  stops = stopsFromPayload(payload);
  document.title = `${payload.r} · TABLE check-in`;
  outbox.forgetOtherWeeks(payload.w).catch(() => {});
  window.addEventListener('online', flush);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && flush());
  setInterval(flush, 20000);
}
refresh().then(flush);
