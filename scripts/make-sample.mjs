// Builds the made-up sample week (no real families, no real addresses).
//   node scripts/make-sample.mjs
// Writes:
//   public/sample-week.csv            Routific-style export (used by "Try it with sample data")
//   sample-data/sample-week.csv       same file
//   sample-data/monday-macro.xlsx     the same stops laid out like the Monday spreadsheet, with a title row
//
// Routes:
//   1  rural route, 8 farmhouses spread out, one long driveway
//   2  route through "Sycamore Ridge Apartments" (two street addresses, 4 buildings,
//      units 1xx/2xx/3xx/4xx, plus odd units: 9C, 4B, "Bldg 4 Apt 402", no unit)
//   3  28-stop town route (needs splitting into 3 links), includes a duplex and 3 complex stops
//   4  short route with a second complex that is not set up ("Maple Court")

import { writeFileSync, mkdirSync } from 'node:fs';
import * as XLSX from 'xlsx';

let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const jitter = (n) => (rand() - 0.5) * n;

const rows = [];
let household = 1;
const add = (route, driver, o) => {
  const stop = rows.filter((r) => r.Route === route).length + 1;
  rows.push({
    Route: route,
    'Stop Number': stop,
    Driver: driver,
    Household: `Sample Household ${String(household++).padStart(3, '0')}`,
    Address: o.street,
    Apt: o.apt || '',
    City: o.city || 'Carrboro',
    State: 'NC',
    Zip: o.zip || '27510',
    Phone: `919-555-${String(100 + household).padStart(4, '0')}`,
    Bags: o.bags ?? 1 + Math.floor(rand() * 3),
    Notes: o.notes || '',
    Latitude: o.lat.toFixed(6),
    Longitude: o.lng.toFixed(6),
  });
};

// Route 1: rural, around Hillsborough
const ruralRoads = ['Quail Hollow Rd', 'Old Mill Creek Rd', 'Persimmon Ridge Rd', 'Tobacco Barn Ln', 'Cane Creek Church Rd', 'Fox Run Trl', 'Little River Farm Rd', 'Dairyland Bend Rd'];
ruralRoads.forEach((road, i) => {
  add('1', 'Driver Ana', {
    street: `${1200 + i * 317} ${road}`,
    city: 'Hillsborough',
    zip: '27278',
    lat: 36.08 + i * 0.012 + jitter(0.01),
    lng: -79.18 + i * 0.009 + jitter(0.01),
    notes: i === 3 ? 'Long gravel drive, blue mailbox' : i === 6 ? 'Dog in yard, honk' : '',
  });
});

// The fake complex: Routific puts every household at the entrance point.
const ENTRANCE = { lat: 35.90845, lng: -79.08415 };
const complexStop = (route, driver, street, apt) => add(route, driver, { street, apt, ...ENTRANCE });

// Route 2: houses, then the complex (in Routific's jumbled order), then houses
add('2', 'Driver Ben', { street: '105 Laurel Ave', lat: 35.9112, lng: -79.0731 });
add('2', 'Driver Ben', { street: '18 Hollow Oak Ct', lat: 35.9101, lng: -79.0775 });
const complexUnits = ['212', '104', '318', '9C', '101', '405', '226', '117', '301', '', '4B', '122', '310'];
complexUnits.forEach((u) => complexStop('2', 'Driver Ben', '400 Sycamore Ridge Ln', u));
add('2', 'Driver Ben', { street: '410 Sycamore Ridge Ln Bldg 4 Apt 402', lat: ENTRANCE.lat + 0.0006, lng: ENTRANCE.lng - 0.0008 });
add('2', 'Driver Ben', { street: '410 Sycamore Ridge Ln', apt: 'Apt 411', lat: ENTRANCE.lat + 0.0006, lng: ENTRANCE.lng - 0.0008 });
add('2', 'Driver Ben', { street: '77 Brookside Dr', lat: 35.9061, lng: -79.0902 });

// Route 3: 28 stops through town
const townRoads = ['Pine St', 'Weaver St', 'Greensboro St', 'Oak Ave', 'Main St', 'Lloyd St', 'Center St', 'Hillsborough Rd', 'Davie Rd', 'Elm St', 'Short St', 'Shelton St'];
for (let i = 0; i < 28; i++) {
  if (i === 9 || i === 10) {
    add('3', 'Driver Cam', { street: '208 Shelton St', apt: i === 9 ? 'A' : 'B', lat: 35.9142, lng: -79.0721 }); // duplex
  } else if (i >= 14 && i <= 16) {
    complexStop('3', 'Driver Cam', '400 Sycamore Ridge Ln', ['115', '233', '407'][i - 14]);
  } else {
    add('3', 'Driver Cam', { street: `${100 + i * 13} ${townRoads[i % townRoads.length]}`, lat: 35.905 + jitter(0.03), lng: -79.08 + jitter(0.03) });
  }
}

// Route 4: short, with a complex that's not set up
add('4', 'Driver Dee', { street: '12 Bolin Creek Way', city: 'Chapel Hill', zip: '27514', lat: 35.9301, lng: -79.0612 });
['1', '3', '6'].forEach((u) => add('4', 'Driver Dee', { street: '77 Maple Court', apt: u, city: 'Chapel Hill', zip: '27514', lat: 35.9322, lng: -79.0587 }));
add('4', 'Driver Dee', { street: '340 Ridgefield Rd', city: 'Chapel Hill', zip: '27514', lat: 35.9351, lng: -79.0544 });

// ---------- Write files ----------
const headers = Object.keys(rows[0]);
const csvCell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const csv = [headers.join(','), ...rows.map((r) => headers.map((h) => csvCell(r[h])).join(','))].join('\n') + '\n';
mkdirSync('public', { recursive: true });
mkdirSync('sample-data', { recursive: true });
writeFileSync('public/sample-week.csv', csv);
writeFileSync('sample-data/sample-week.csv', csv);

// Monday-macro style: title rows, Salesforce-ish headers, no coordinates, unit inside the street.
const macroHeaders = ['Route #', 'Driver Name', 'Household', 'Mailing Street', 'Mailing City', 'Mailing State', 'Mailing Zip/Postal Code', 'Home Phone', '# Bags', 'Delivery Notes'];
const matrix = [
  ['TABLE Weekly Delivery Sheet (SAMPLE DATA)'],
  [`Generated ${new Date().toISOString().slice(0, 10)}`],
  [],
  macroHeaders,
  ...rows.map((r) => [r.Route, r.Driver, r.Household, r.Apt ? `${r.Address} Apt ${r.Apt}` : r.Address, r.City, r.State, r.Zip, r.Phone, r.Bags, r.Notes]),
];
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(matrix), 'Monday');
writeFileSync('sample-data/monday-macro.xlsx', XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));

console.log(`Wrote ${rows.length} stops on ${new Set(rows.map((r) => r.Route)).size} routes.`);
