# TABLE Route Sheets

A free web app for TABLE's weekly food deliveries (Orange County, NC). The volunteer coordinator uploads the week's route file and gets:

- a printable sheet per route (QR codes, numbered stops, apt + building labels, checkboxes)
- Google Maps links per route for texting drivers (no app to install)
- **apartment building locating**: set up a complex once, and every household in it is routed to the right building every week

No accounts, no server, no API keys. Runs entirely in the browser.

Staff instructions: **[docs/MONDAY-GUIDE.md](docs/MONDAY-GUIDE.md)**.

---

## Privacy rules (read before changing anything)

Family data (names, phones, unit numbers) must **never** leave the browser.

| What leaves the browser | Where | Code |
|---|---|---|
| Complex street address (street, city, state, ZIP), once per complex | OpenStreetMap Nominatim | `src/services/geocode.js` |
| A latitude/longitude, once per complex | Overpass API (OSM buildings) | `src/services/buildings.js` |
| Map tile requests | NC OneMap, USGS, OpenStreetMap | `src/services/tiles.js` |

That's it. Only files in `src/services/` may call `fetch` to another site. The uploaded file is read in memory (`src/state.js`) and never saved. Saved complexes/pins contain street addresses, building pins and unit *rules*, never names.

Driver links contain street addresses or building coordinates (never units or names). Google receives those when a driver opens the link, the same as typing the address into Maps.

## Setup

Needs Node 20+.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (Vitest)
npm run build      # production build in dist/
node scripts/make-sample.mjs   # regenerate the fake sample data
```

Try it with **"Try it with made-up sample data"** on the upload page, or upload `sample-data/monday-macro.xlsx`.

## Deploying (free)

**GitHub Pages (recommended):** push to a GitHub repo, then Settings → Pages → Source: **GitHub Actions**. `.github/workflows/deploy.yml` tests, builds and publishes on every push to `main`.

**Vercel:** import the repo; framework "Vite", build `npm run build`, output `dist`.

`vite.config.js` uses `base: './'` so the build works from any sub-path.

## How it's organized

```
src/
  main.js             app shell: header, 3-step progress, footer actions
  state.js            this week's data (memory only) + recompute()
  lib/                pure logic, no DOM, fully unit-tested
    address.js        unit splitting ("Apt 4B", "#4B", "Bldg 4"), street normalization, keys
    columns.js        column auto-detection, header-row finding, rows → stops
    parse.js          CSV (PapaParse) / Excel (SheetJS) reading
    complexes.js      detect complexes, resolve each stop to building / pin / address
    unitRules.js      unit → building rules (range, starts/ends with, 1xx pattern, one-off, rest)
    routes.js         stop order + grouping complex stops by building
    mapsLinks.js      Google Maps URLs, splitting long routes
    issues.js         the "Needs attention" list
  services/           the ONLY code that talks to the internet (see table above)
  store/
    db.js             IndexedDB: complexes, pins, settings, cache
    backup.js         JSON backup export/import + merge
  ui/                 one file per screen/dialog; dom.js has html`` (auto-escaping) + helpers
  styles/             tokens.css (colors, light/dark), app.css, print.css
test/                 one test file per lib module + sampleWeek.test.js end-to-end
sample-data/          fake data only. Never commit real family data (.gitignore helps)
```

### Data flow

`file → readRouteFile → detectColumns (or remembered mapping) → rowsToStops → resolveStops (complexes + pins) → buildRoutes → splitRouteLinks → screens`

`recompute()` in `state.js` re-runs the last four steps whenever a complex, pin or setting changes.

### Apartment model

```js
complex = {
  id, name, schemaVersion, createdAt, updatedAt,
  addresses: [{ key: '400 SYCAMORE RIDGE LN|27510', street, city, state, zip }],
  center: { lat, lng },
  buildings: [{ id, label: 'Building C', lat, lng, note, osmId }],
  rules: [{ id, type: 'pattern', value: '1xx', buildingId }],   // see unitRules.js
  siteMap: { url } | { image: dataURL } | null,
}
```

Rule order: one-off units → "Bldg X" text in the address matching a building label → ranges → starts/ends/patterns → "every other unit". Two same-level rules sending a unit to different buildings are flagged as a conflict.

A stop resolves to `place.kind` = `building` | `pin` | `address`, and `place.status` = `ok` | `unmatched` (complex known, unit not covered) | `not-set-up`. Anything not `ok` shows in "Needs attention" and falls back to the street address.

### Moving to shared storage later

`store/db.js` exposes `list / get / put / remove / putMany` per collection; every record has `id`, `updatedAt`, `schemaVersion`. Write the same functions against Supabase/Firestore and swap the import. `backup.js`'s `mergeRecords` (newest `updatedAt` wins) is the sync rule.

## Free services and their rules

- **Google Maps URLs**: no key needed. Up to 9 waypoints in the app/desktop, **3 in mobile browsers**, 2,048 characters per URL. Default 10 stops per link (9 waypoints + destination); stops in the same building count once. See `lib/mapsLinks.js`.
- **Nominatim**: max 1 request/second, results must be cached, no autocomplete. We look up once per complex and cache in IndexedDB.
- **Overpass**: low volume, cached per complex. Public servers are often busy; we time out after 20s, try a second server, and fall back to "Drop a pin".
- **NC OneMap imagery** (6-inch aerial photos, NC state government), **USGS National Map imagery** (public domain, outside NC), **OpenStreetMap tiles** (light use, attribution). Attribution is shown on every map.

## Known limits / next steps

- Pins are per browser. Back up! (The app reminds you after changes.)
- Map tiles and OSM outlines need internet; everything else works offline once loaded.
- Later phases this design leaves room for: pull from Salesforce instead of the Excel macro, shared storage, driver "wrong building" reports, our own route optimization (OR-Tools).
