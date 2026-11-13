/**
 * TABLE Route Sheets: driver check-ins and shared building pins.
 *
 * Runs in TABLE's own Google account, attached to a Google Sheet TABLE owns.
 * Everything it stores stays in that account:
 *   - "Deliveries" tab: one row per driver tap (start, delivered, problem, photo, finish)
 *   - "TABLE delivery photos" Drive folder: photos drivers take (private to TABLE)
 *   - "TABLE shared places.json" Drive file: apartment complexes and house pins,
 *     so every coordinator computer sees the same buildings
 *
 * Setup: docs/CHECKIN-SETUP.md. In short: paste this file into
 * Extensions → Apps Script, run setup() once, deploy as a web app
 * (Execute as: Me, Who has access: Anyone), and paste the web app URL and the
 * key that setup() prints into the app's Settings.
 *
 * Requests must carry the key. Without it nothing is read or written.
 */

var DELIVERY_SHEET = 'Deliveries';
var PHOTO_FOLDER = 'TABLE delivery photos';
var PLACES_FILE = 'TABLE shared places.json';
var HEADERS = ['Received', 'Tapped at', 'Week of', 'Day', 'Route', 'Stop #', 'Street', 'Apt', 'Building', 'Bags', 'What', 'Problem', 'Note', 'Photo', 'Phone ID', 'Event ID'];
var EVENT_TYPES = ['start', 'delivered', 'problem', 'photo', 'finish'];
var WHAT = { start: 'Started route', delivered: 'Delivered', problem: 'Problem', photo: 'Photo', finish: 'Finished route' };

/** Run once from the Apps Script editor. Creates the key, tab, folder and file, and prints the key. */
function setup() {
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty('KEY');
  if (!key) {
    key = Utilities.getUuid().replace(/-/g, '').slice(0, 24);
    props.setProperty('KEY', key);
  }
  deliverySheet_();
  photoFolder_();
  placesFile_();
  Logger.log('Setup done. Paste this key into the app (Print & send → Settings → Driver check-in): ' + key);
  return key;
}

/** Makes a new key. Old route sheets stop working, so print new ones after. */
function newKey() {
  PropertiesService.getScriptProperties().deleteProperty('KEY');
  return setup();
}

function doGet() {
  return json_({ ok: true, app: 'table-route-sheets', ready: !!PropertiesService.getScriptProperties().getProperty('KEY') });
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'bad request' });
  }
  var key = PropertiesService.getScriptProperties().getProperty('KEY');
  if (!key || body.key !== key) return json_({ ok: false, error: 'bad key' });

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (body.action === 'ping') return json_({ ok: true });
    if (body.action === 'checkin') return json_(checkin_(body.event));
    if (body.action === 'sync') return json_(sync_(body));
    return json_({ ok: false, error: 'unknown action' });
  } finally {
    lock.releaseLock();
  }
}

// ---------- check-ins ----------

function checkin_(ev) {
  if (!ev || typeof ev.id !== 'string' || EVENT_TYPES.indexOf(ev.type) < 0) return { ok: false, error: 'bad event' };
  var sheet = deliverySheet_();
  // Phones retry when they lose signal, so the same tap can arrive twice. Keep the first.
  var seen = sheet.getRange(1, HEADERS.length, Math.max(sheet.getLastRow(), 1), 1).createTextFinder(ev.id).matchEntireCell(true).findNext();
  if (seen) return { ok: true, duplicate: true };

  var photoUrl = '';
  if (ev.type === 'photo' && ev.photo) {
    var name = [ev.week, ev.day, ev.route, 'stop ' + ev.stop, ev.at].join(' ').replace(/[\\/:*?"<>|]/g, '-') + '.jpg';
    var blob = Utilities.newBlob(Utilities.base64Decode(String(ev.photo)), 'image/jpeg', name);
    photoUrl = photoFolder_().createFile(blob).getUrl();
  }
  sheet.appendRow([
    new Date(),
    text_(ev.at),
    text_(ev.week),
    text_(ev.day),
    text_(ev.route),
    text_(ev.stop),
    text_(ev.street),
    text_(ev.unit),
    text_(ev.building),
    text_(ev.bags),
    WHAT[ev.type],
    text_(ev.reason),
    text_(ev.note),
    photoUrl,
    text_(ev.device),
    ev.id,
  ]);
  return { ok: true };
}

// Store as plain text, and never let a cell start like a formula.
function text_(v) {
  var s = v == null ? '' : String(v).slice(0, 500);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

// ---------- shared complexes and pins ----------

/**
 * body.complexes / body.pins: the coordinator's records. For each id the most
 * recently saved version wins (deleted ones are kept as { id, deleted: true }
 * so a delete reaches every computer). Returns everything stored.
 */
function sync_(body) {
  var file = placesFile_();
  var data;
  try {
    data = JSON.parse(file.getBlob().getDataAsString() || '{}');
  } catch (err) {
    data = {};
  }
  var out = {};
  ['complexes', 'pins'].forEach(function (name) {
    var byId = {};
    (data[name] || []).forEach(function (r) { byId[r.id] = r; });
    (Array.isArray(body[name]) ? body[name] : []).forEach(function (r) {
      if (!r || typeof r.id !== 'string') return;
      var cur = byId[r.id];
      if (!cur || String(r.updatedAt || '') > String(cur.updatedAt || '')) byId[r.id] = r;
    });
    out[name] = Object.keys(byId).map(function (id) { return byId[id]; });
  });
  file.setContent(JSON.stringify({ kind: 'table-route-sheets-shared', savedAt: new Date().toISOString(), complexes: out.complexes, pins: out.pins }));
  return { ok: true, complexes: out.complexes, pins: out.pins };
}

// ---------- helpers ----------

function deliverySheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(DELIVERY_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(DELIVERY_SHEET);
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
  }
  return sheet;
}

function photoFolder_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('PHOTO_FOLDER_ID');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (err) { /* deleted: make a new one */ }
  }
  var folder = DriveApp.createFolder(PHOTO_FOLDER);
  props.setProperty('PHOTO_FOLDER_ID', folder.getId());
  return folder;
}

function placesFile_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('PLACES_FILE_ID');
  if (id) {
    try { return DriveApp.getFileById(id); } catch (err) { /* deleted: make a new one */ }
  }
  var file = DriveApp.createFile(PLACES_FILE, JSON.stringify({ kind: 'table-route-sheets-shared', complexes: [], pins: [] }), 'application/json');
  props.setProperty('PLACES_FILE_ID', file.getId());
  return file;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
