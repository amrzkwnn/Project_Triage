import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const srcDir = decodeURIComponent(
  new URL('./src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
);

export default defineConfig({
  plugins: [react()],
  css: {
    postcss: {
      plugins: [],
    },
  },
  resolve: {
    alias: {
      '@': srcDir,
    },
  },
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
  },
});


