import { defineConfig } from 'vite';

// GitHub Pages serves the project from /<repo>/, local dev from /.
const base = process.env.GITHUB_ACTIONS ? '/heirloom/' : '/';

export default defineConfig({
  base,
  server: { port: 5173, strictPort: false },
  build: { target: 'es2022' },
});
