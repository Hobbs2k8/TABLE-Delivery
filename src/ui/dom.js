// Tiny helpers for building the UI with plain HTML strings.
// html`` escapes every value automatically, so household data can never
// inject markup. Use raw() only for HTML you built yourself (icons, QR SVGs).

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export const raw = (s) => ({ __html: String(s ?? '') });

function fmt(v) {
  if (v === null || v === undefined || v === false) return '';
  if (Array.isArray(v)) return v.map(fmt).join('');
  if (typeof v === 'object' && '__html' in v) return v.__html;
  return esc(v);
}

/** Tagged template: html`<p>${name}</p>` -> { __html } with values escaped. */
export function html(strings, ...values) {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < values.length) out += fmt(values[i]);
  });
  return raw(out);
}

/** Put html into an element. */
export function mount(el, content) {
  el.innerHTML = fmt(content);
  return el;
}

/** Make an element from html`` or from a fixed markup string written in code. */
export function el(content) {
  const t = document.createElement('template');
  t.innerHTML = (typeof content === 'string' ? content : fmt(content)).trim();
  return t.content.firstElementChild;
}

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ---------- Icons (inline SVG, 24px grid, stroke = currentColor) ----------
const path = (d, extra = '') => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${d}</svg>`;
export const icons = {
  upload: path('<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>'),
  sheet: path('<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>'),
  check: path('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  alert: path('<path d="M12 3l9.5 17h-19z"/><path d="M12 10v4M12 17.5v.01"/>'),
  building: path('<rect x="5" y="3" width="14" height="18" rx="1"/><path d="M9 7h.01M15 7h.01M9 11h.01M15 11h.01M9 15h.01M15 15h.01M11 21v-3h2v3"/>'),
  pin: path('<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>'),
  copy: path('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>'),
  print: path('<path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v7H7z"/>'),
  close: path('<path d="M6 6l12 12M18 6L6 18"/>'),
  menu: path('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  user: path('<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>'),
  back: path('<path d="M15 6l-6 6 6 6"/>'),
  lock: path('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
  download: path('<path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 20h16"/>'),
  link: path('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
  help: path('<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01"/>'),
  image: path('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>'),
  doc: '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round" aria-hidden="true"><path d="M16 6h22l12 12v38a2 2 0 0 1-2 2H16a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z"/><path d="M38 6v12h12"/><path d="M22 32h20M22 40h20M22 48h12"/></svg>',
};

// ---------- Toast ----------
let toastTimer;
export function toast(message) {
  document.querySelector('.toast')?.remove();
  const t = el(html`<div class="toast" role="status">${message}</div>`);
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 4000);
}

// ---------- Overlays and modals ----------
const openStack = [];
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && openStack.length) openStack[openStack.length - 1]();
});

function trapFocus(root) {
  const prev = document.activeElement;
  requestAnimationFrame(() => (root.querySelector('[autofocus]') || root.querySelector('button, input, select, a[href]'))?.focus());
  return () => prev?.focus?.();
}

/**
 * Full-screen overlay with a header (close button + title) and optional footer.
 * Returns { root, body, foot, close }.
 */
export function openOverlay({ title, onClose, closeLabel = 'Close' }) {
  const root = el(html`
    <div class="overlay" role="dialog" aria-modal="true" aria-label="${title}">
      <div class="overlay-head">
        <button class="icon-btn" data-close aria-label="${closeLabel}">${raw(icons.close)}</button>
        <h2>${title}</h2>
        <span></span>
      </div>
      <div class="overlay-body"></div>
      <div class="overlay-foot"></div>
    </div>`);
  document.body.append(root);
  document.body.style.overflow = 'hidden';
  const restore = trapFocus(root);
  const close = () => {
    if (onClose && onClose() === false) return;
    root.remove();
    openStack.splice(openStack.indexOf(close), 1);
    if (!openStack.length) document.body.style.overflow = '';
    restore();
  };
  openStack.push(close);
  root.querySelector('[data-close]').addEventListener('click', close);
  return { root, body: root.querySelector('.overlay-body'), foot: root.querySelector('.overlay-foot'), close };
}

/** Centered modal. Returns { root, body, close }. */
export function openModal({ title, wide = false, onClose }) {
  const backdrop = el(html`
    <div class="modal-backdrop">
      <div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${title}">
        <div class="overlay-head">
          <button class="icon-btn" data-close aria-label="Close">${raw(icons.close)}</button>
          <h2>${title}</h2>
          <span></span>
        </div>
        <div class="modal-body"></div>
      </div>
    </div>`);
  document.body.append(backdrop);
  const restore = trapFocus(backdrop);
  const close = () => {
    onClose?.();
    backdrop.remove();
    openStack.splice(openStack.indexOf(close), 1);
    restore();
  };
  openStack.push(close);
  backdrop.querySelector('[data-close]').addEventListener('click', close);
  backdrop.addEventListener('mousedown', (e) => e.target === backdrop && close());
  return { root: backdrop, body: backdrop.querySelector('.modal-body'), close };
}

export async function copyText(text, message = 'Copied. Paste it into a text message.') {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = el('<textarea style="position:fixed;opacity:0"></textarea>');
    ta.value = text;
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast(message);
}
