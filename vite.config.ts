import { defineConfig } from 'vite';

export default defineConfig({
  // Base path for GitHub Pages deployment (change to repo name if needed)
  base: './',
  build: {
    outDir: 'dist',
    target: 'es2020',
    sourcemap: true,
  },
  server: {
    port: 5173,
    open: true,
  },
});
