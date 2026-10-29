// App shell: header with the 3-step progress, the current screen, and the
// footer with Back / main action. Each screen's render() returns its footer.

import '@fontsource-variable/nunito-sans';
import 'leaflet/dist/leaflet.css';
import './styles/tokens.css';
import './styles/app.css';
import './styles/print.css';

import { state, recompute } from './state.js';
import { list, getSetting, setSetting } from './store/db.js';
import { html, raw, mount, icons, el } from './ui/dom.js';
import { renderUpload } from './ui/upload.js';
import { renderMapping } from './ui/mapping.js';
import { renderReview } from './ui/review.js';
import { renderSend } from './ui/send.js';
import { openHelp } from './ui/help.js';
import { openSavedPlaces } from './ui/savedPlaces.js';

const STEPS = [
  { id: 'upload', label: 'Upload', long: 'Upload file' },
  { id: 'review', label: 'Review', long: 'Review routes' },
  { id: 'send', label: 'Print & send', long: 'Print & send' },
];
const stepIndex = (id) => (id === 'mapping' ? 0 : STEPS.findIndex((s) => s.id === id));

const header = document.getElementById('header');
const main = document.getElementById('main');
const footer = document.getElementById('footer');

export const app = {
  state,
  go(step) {
    state.step = step;
    render();
    main.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  },
  render,
  /** Reload saved complexes and pins, then rebuild routes. */
  async reloadPlaces() {
    [state.complexes, state.pins] = await Promise.all([list('complexes'), list('pins')]);
    recompute();
    render();
  },
  async noteChange() {
    await setSetting('unsavedChanges', (await getSetting('unsavedChanges', 0)) + 1);
  },
};

function renderHeader() {
  const current = stepIndex(state.step);
  const hasData = state.routes.length > 0;
  mount(
    header,
    html`
      <a class="brand" href="./" aria-label="TABLE Route Sheets, start over">
        <svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="9" fill="currentColor"/><path d="M9 11h14M16 11v12" stroke="#fff" stroke-width="3.5" stroke-linecap="round"/></svg>
        <span>TABLE<small>Route sheets</small></span>
      </a>
      <nav class="stepper" aria-label="Progress">
        ${STEPS.map((s, i) => {
          const reachable = i === 0 || hasData;
          return html`<button class="step ${i < current ? 'done' : ''}" ${i === current ? raw('aria-current="step"') : ''} ${reachable ? '' : raw('disabled')} data-step="${s.id}">
            <span class="step-num">${i < current ? raw(icons.check.replace('class="icon"', 'class="icon" style="width:14px;height:14px"')) : i + 1}</span>
            <span><span class="step-label-long">${s.long}</span><span class="visually-hidden">${i < current ? ' (done)' : ''}</span></span>
          </button>`;
        })}
      </nav>
      <div class="header-right">
        <button class="link-btn" data-help>How this works</button>
        <button class="menu-btn" data-menu aria-haspopup="true" aria-expanded="false" aria-label="Saved places and settings">
          ${raw(icons.menu)}<span class="avatar">${raw(icons.building)}</span>
        </button>
      </div>`,
  );
  // Short labels on small screens: replace long label text when narrow
  header.querySelectorAll('.step').forEach((b, i) => {
    const long = b.querySelector('.step-label-long');
    if (window.matchMedia('(max-width: 900px)').matches) long.textContent = STEPS[i].label;
  });

  header.querySelectorAll('[data-step]').forEach((b) =>
    b.addEventListener('click', () => {
      const target = b.dataset.step;
      if (target === 'upload' || state.routes.length) app.go(target);
    }),
  );
  header.querySelector('[data-help]').addEventListener('click', () => openHelp());
  header.querySelector('[data-menu]').addEventListener('click', (e) => toggleMenu(e.currentTarget));
}

function toggleMenu(button) {
  const existing = document.querySelector('.menu');
  if (existing) {
    existing.remove();
    button.setAttribute('aria-expanded', 'false');
    return;
  }
  const theme = localStorageGet('theme') || 'auto';
  const menu = el(html`
    <div class="menu" role="menu">
      <button role="menuitem" class="strong" data-act="places">Saved complexes &amp; pins</button>
      <button role="menuitem" data-act="backup">Download a backup</button>
      <button role="menuitem" data-act="restore">Restore from a backup</button>
      <hr />
      <button role="menuitem" data-act="theme">Appearance: ${theme === 'auto' ? 'Match computer' : theme === 'dark' ? 'Dark' : 'Light'}</button>
      <button role="menuitem" data-act="help">How this works</button>
    </div>`);
  document.body.append(menu);
  button.setAttribute('aria-expanded', 'true');
  menu.querySelector('button').focus();
  const close = () => {
    menu.remove();
    button.setAttribute('aria-expanded', 'false');
    document.removeEventListener('mousedown', outside);
  };
  const outside = (e) => !menu.contains(e.target) && !button.contains(e.target) && close();
  setTimeout(() => document.addEventListener('mousedown', outside));
  menu.addEventListener('keydown', (e) => e.key === 'Escape' && (close(), button.focus()));
  menu.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    close();
    if (act === 'places') openSavedPlaces(app);
    if (act === 'backup') openSavedPlaces(app, { action: 'backup' });
    if (act === 'restore') openSavedPlaces(app, { action: 'restore' });
    if (act === 'help') openHelp();
    if (act === 'theme') {
      const next = { auto: 'light', light: 'dark', dark: 'auto' }[theme];
      localStorageSet('theme', next);
      applyTheme();
    }
  });
}

function renderFooter(config = {}) {
  const current = stepIndex(state.step);
  const { back, next, hint } = config;
  mount(
    footer,
    html`
      <div class="progress" aria-hidden="true">
        ${STEPS.map((_, i) => html`<span style="--fill:${i < current ? 1 : i === current ? 0.5 : 0}"></span>`)}
      </div>
      <div class="footer-row">
        ${back ? html`<button class="link-btn" data-back>${back.label || 'Back'}</button>` : html`<span></span>`}
        ${hint ? html`<p class="footer-hint">${hint}</p>` : ''}
        ${next ? html`<button class="btn ${next.accent ? 'btn-accent' : 'btn-primary'}" data-next ${next.disabled ? raw('disabled') : ''}>${next.icon ? raw(next.icon) : ''}${next.label}</button>` : ''}
      </div>`,
  );
  footer.querySelector('[data-back]')?.addEventListener('click', back?.onClick);
  footer.querySelector('[data-next]')?.addEventListener('click', next?.onClick);
}

export function render() {
  renderHeader();
  const screens = { upload: renderUpload, mapping: renderMapping, review: renderReview, send: renderSend };
  const footerConfig = screens[state.step](main, app);
  renderFooter(footerConfig);
}

// ---------- Theme (per computer; a convenience, so localStorage is fine) ----------
function localStorageGet(k) {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function localStorageSet(k, v) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* private mode: ignore */
  }
}
function applyTheme() {
  const t = localStorageGet('theme');
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}

// ---------- Start ----------
async function start() {
  applyTheme();
  try {
    [state.complexes, state.pins, state.perLink] = await Promise.all([list('complexes'), list('pins'), getSetting('perLink', 10)]);
  } catch {
    // IndexedDB blocked (e.g. some private windows). The app still works for this session.
    state.complexes = [];
    state.pins = [];
  }
  render();
  window.addEventListener('resize', () => renderHeader());
  if (!(await getSetting('seenHelp', false).catch(() => true))) {
    openHelp();
    setSetting('seenHelp', true).catch(() => {});
  }
}
start();
