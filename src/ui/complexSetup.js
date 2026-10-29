// Apartment complex setup: done once per complex.
//   1. Mark buildings on a satellite map (click an OpenStreetMap outline or drop a pin)
//   2. Say which units are in which building, with simple rules
//   3. Check the live preview of this week's units, then save
// Optional: extra street addresses, per-building driver notes, the complex's own site map.

import L from 'leaflet';
import { state } from '../state.js';
import { put, newId } from '../store/db.js';
import { addressKey } from '../lib/address.js';
import { suggestRelatedAddresses, previewUnits, indexComplexes } from '../lib/complexes.js';
import { describeRule, validateRule } from '../lib/unitRules.js';
import { findAddress } from '../services/geocode.js';
import { loadBuildings } from '../services/buildings.js';
import { satelliteLayer, streetLayer, OSM_DATA_ATTRIBUTION } from '../services/tiles.js';
import { html, raw, mount, icons, esc, plural, openOverlay, toast } from './dom.js';

const ORANGE_COUNTY = { lat: 36.06, lng: -79.1 };

const RULE_TYPES = [
  { type: 'range', label: 'A range of units (101 to 124)' },
  { type: 'startsWith', label: 'Units that start with… (2 → 201, 2B)' },
  { type: 'endsWith', label: 'Units that end with… (B → 4B, 11B)' },
  { type: 'pattern', label: 'Units that look like… (1xx)' },
  { type: 'unit', label: 'One unit' },
  { type: 'rest', label: 'Every other unit' },
];

function newDraft(candidate) {
  return {
    id: newId('c_'),
    name: candidate.street,
    addresses: [{ key: candidate.key, street: candidate.street, city: candidate.city, state: candidate.state, zip: candidate.zip }],
    center: null,
    buildings: [],
    rules: [],
    siteMap: null,
  };
}

/** Every distinct address in this week's data, for "also part of this complex?" suggestions. */
function weekAddresses(excludeComplexId) {
  const taken = indexComplexes(state.complexes.filter((c) => c.id !== excludeComplexId));
  const seen = new Map();
  for (const s of state.stops) if (s.key && !taken.has(s.key) && !seen.has(s.key)) seen.set(s.key, { key: s.key, street: s.street, city: s.city, state: s.state, zip: s.zip });
  return [...seen.values()];
}

async function findCenter(draft, candidate) {
  if (draft.center) return { point: draft.center };
  if (candidate?.lat != null) return { point: { lat: candidate.lat, lng: candidate.lng } };
  const keys = new Set(draft.addresses.map((a) => a.key));
  const s = state.stops.find((x) => keys.has(x.key) && x.lat != null);
  if (s) return { point: { lat: s.lat, lng: s.lng } };
  try {
    const a = draft.addresses[0];
    const p = await findAddress({ street: a.street, city: a.city, state: a.state, zip: a.zip });
    if (p) return { point: p };
    return { point: ORANGE_COUNTY, message: "We couldn't find this address on the map. Drag and zoom to the complex, then mark its buildings." };
  } catch (e) {
    return { point: ORANGE_COUNTY, message: `${e.message} Drag and zoom to the complex instead.` };
  }
}

async function resizeImage(file, max = 1600) {
  const img = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.85);
}

export async function openComplexSetup(app, { candidate, complexId, focusUnit } = {}) {
  const existing = complexId ? state.complexes.find((c) => c.id === complexId) : null;
  if (complexId && !existing) return toast('That complex was deleted.');
  const draft = existing ? structuredClone(existing) : newDraft(candidate);

  let dirty = false;
  let saving = false;
  let selected = null; // building id
  let dropMode = false;
  let ruleType = 'range';
  let quickUnit = focusUnit ?? null;
  let showSiteMap = false;
  const touch = () => (dirty = true);

  const ov = openOverlay({
    title: existing ? `Edit ${draft.name}` : `Set up ${draft.name}`,
    onClose: () => saving || !dirty || confirm('Leave without saving? The buildings and rules you added will be lost.'),
  });

  mount(
    ov.body,
    html`
      <div class="setup">
        <div class="setup-map-wrap">
          <div class="setup-map" id="cmap" aria-label="Satellite map of the complex"></div>
          <div class="map-toolbar">
            <div class="seg" role="group" aria-label="Map style">
              <button aria-pressed="true" data-layer="sat">Satellite</button>
              <button aria-pressed="false" data-layer="street">Streets</button>
            </div>
            <button class="btn btn-small btn-pill" style="background:var(--surface);box-shadow:var(--shadow-md)" data-drop aria-pressed="false">${raw(icons.pin)} Drop a pin</button>
            <button class="btn btn-small btn-pill" style="background:var(--surface);box-shadow:var(--shadow-md)" data-sitemap-toggle hidden>${raw(icons.image)} Site map</button>
            <span class="map-hint" id="map-status" role="status">Loading map…</span>
            <button class="btn btn-small btn-pill" style="background:var(--surface);box-shadow:var(--shadow-md)" data-retry hidden>Try again</button>
          </div>
          <div class="sitemap-pane" id="sitemap-pane" hidden></div>
        </div>
        <div class="setup-side" id="side"></div>
      </div>`,
  );

  // ---------- Map ----------
  const map = L.map(ov.body.querySelector('#cmap'), { zoomControl: true, maxZoom: 21 }).setView([ORANGE_COUNTY.lat, ORANGE_COUNTY.lng], 12);
  const sat = satelliteLayer().addTo(map);
  const street = streetLayer();
  map.attributionControl.addAttribution(OSM_DATA_ATTRIBUTION);
  const outlineLayer = L.layerGroup().addTo(map);
  const markerLayer = L.layerGroup().addTo(map);
  const status = (msg) => (ov.body.querySelector('#map-status').textContent = msg);
  let osmBuildings = [];

  ov.body.querySelectorAll('[data-layer]').forEach((b) =>
    b.addEventListener('click', () => {
      const useSat = b.dataset.layer === 'sat';
      if (useSat) {
        map.removeLayer(street);
        sat.addTo(map);
      } else {
        map.removeLayer(sat);
        street.addTo(map);
      }
      ov.body.querySelectorAll('[data-layer]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    }),
  );

  const dropBtn = ov.body.querySelector('[data-drop]');
  const setDrop = (on) => {
    dropMode = on;
    dropBtn.setAttribute('aria-pressed', String(on));
    dropBtn.style.background = on ? 'var(--primary)' : 'var(--surface)';
    dropBtn.style.color = on ? 'var(--primary-text)' : '';
    map.getContainer().style.cursor = on ? 'crosshair' : '';
    if (on) status('Click the map where drivers should stop for this building.');
  };
  dropBtn.addEventListener('click', () => setDrop(!dropMode));

  map.on('click', (e) => {
    if (!dropMode) return;
    addBuilding({ lat: e.latlng.lat, lng: e.latlng.lng });
    setDrop(false);
  });

  function nextLabel() {
    let n = draft.buildings.length + 1;
    while (draft.buildings.some((b) => b.label === `Building ${n}`)) n++;
    return `Building ${n}`;
  }

  function addBuilding({ lat, lng, label, osmId = null }) {
    const b = { id: newId('b_'), label: label || nextLabel(), lat, lng, note: '', osmId };
    draft.buildings.push(b);
    selected = b.id;
    touch();
    drawMap();
    drawSide();
    status(`Added ${b.label}. Drag its label to where drivers should park.`);
    ov.body.querySelector(`[data-bid="${b.id}"] [data-label]`)?.select();
  }

  function drawMap() {
    outlineLayer.clearLayers();
    const used = new Set(draft.buildings.map((b) => b.osmId).filter(Boolean));
    for (const f of osmBuildings) {
      const taken = used.has(f.osmId);
      const poly = L.polygon(f.outline, {
        color: taken ? '#e0435a' : '#ffffff',
        weight: 2,
        fillColor: taken ? '#e0435a' : '#ffffff',
        fillOpacity: taken ? 0.25 : 0.12,
      }).addTo(outlineLayer);
      if (f.label) poly.bindTooltip(f.label, { direction: 'center', className: 'osm-tip' });
      poly.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        const b = draft.buildings.find((x) => x.osmId === f.osmId);
        if (b) {
          selected = b.id;
          drawMap();
          drawSide();
          return;
        }
        addBuilding({ lat: f.center.lat, lng: f.center.lng, label: f.label || '', osmId: f.osmId });
      });
    }
    markerLayer.clearLayers();
    for (const b of draft.buildings) {
      const m = L.marker([b.lat, b.lng], {
        draggable: true,
        title: b.label,
        alt: b.label,
        icon: L.divIcon({ className: '', iconSize: null, html: `<span class="pill-marker ${b.id === selected ? 'active' : ''}">${esc(b.label)}</span>` }),
        zIndexOffset: b.id === selected ? 1000 : 0,
      }).addTo(markerLayer);
      m.on('dragend', () => {
        const p = m.getLatLng();
        b.lat = p.lat;
        b.lng = p.lng;
        touch();
        status(`Moved ${b.label}.`);
      });
      m.on('click', () => {
        selected = b.id;
        drawMap();
        drawSide();
      });
    }
  }

  // ---------- Side panel ----------
  function ruleInputs() {
    switch (ruleType) {
      case 'range': return html`<input class="input-plain" data-r="from" placeholder="From (101)" aria-label="From unit" /> <span>to</span> <input class="input-plain" data-r="to" placeholder="To (124)" aria-label="To unit" />`;
      case 'startsWith': return html`<input class="input-plain" data-r="value" placeholder="Starts with (2)" aria-label="Starts with" />`;
      case 'endsWith': return html`<input class="input-plain" data-r="value" placeholder="Ends with (B)" aria-label="Ends with" />`;
      case 'pattern': return html`<input class="input-plain" data-r="value" placeholder="Looks like (1xx)" aria-label="Pattern" /><span class="muted small">x = any digit</span>`;
      case 'unit': return html`<input class="input-plain" data-r="unit" placeholder="Unit (7)" aria-label="Unit" />`;
      default: return html`<span class="muted small">Any unit that no other rule covers.</span>`;
    }
  }

  const buildingName = (id) => draft.buildings.find((b) => b.id === id)?.label || '(removed building)';

  function drawSide() {
    const preview = previewUnits(draft, state.stops);
    const placed = preview.filter((p) => p.buildingId);
    const unplaced = preview.filter((p) => !p.buildingId);
    const householdsPlaced = placed.reduce((n, p) => n + p.households, 0);
    const householdsTotal = preview.reduce((n, p) => n + p.households, 0);
    const keys = new Set(draft.addresses.map((a) => a.key));
    const suggestions = suggestRelatedAddresses(draft.addresses[0], weekAddresses(draft.id)).filter((s) => !keys.has(s.key));
    const buildingOptions = (sel) => draft.buildings.map((b) => html`<option value="${b.id}" ${b.id === sel ? raw('selected') : ''}>${b.label}</option>`);

    mount(
      ov.body.querySelector('#side'),
      html`
        <section class="setup-section">
          <label class="field"><span>Complex name</span><input data-name value="${draft.name}" /></label>
          <div class="addr-list" style="margin-top:12px">
            <p class="small muted">Street addresses for this complex:</p>
            ${draft.addresses.map(
              (a, i) => html`<div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><span><strong>${a.street}</strong> <span class="muted small">${a.zip}</span></span>${i > 0 ? html`<button class="link-btn small" data-remove-addr="${a.key}">Remove</button>` : ''}</div>`,
            )}
            ${suggestions.length
              ? html`<p class="small" style="margin-top:6px"><strong>Also part of this complex?</strong></p>
                ${suggestions.map((s) => html`<label><input type="checkbox" data-add-addr="${s.key}" /> ${s.street}</label>`)}`
              : ''}
            <details class="more"><summary style="padding:6px 0;font-size:var(--fs-sm)">Add another street address</summary>
              <div style="display:flex;gap:8px"><input class="input-plain" data-new-addr placeholder="402 Sycamore Ln" aria-label="Street address" /><button class="btn btn-outline btn-small" data-add-new-addr>Add</button></div>
            </details>
          </div>
        </section>

        <section class="setup-section">
          <h3><span class="n">1</span> Mark the buildings</h3>
          <p>Click a building's outline on the map, or use <strong>Drop a pin</strong>. Then drag its label to where drivers should park, near the front door.</p>
          ${draft.buildings.length
            ? html`<ul class="bldg-list">${draft.buildings.map(
                (b) => html`<li class="bldg-row ${b.id === selected ? 'active' : ''}" data-bid="${b.id}">
                  <div class="row-top">
                    <input class="input-plain" data-label value="${b.label}" aria-label="Building name" />
                    <button class="icon-btn" data-show="${b.id}" aria-label="Show ${b.label} on map">${raw(icons.pin)}</button>
                    <button class="icon-btn" data-remove-b="${b.id}" aria-label="Remove ${b.label}">${raw(icons.close)}</button>
                  </div>
                  <input class="input-plain" data-note value="${b.note}" placeholder="Note for drivers (optional): Enter from Sycamore Ln side" aria-label="Note for drivers" />
                </li>`,
              )}</ul>`
            : html`<p class="empty" style="padding:16px;border:1px dashed var(--border-strong);border-radius:var(--r-md)">No buildings yet. Click one on the map to start.</p>`}
        </section>

        <section class="setup-section" id="rules-section">
          <h3><span class="n">2</span> Say which units are in each building</h3>
          <p>Add a few rules instead of doing every unit by hand. Check the list below to see where each of this week's units will go.</p>
          ${draft.buildings.length
            ? html`<div class="rule-builder">
                <label class="field"><span>Rule</span><select data-rule-type>${RULE_TYPES.map((r) => html`<option value="${r.type}" ${r.type === ruleType ? raw('selected') : ''}>${r.label}</option>`)}</select></label>
                <div class="inputs">${ruleInputs()}</div>
                <label class="field"><span>Goes to building</span><select data-rule-building>${buildingOptions(selected)}</select></label>
                <button class="btn btn-primary btn-small" data-add-rule>Add rule</button>
                <p class="field-error" data-rule-error role="alert"></p>
              </div>`
            : html`<p class="muted small">Mark at least one building first.</p>`}
          ${draft.rules.length
            ? html`<ul class="rule-list" style="margin-top:12px">${draft.rules.map(
                (r) => html`<li><span>${describeRule(r)} → <strong>${buildingName(r.buildingId)}</strong></span><button class="icon-btn" data-remove-rule="${r.id}" aria-label="Remove rule: ${describeRule(r)}">${raw(icons.close)}</button></li>`,
              )}</ul>`
            : ''}
        </section>

        <section class="setup-section" id="preview-section">
          <h3><span class="n">3</span> Check this week's units</h3>
          ${preview.length
            ? html`
              <p class="preview-summary ${unplaced.length ? 'badge-warn' : 'badge-ok'}" style="margin-bottom:14px">
                ${unplaced.length ? `${householdsPlaced} of ${plural(householdsTotal, 'household')} placed. ${plural(unplaced.length, 'unit')} still go to the main address.` : `All ${plural(householdsTotal, 'household')} this week go to their building.`}
              </p>
              ${unplaced.length
                ? html`<div class="preview-group"><h4>${raw(icons.alert)} No building yet: click a unit to place it</h4><div class="preview-chips">${unplaced.map(
                    (p) => html`<button class="chip chip-warn" data-quick="${p.unit}">${p.unit || 'No unit'}${p.households > 1 ? ` ×${p.households}` : ''}</button>`,
                  )}</div></div>`
                : ''}
              ${quickUnit !== null && draft.buildings.length
                ? html`<div class="rule-builder" style="margin-bottom:12px">
                    <p><strong>${quickUnit ? `Unit ${quickUnit}` : 'Households with no unit'}</strong> go to:</p>
                    <div class="inputs"><select class="input-plain" data-quick-building aria-label="Building">${buildingOptions(selected)}</select><button class="btn btn-primary btn-small" data-quick-add>Save</button><button class="link-btn small" data-quick-cancel>Cancel</button></div>
                    ${quickUnit ? '' : html`<p class="muted small">This adds an “every other unit” rule.</p>`}
                  </div>`
                : ''}
              ${draft.buildings.map((b) => {
                const units = placed.filter((p) => p.buildingId === b.id);
                return units.length
                  ? html`<div class="preview-group"><h4>${b.label}</h4><div class="preview-chips">${units.map((p) => html`<span class="chip ${p.conflict ? 'chip-warn' : ''}" title="${p.conflict ? 'Two rules match this unit' : ''}">${p.unit || 'No unit'}${p.conflict ? ' ⚠' : ''}</span>`)}</div></div>`
                  : '';
              })}`
            : html`<p class="muted small">No households at this complex in this week's file. Rules still apply when they show up.</p>`}
        </section>

        <section class="setup-section">
          <h3><span class="n" style="background:var(--border-strong)">+</span> The complex's own site map (optional)</h3>
          <p>If the complex has a map of its buildings, add it here to see it next to the satellite view.</p>
          ${draft.siteMap
            ? html`<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-outline btn-small" data-sitemap-show>${showSiteMap ? 'Hide' : 'Show'} site map</button><button class="link-btn small" data-sitemap-remove>Remove</button></div>`
            : html`<div style="display:grid;gap:8px">
                <div style="display:flex;gap:8px"><input class="input-plain" data-sitemap-url placeholder="Paste a link to the site map" aria-label="Site map link" /><button class="btn btn-outline btn-small" data-sitemap-add>Add</button></div>
                <label class="link-btn small" style="cursor:pointer;justify-self:start">Or upload a picture<input type="file" accept="image/*" class="visually-hidden" data-sitemap-file /></label>
              </div>`}
        </section>`,
    );
    drawFoot(householdsPlaced, householdsTotal);
    drawSiteMap();
  }

  function drawFoot(placed, total) {
    mount(
      ov.foot,
      html`
        <span class="muted small" id="save-msg" role="status">${total ? `${placed} of ${plural(total, 'household')} this week go to their building` : ''}</span>
        <span style="display:flex;gap:12px;align-items:center">
          <button class="link-btn" data-cancel>Cancel</button>
          <button class="btn btn-primary" data-save>Save complex</button>
        </span>`,
    );
    ov.foot.querySelector('[data-cancel]').onclick = ov.close;
    ov.foot.querySelector('[data-save]').onclick = save;
  }

  function drawSiteMap() {
    const pane = ov.body.querySelector('#sitemap-pane');
    const toggle = ov.body.querySelector('[data-sitemap-toggle]');
    toggle.hidden = !draft.siteMap;
    pane.hidden = !(draft.siteMap && showSiteMap);
    if (!draft.siteMap) return;
    const sm = draft.siteMap;
    const isImage = sm.image || /\.(png|jpe?g|gif|webp)(\?|$)/i.test(sm.url || '');
    mount(
      pane,
      html`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><strong>Site map</strong><button class="icon-btn" data-sitemap-close aria-label="Hide site map">${raw(icons.close)}</button></div>
        ${isImage ? html`<img src="${sm.image || sm.url}" alt="Complex site map" />` : ''}
        ${sm.url ? html`<p class="small" style="margin-top:8px"><a href="${sm.url}" target="_blank" rel="noopener noreferrer">Open the site map in a new tab</a></p>` : ''}`,
    );
    pane.querySelector('[data-sitemap-close]').onclick = () => {
      showSiteMap = false;
      drawSide();
      map.invalidateSize();
    };
    setTimeout(() => map.invalidateSize(), 50);
  }

  ov.body.querySelector('[data-sitemap-toggle]').addEventListener('click', () => {
    showSiteMap = !showSiteMap;
    drawSide();
  });

  // ---------- Side panel events ----------
  const side = ov.body.querySelector('#side');
  side.addEventListener('input', (e) => {
    const t = e.target;
    const row = t.closest('[data-bid]');
    if ('name' in t.dataset) {
      draft.name = t.value;
      touch();
    } else if (row && 'label' in t.dataset) {
      draft.buildings.find((b) => b.id === row.dataset.bid).label = t.value;
      touch();
      drawMap();
    } else if (row && 'note' in t.dataset) {
      draft.buildings.find((b) => b.id === row.dataset.bid).note = t.value;
      touch();
    }
  });
  side.addEventListener('change', async (e) => {
    const t = e.target;
    if ('label' in t.dataset) drawSide(); // refresh building names in rules and preview
    if ('ruleType' in t.dataset) {
      ruleType = t.value;
      drawSide();
      side.querySelector('[data-rule-type]').focus();
    }
    if (t.dataset.addAddr) {
      const s = weekAddresses(draft.id).find((x) => x.key === t.dataset.addAddr);
      if (s) draft.addresses.push(s);
      touch();
      drawSide();
    }
    if ('sitemapFile' in t.dataset && t.files[0]) {
      try {
        draft.siteMap = { image: await resizeImage(t.files[0]) };
        showSiteMap = true;
        touch();
        drawSide();
      } catch {
        toast("That picture couldn't be opened. Try a PNG or JPG.");
      }
    }
  });
  side.addEventListener('focusin', (e) => {
    const row = e.target.closest('[data-bid]');
    if (row && row.dataset.bid !== selected) {
      selected = row.dataset.bid;
      side.querySelectorAll('.bldg-row').forEach((r) => r.classList.toggle('active', r === row));
      const sel = side.querySelector('[data-rule-building]');
      if (sel) sel.value = selected;
      drawMap();
    }
  });
  side.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    const d = t.dataset;
    if (d.show) {
      const b = draft.buildings.find((x) => x.id === d.show);
      selected = b.id;
      map.setView([b.lat, b.lng], Math.max(map.getZoom(), 18));
      drawMap();
      drawSide();
    } else if (d.removeB) {
      const b = draft.buildings.find((x) => x.id === d.removeB);
      const used = draft.rules.filter((r) => r.buildingId === b.id).length;
      if (used && !confirm(`Remove ${b.label}? ${plural(used, 'rule')} that point to it will be removed too.`)) return;
      draft.buildings = draft.buildings.filter((x) => x.id !== b.id);
      draft.rules = draft.rules.filter((r) => r.buildingId !== b.id);
      if (selected === b.id) selected = null;
      touch();
      drawMap();
      drawSide();
    } else if ('addRule' in d) {
      const rule = { id: newId('r_'), type: ruleType, buildingId: side.querySelector('[data-rule-building]').value };
      side.querySelectorAll('[data-r]').forEach((i) => (rule[i.dataset.r] = i.value.trim()));
      const err = validateRule(rule);
      if (err) {
        side.querySelector('[data-rule-error]').textContent = err;
        return;
      }
      draft.rules.push(rule);
      touch();
      drawSide();
      side.querySelector('[data-r]')?.focus();
    } else if (d.removeRule) {
      draft.rules = draft.rules.filter((r) => r.id !== d.removeRule);
      touch();
      drawSide();
    } else if (d.quick !== undefined) {
      quickUnit = d.quick;
      drawSide();
      side.querySelector('[data-quick-building]')?.focus();
    } else if ('quickAdd' in d) {
      const buildingId = side.querySelector('[data-quick-building]').value;
      draft.rules.push(quickUnit ? { id: newId('r_'), type: 'unit', unit: quickUnit, buildingId } : { id: newId('r_'), type: 'rest', buildingId });
      quickUnit = null;
      touch();
      drawSide();
    } else if ('quickCancel' in d) {
      quickUnit = null;
      drawSide();
    } else if (d.removeAddr) {
      draft.addresses = draft.addresses.filter((a) => a.key !== d.removeAddr);
      touch();
      drawSide();
    } else if ('addNewAddr' in d) {
      const input = side.querySelector('[data-new-addr]');
      const streetText = input.value.trim();
      if (!streetText) return input.focus();
      const p = draft.addresses[0];
      const a = { street: streetText, city: p.city, state: p.state, zip: p.zip };
      a.key = addressKey(a);
      const owner = state.complexes.find((c) => c.id !== draft.id && c.addresses.some((x) => x.key === a.key));
      if (owner) return toast(`${streetText} already belongs to ${owner.name}.`);
      if (!draft.addresses.some((x) => x.key === a.key)) draft.addresses.push(a);
      touch();
      drawSide();
    } else if ('sitemapAdd' in d) {
      const url = side.querySelector('[data-sitemap-url]').value.trim();
      if (!/^https?:\/\//i.test(url)) return toast('Paste a full link that starts with https://');
      draft.siteMap = { url };
      showSiteMap = true;
      touch();
      drawSide();
    } else if ('sitemapShow' in d) {
      showSiteMap = !showSiteMap;
      drawSide();
    } else if ('sitemapRemove' in d) {
      draft.siteMap = null;
      showSiteMap = false;
      touch();
      drawSide();
      map.invalidateSize();
    }
  });

  async function save() {
    const msg = ov.foot.querySelector('#save-msg');
    if (!draft.name.trim()) {
      msg.textContent = 'Give the complex a name first.';
      return side.querySelector('[data-name]').focus();
    }
    if (!draft.buildings.length) {
      msg.textContent = 'Mark at least one building on the map first.';
      return;
    }
    const c = map.getCenter();
    draft.center = draft.center || { lat: c.lat, lng: c.lng };
    const preview = previewUnits(draft, state.stops);
    const placed = preview.filter((p) => p.buildingId).reduce((n, p) => n + p.households, 0);
    const total = preview.reduce((n, p) => n + p.households, 0);
    try {
      await put('complexes', draft);
    } catch {
      msg.textContent = "Couldn't save. This browser may be blocking storage (private window?).";
      return;
    }
    saving = true;
    ov.close();
    await app.reloadPlaces();
    await app.noteChange();
    toast(`Saved ${draft.name}.${total ? ` ${placed} of ${plural(total, 'household')} now go to their building.` : ''}`);
  }

  // ---------- Start ----------
  drawSide();
  drawMap();
  setTimeout(() => map.invalidateSize(), 50);
  if (focusUnit !== undefined) setTimeout(() => side.querySelector('#preview-section')?.scrollIntoView({ block: 'start' }), 100);

  const { point, message } = await findCenter(draft, candidate);
  if (!draft.center && point !== ORANGE_COUNTY) draft.center = point;
  const fitTo = draft.buildings.length ? L.latLngBounds(draft.buildings.map((b) => [b.lat, b.lng])).pad(0.4) : null;
  if (fitTo && draft.buildings.length > 1) map.fitBounds(fitTo, { maxZoom: 19 });
  else map.setView([point.lat, point.lng], point === ORANGE_COUNTY ? 12 : 18);
  if (message) {
    status(message);
    return;
  }
  const retry = ov.body.querySelector('[data-retry]');
  async function findOutlines() {
    retry.hidden = true;
    status('Finding buildings…');
    try {
      osmBuildings = await loadBuildings(point.lat, point.lng);
      drawMap();
      const named = osmBuildings.filter((b) => b.label).length;
      status(osmBuildings.length ? `Found ${plural(osmBuildings.length, 'building')}${named ? `, ${named} with names or numbers` : ''}. Click one to add it.` : 'No building outlines here. Use Drop a pin to mark buildings.');
    } catch (e) {
      status(e.message);
      retry.hidden = false;
    }
  }
  retry.addEventListener('click', findOutlines);
  findOutlines();
}
