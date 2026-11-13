import { defineConfig } from 'vite';

// base './' makes the built site work from any folder, including
// GitHub Pages project sites (https://<org>.github.io/<repo>/).
// Two pages: the coordinator app (index.html) and the driver check-in page (driver.html).
export default defineConfig({
  base: './',
  build: { rollupOptions: { input: { main: 'index.html', driver: 'driver.html' } } },
  test: { environment: 'node' },
});
