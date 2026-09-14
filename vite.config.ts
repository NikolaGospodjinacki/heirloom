import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// GitHub Pages serves the project from /<repo>/, local dev from /.
const base = process.env.GITHUB_ACTIONS ? '/heirloom/' : '/';

export default defineConfig({
  base,
  server: { port: 5173, strictPort: false },
  build: {
    target: 'es2022',
    // three.js and the peer-to-peer library are most of it
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      input: {
        // the HD-2D game
        main: resolve(__dirname, 'index.html'),
        // the original top-down build, kept playable at /2d/
        twod: resolve(__dirname, '2d/index.html'),
      },
    },
  },
});
