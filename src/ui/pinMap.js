// Exact pin for a single house (long driveways, hard-to-find houses).
// No address lookup here: family addresses for houses are never sent anywhere.
// The map opens at the file's coordinates when it has them.

import L from 'leaflet';
import { state } from '../state.js';
import { put, remove, newId } from '../store/db.js';
import { addressKey } from '../lib/address.js';
import { satelliteLayer, streetLayer } from '../services/tiles.js';
import { html, raw, mount, icons, openModal, toast } from './dom.js';

const ORANGE_COUNTY = { lat: 36.06, lng: -79.1 };

export function openPinMap(app, stop, existingPin = null) {
  const key = existingPin?.key || addressKey(stop);
  const pin = existingPin || state.pins.find((p) => p.key === key) || null;
  const where = pin || stop;
  const start = pin ? { lat: pin.lat, lng: pin.lng } : stop?.lat != null ? { lat: stop.lat, lng: stop.lng } : null;

  const m = openModal({ title: `Pin exact spot · ${where.street}`, wide: true });
  mount(
    m.body,
    html`
      <p class="muted" style="margin-bottom:12px">${start ? 'Drag the pin to the driveway or front door. You can also click the map to move it.' : "Zoom in to the house, then click the map where drivers should stop. Switch to Streets to find the road."}</p>
      <div style="position:relative">
        <div id="pmap" style="height:min(56vh,520px);border-radius:var(--r-md);overflow:hidden"></div>
        <div class="map-toolbar" style="left:56px">
          <div class="seg" role="group" aria-label="Map style">
            <button aria-pressed="true" data-layer="sat">Satellite</button>
            <button aria-pressed="false" data-layer="street">Streets</button>
          </div>
        </div>
      </div>
      <label class="field" style="margin-top:16px"><span>Note for drivers (optional)</span><input data-note value="${pin?.note || ''}" placeholder="Long gravel drive, blue mailbox" /></label>
      <p class="field-error" data-err role="alert"></p>
      <div style="display:flex;justify-content:space-between;gap:12px;margin-top:16px;flex-wrap:wrap">
        ${pin ? html`<button class="link-btn" data-remove>Remove pin</button>` : html`<span></span>`}
        <span style="display:flex;gap:12px"><button class="link-btn" data-cancel>Cancel</button><button class="btn btn-primary" data-save>${raw(icons.pin)} Save pin</button></span>
      </div>`,
  );

  const center = start || ORANGE_COUNTY;
  const map = L.map(m.body.querySelector('#pmap'), { maxZoom: 21 }).setView([center.lat, center.lng], start ? 19 : 11);
  const sat = satelliteLayer().addTo(map);
  const street = streetLayer();
  let marker = null;
  const place = (latlng) => {
    if (marker) marker.setLatLng(latlng);
    else {
      marker = L.marker(latlng, { draggable: true, icon: L.divIcon({ className: '', iconSize: null, html: '<div class="pin-dot"></div>' }), title: 'House pin' }).addTo(map);
    }
  };
  if (start) place([start.lat, start.lng]);
  map.on('click', (e) => place(e.latlng));
  setTimeout(() => map.invalidateSize(), 50);

  m.body.querySelectorAll('[data-layer]').forEach((b) =>
    b.addEventListener('click', () => {
      if (b.dataset.layer === 'sat') {
        map.removeLayer(street);
        sat.addTo(map);
      } else {
        map.removeLayer(sat);
        street.addTo(map);
      }
      m.body.querySelectorAll('[data-layer]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    }),
  );

  m.body.querySelector('[data-cancel]').onclick = m.close;
  m.body.querySelector('[data-save]').onclick = async () => {
    if (!marker) {
      m.body.querySelector('[data-err]').textContent = 'Click the map where drivers should stop first.';
      return;
    }
    const p = marker.getLatLng();
    const record = {
      ...(pin || { id: newId('p_'), key, street: where.street, city: where.city, state: where.state, zip: where.zip }),
      lat: p.lat,
      lng: p.lng,
      note: m.body.querySelector('[data-note]').value.trim(),
    };
    await put('pins', record);
    m.close();
    await app.reloadPlaces();
    await app.noteChange();
    toast(`Saved the pin for ${record.street}. Drivers will go straight there.`);
  };
  m.body.querySelector('[data-remove]')?.addEventListener('click', async () => {
    await remove('pins', pin.id);
    m.close();
    await app.reloadPlaces();
    await app.noteChange();
    toast(`Removed the pin for ${pin.street}.`);
  });
}
