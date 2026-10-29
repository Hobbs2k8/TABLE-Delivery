// Takes the screenshots for public/walkthrough.html by clicking through the
// app with the made-up sample data. Re-run after UI changes:
//
//   npm run dev                      (in one terminal)
//   npm run walkthrough:shots        (in another)
//
// Uses your installed Google Chrome (set CHROME=/path/to/chrome to override).
// Building outlines come from scripts/fixtures/sycamore-buildings.json, so the
// busy public OpenStreetMap server isn't needed. Map photos still load live.

import puppeteer from 'puppeteer-core';
import { mkdirSync, readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.BASE || 'http://localhost:5173/';
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = 'public/walkthrough';
const fixture = JSON.parse(readFileSync('scripts/fixtures/sycamore-buildings.json', 'utf8'));
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  userDataDir: mkdtempSync(join(tmpdir(), 'table-shots-')), // fresh browser: no saved complexes
  defaultViewport: { width: 1280, height: 820, deviceScaleFactor: 1.5 },
});
const page = await browser.newPage();
await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }, { name: 'prefers-color-scheme', value: 'light' }]);

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const idle = () => page.waitForNetworkIdle({ idleTime: 1200, timeout: 30000 }).catch(() => {});
const shot = async (name) => {
  await pause(300);
  await page.screenshot({ path: `${OUT}/${name}.jpg`, type: 'jpeg', quality: 78 });
  console.log('saved', name);
};
const scrollTo = (selector, block = 'start') => page.$eval(selector, (el, block) => el.scrollIntoView({ block }), block);
const clickText = (selector, text) =>
  page.evaluate((selector, text) => [...document.querySelectorAll(selector)].find((b) => b.textContent.trim().includes(text)).click(), selector, text);

// 1. First visit: How this works
await page.goto(BASE, { waitUntil: 'networkidle0' });
await page.waitForSelector('.panel');
await shot('01-help');
await page.click('.panel [data-close]');

// Seed the building-outline cache so setup doesn't depend on the live server.
await page.evaluate(
  (record) =>
    new Promise((resolve, reject) => {
      const req = indexedDB.open('table-route-sheets');
      req.onsuccess = () => {
        const tx = req.result.transaction('cache', 'readwrite');
        tx.objectStore('cache').put(record);
        tx.oncomplete = resolve;
        tx.onerror = reject;
      };
    }),
  fixture,
);

// 2. Upload
await shot('02-upload');
await page.click('#sample');
await page.waitForSelector('select[data-field]');
await shot('03-columns');

// 3. Review
await page.click('[data-next]');
await page.waitForSelector('.attention');
await page.waitForSelector('.qr-card svg');
await shot('04-review');
await page.evaluate(() => document.querySelectorAll('#sheet-slot .stops tbody tr')[1].scrollIntoView({ block: 'start' }));
await page.evaluate(() => window.scrollBy(0, -120));
await shot('05-sheet-warnings');

// 4. Set up the complex
await page.evaluate(() => window.scrollTo(0, 0));
await page.click('.attention [data-setup-key]');
await page.waitForSelector('.overlay #cmap path');
await idle();
await shot('06-setup-map');

await page.click('[data-add-addr]'); // 410 Sycamore Ridge Ln is the same complex
// The four Sycamore Ridge buildings (other complexes nearby reuse the same letters).
for (const osmId of ['way/44267086', 'way/44267246', 'way/44267336', 'way/44267990']) {
  const i = fixture.value.findIndex((b) => b.osmId === osmId);
  const paths = await page.$$('#cmap path');
  await paths[i].click();
  await pause(250);
}
await page.mouse.move(5, 5); // no hover tooltips in the picture
await idle();
await shot('07-buildings');

for (const [pattern, label] of [['1xx', 'F'], ['2xx', 'C'], ['3xx', 'G'], ['4xx', 'A']]) {
  await page.select('[data-rule-type]', 'pattern');
  await page.type('[data-r="value"]', pattern);
  await page.evaluate((label) => {
    const s = document.querySelector('[data-rule-building]');
    s.value = [...s.options].find((o) => o.text === label).value;
  }, label);
  await page.click('[data-add-rule]');
  await pause(150);
}
await scrollTo('#rules-section');
await shot('08-rules');

await page.click('[data-quick="4B"]');
await page.evaluate(() => {
  const s = document.querySelector('[data-quick-building]');
  s.value = [...s.options].find((o) => o.text === 'A').value;
});
await scrollTo('#preview-section');
await shot('09-preview');
await page.click('[data-quick-add]');
await pause(200);

// 5. Saved: back on Review
await page.click('.overlay-foot [data-save]');
await page.waitForSelector('.overlay', { hidden: true });
await page.evaluate(() => window.scrollTo(0, 0));
await shot('10-review-after');

// 6. Pin a single house (first house on route 2, in town)
await page.waitForSelector('.toast', { hidden: true, timeout: 8000 }).catch(() => {});
await page.evaluate(() => window.scrollTo(0, 0));
await page.evaluate(() => document.querySelector('#sheet-slot [data-pin-stop]').click());
await page.waitForSelector('#pmap .pin-dot');
await page.type('.modal [data-note]', 'Blue house, use the side door');
await idle();
await shot('12-house-pin');
await page.keyboard.press('Escape');

// 7. Print & send
await clickText('[data-next]', 'Continue to print');
await page.waitForSelector('.send-list');
await shot('13-send');

// 8. The printed sheets (print styles, letter-page width)
await page.evaluate(() => (window.print = () => {}));
await page.click('[data-print]');
await page.waitForFunction(() => document.querySelectorAll('#print-root .qr-card svg').length >= 6);
await page.emulateMediaType('print');
await page.setViewport({ width: 816, height: 1056, deviceScaleFactor: 1.5 });
await page.evaluate(() => window.scrollTo(0, 0));
await shot('14-printed-rural');
await page.evaluate(() => {
  const s = document.querySelectorAll('#print-root .sheet')[1];
  window.scrollTo(0, s.getBoundingClientRect().top + window.scrollY);
});
await shot('15-printed-apartments');
await page.evaluate(() => {
  const s = document.querySelectorAll('#print-root .sheet')[2];
  window.scrollTo(0, s.getBoundingClientRect().top + window.scrollY);
});
await shot('16-printed-long-route');

await browser.close();
