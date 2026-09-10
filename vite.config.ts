import { defineConfig } from 'vite';

export default defineConfig({
  base: '/jangwang-kingdom/',
  build: {
    outDir: 'dist',
    assetsInlineLimit: 4096,
    target: 'es2020',
  },
  server: {
    port: 5173,
  },
});
