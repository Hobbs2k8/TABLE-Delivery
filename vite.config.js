import { defineConfig } from 'vite';

// base './' makes the built site work from any folder, including
// GitHub Pages project sites (https://<org>.github.io/<repo>/).
export default defineConfig({
  base: './',
  test: { environment: 'node' },
});
