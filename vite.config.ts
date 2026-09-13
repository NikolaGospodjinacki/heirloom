import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// GitHub Pages serves the project from /<repo>/, local dev from /.
const base = process.env.GITHUB_ACTIONS ? '/heirloom/' : '/';

export default defineConfig({
  base,
  server: { port: 5173, strictPort: false },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      input: {
        // the first-person 3D game
        main: resolve(__dirname, 'index.html'),
        // the original top-down build, kept playable at /2d/
        twod: resolve(__dirname, '2d/index.html'),
      },
    },
  },
});
