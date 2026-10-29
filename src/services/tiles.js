// Map backgrounds. All free, no keys, with the attribution each one asks for.
//
// - NC OneMap orthoimagery: NC state government, 6-inch aerial photos of
//   all of North Carolina. Sharp enough to see individual buildings.
// - USGS National Map imagery: US government, public domain, coarser.
//   Used automatically outside North Carolina (NC OneMap has no tiles there).
// - OpenStreetMap standard tiles: street names. Light use only, per
//   operations.osmfoundation.org/policies/tiles — fine for one coordinator.

import L from 'leaflet';

export function satelliteLayer() {
  const usgs = L.tileLayer('https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}', {
    maxNativeZoom: 16,
    maxZoom: 21,
    attribution: 'Imagery: <a href="https://www.usgs.gov/programs/national-geospatial-program/national-map">USGS The National Map</a>',
  });
  const nc = L.tileLayer('https://services.nconemap.gov/secure/rest/services/Imagery/Orthoimagery_Latest_cached/ImageServer/tile/{z}/{y}/{x}', {
    maxNativeZoom: 20,
    maxZoom: 21,
    attribution: 'Imagery: <a href="https://www.nconemap.gov/">NC OneMap</a> / NC Center for Geographic Information &amp; Analysis',
  });
  return L.layerGroup([usgs, nc]);
}

export function streetLayer() {
  return L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxNativeZoom: 19,
    maxZoom: 21,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  });
}

/** Building outlines and names come from OSM too. */
export const OSM_DATA_ATTRIBUTION = 'Buildings &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
