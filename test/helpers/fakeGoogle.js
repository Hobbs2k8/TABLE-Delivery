// Runs apps-script/Code.gs in Node with small fakes of Google's services.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync('apps-script/Code.gs', 'utf8');

export function fakeGoogle() {
  const props = new Map();
  const rows = [];
  const files = new Map();
  let nextId = 1;
  const sheet = {
    appendRow: (r) => rows.push(r.map((v) => (v instanceof Date ? v : v))),
    setFrozenRows() {},
    getLastRow: () => rows.length,
    getRange: (row, col, n) => ({
      setFontWeight() {},
      createTextFinder: (text) => ({
        matchEntireCell: () => ({ findNext: () => (rows.slice(row - 1, row - 1 + n).some((r) => String(r[col - 1]) === text) ? {} : null) }),
      }),
    }),
  };
  let sheetMade = false;
  const makeFile = (name, content) => {
    const id = `f${nextId++}`;
    const f = { id, name, content, getId: () => id, getUrl: () => `https://drive.example/${id}`, getBlob: () => ({ getDataAsString: () => f.content }), setContent: (c) => (f.content = c) };
    files.set(id, f);
    return f;
  };
  const ctx = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props.get(k) ?? null, setProperty: (k, v) => props.set(k, v), deleteProperty: (k) => props.delete(k) }) },
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => (sheetMade ? sheet : null), insertSheet: () => ((sheetMade = true), sheet) }) },
    DriveApp: {
      createFolder: () => {
        const id = `d${nextId++}`;
        return { getId: () => id, createFile: (blob) => makeFile(blob.name, blob.bytes) };
      },
      getFolderById: (id) => ({ createFile: (blob) => makeFile(blob.name, blob.bytes), getId: () => id }),
      createFile: (name, content) => makeFile(name, content),
      getFileById: (id) => {
        if (!files.has(id)) throw new Error('gone');
        return files.get(id);
      },
    },
    Utilities: { getUuid: () => '1234abcd-0000-4000-8000-0000feedbeef', base64Decode: (s) => Buffer.from(s, 'base64'), newBlob: (bytes, type, name) => ({ bytes, type, name }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ text: t, setMimeType() { return this; } }) },
    Logger: { log() {} },
  };
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  const post = (body) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).text);
  return { ctx, rows, files, props, post };
}

