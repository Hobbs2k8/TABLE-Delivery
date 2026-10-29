// One driver sheet: header, QR codes, numbered stop table.
// Same markup on screen (Review) and on paper (print.css hides the tools).

import QRCode from 'qrcode';
import { html, raw, icons, plural } from './dom.js';

const qrCache = new Map();

/** SVG QR code for a link. Low error correction keeps codes less dense, which scans better from paper. */
export async function qrSvg(url) {
  if (!qrCache.has(url)) {
    qrCache.set(url, await QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'L', margin: 2, color: { dark: '#000000', light: '#ffffff' } }));
  }
  return qrCache.get(url);
}

export async function prepareQrs(routes) {
  await Promise.all(routes.flatMap((r) => r.links.map((l) => qrSvg(l.url))));
}

/** Text for texting a driver. */
export function routeMessage(route) {
  const lines = [`Route ${route.id}${route.driver ? ` (${route.driver})` : ''}: ${plural(route.households, 'stop')}, ${plural(route.bags, 'bag')}`];
  for (const l of route.links) lines.push(`${l.label}: ${l.url}`);
  return lines.join('\n');
}

/** "C" or "400" alone is unclear on paper; show "Bldg C". Longer labels print as typed. */
export const buildingText = (label) => (/^[A-Z0-9-]{1,4}$/i.test(label.trim()) ? `Bldg ${label.trim()}` : label);

function aptCell(s) {
  const parts = [];
  if (s.unit) parts.push(html`<span class="apt">Apt ${s.unit}</span>`);
  if (s.place.kind === 'building' && s.place.label) parts.push(html`<div><span class="bldg">${buildingText(s.place.label)}</span></div>`);
  return parts;
}

function warning(s) {
  if (s.place.status === 'not-set-up') {
    return html`<p class="stop-warn screen-only">${raw(icons.alert)} Goes to the main entrance: buildings not set up</p>
      <div class="stop-tools"><button class="link-btn" data-setup-key="${s.key}">Set up buildings</button><button class="link-btn" data-pin-stop="${s.id}">Not an apartment? Pin this house</button></div>`;
  }
  if (s.place.status === 'unmatched') {
    return html`<p class="stop-warn screen-only">${raw(icons.alert)} ${s.unit ? `Unit ${s.unit}` : 'No unit given'}: no building yet, goes to the main entrance</p>
      <div class="stop-tools"><button class="link-btn" data-edit-complex="${s.place.complexId}" data-unit="${s.unit}">Add to a building</button></div>`;
  }
  if (s.place.conflict) {
    return html`<p class="stop-warn screen-only">${raw(icons.alert)} Two rules match this unit</p>
      <div class="stop-tools"><button class="link-btn" data-edit-complex="${s.place.complexId}" data-unit="${s.unit}">Fix in complex</button></div>`;
  }
  if (s.place.kind === 'address') return html`<div class="stop-tools"><button class="link-btn" data-pin-stop="${s.id}">Pin exact spot</button></div>`;
  if (s.place.kind === 'pin') return html`<div class="stop-tools"><span class="badge badge-plain">${raw(icons.pin)} Exact pin</span><button class="link-btn" data-pin-stop="${s.id}">Move pin</button></div>`;
  return '';
}

export function renderSheet(route, { mode = 'screen' } = {}) {
  let prevBuilding = null;
  const rows = route.stops.map((s) => {
    const b = s.place.buildingId || null;
    const groupStart = b && b !== prevBuilding && s.number > 1;
    prevBuilding = b;
    const notes = [s.place.note, s.notes].filter(Boolean);
    return html`
      <tr class="${groupStart ? 'group-start' : ''}">
        <td class="stop-num">${s.number}</td>
        <td>
          <div class="addr">${s.street}</div>
          <div class="muted small">${[s.city, s.zip].filter(Boolean).join(' ')}</div>
          ${notes.map((n) => html`<p class="stop-note">${n}</p>`)}
          ${mode === 'screen' ? warning(s) : ''}
        </td>
        <td>${aptCell(s)}</td>
        <td>${s.name}</td>
        <td class="small" style="white-space:nowrap">${s.phone}</td>
        <td class="col-bags">${s.bags ?? ''}</td>
        <td class="col-check"><span class="check" aria-label="Delivered checkbox"></span></td>
      </tr>`;
  });

  const qrs = route.links.map(
    (l) => html`
      <div class="qr-card">
        ${raw(qrCache.get(l.url) || '<div style="width:152px;height:152px"></div>')}
        <a href="${l.url}" target="_blank" rel="noopener noreferrer">${l.label}</a>
      </div>`,
  );

  return html`
    <article class="sheet" aria-label="Route ${route.id}">
      <div class="sheet-head">
        <div>
          <div class="sheet-title">Route ${route.id}</div>
          <div class="sheet-facts">
            <span>Driver: <strong>${route.driver || '________________'}</strong></span>
            <span><strong>${route.households}</strong> stops</span>
            ${route.hasBags ? html`<span><strong>${route.bags}</strong> bags</span>` : ''}
          </div>
        </div>
        ${mode === 'screen'
          ? html`<div class="sheet-actions">
              <button class="btn btn-outline btn-small btn-pill" data-copy-route="${route.id}">${raw(icons.copy)} Copy link</button>
              <a class="btn btn-outline btn-small btn-pill" href="${route.links[0]?.url || '#'}" target="_blank" rel="noopener noreferrer">${raw(icons.link)} Open in Google Maps</a>
            </div>`
          : ''}
      </div>
      <div class="qr-row">
        ${qrs}
        <p class="qr-help">Scan with your phone camera. It opens Google Maps with your stops in order. ${route.links.length > 1 ? 'When you finish one part, scan the next.' : ''} Apartment stops go straight to the right building.</p>
      </div>
      <table class="stops">
        <thead><tr><th>#</th><th>Address</th><th>Apt / Building</th><th>Household</th><th>Phone</th><th class="col-bags">Bags</th><th class="col-check">✓</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </article>`;
}
