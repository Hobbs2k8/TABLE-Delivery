// Runs the route search off the page's main thread, so the page stays
// responsive while a big week is being routed (a few seconds for ~500 households).
import { build } from './routing.js';

self.onmessage = (e) => {
  try {
    self.postMessage({ ok: true, result: build(e.data.households, e.data.opts) });
  } catch (err) {
    self.postMessage({ ok: false, error: err.message });
  }
};
