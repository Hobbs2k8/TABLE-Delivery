// "How this works" side panel. Opens by itself on the first visit.

import { html, raw, el, icons } from './dom.js';

export function openHelp() {
  if (document.querySelector('.panel')) return;
  const backdrop = el('<div class="panel-backdrop"></div>');
  const panel = el(html`
    <aside class="panel" role="dialog" aria-modal="true" aria-labelledby="help-title">
      <div class="overlay-head">
        <button class="icon-btn" data-close aria-label="Close">${raw(icons.close)}</button>
        <h2 id="help-title">How this works</h2><span></span>
      </div>
      <div class="panel-body">
        <div class="how-step"><span class="n">1</span><div><h3>Upload the week's file</h3><p class="muted">The Routific export or the Monday spreadsheet. The first time, check which column is which. After that it's remembered.</p></div></div>
        <div class="how-step"><span class="n">2</span><div><h3>Review the routes</h3><p class="muted">If anything needs fixing, it's listed at the top with a button that takes you to the fix. Most weeks, there's nothing to do.</p></div></div>
        <div class="how-step"><span class="n">3</span><div><h3>Print or text</h3><p class="muted">Each sheet has QR codes. Drivers scan them with their phone camera and Google Maps opens with every stop in order. Nothing to install.</p></div></div>
        <div class="card" style="padding:20px">
          <h3 style="margin-bottom:6px">Apartment complexes</h3>
          <p class="muted">The first time a complex shows up, you mark its buildings on a satellite map and say which units are in which building (for example, “units 101–124 are Building 1”). It takes a few minutes, once. Every week after, each family's stop goes straight to the right building.</p>
        </div>
        <div class="card" style="padding:20px">
          <h3 style="margin-bottom:6px">${raw(icons.lock)} Privacy</h3>
          <p class="muted">Names, phones and unit numbers never leave this computer. Building pins are saved in this browser. Use “Download a backup” in the menu to keep a copy.</p>
        </div>
        <a class="btn btn-outline" href="${import.meta.env.BASE_URL}walkthrough.html" target="_blank" rel="noopener">See the step-by-step walkthrough with pictures</a>
        <button class="btn btn-primary" data-close>Got it</button>
      </div>
    </aside>`);
  document.body.append(backdrop, panel);
  const prev = document.activeElement;
  panel.querySelector('[data-close]').focus();
  const close = () => {
    backdrop.remove();
    panel.remove();
    document.removeEventListener('keydown', onKey);
    prev?.focus?.();
  };
  const onKey = (e) => e.key === 'Escape' && close();
  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('click', close);
  panel.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
}
