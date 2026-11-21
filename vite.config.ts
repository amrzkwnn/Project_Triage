import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';

const srcDir = decodeURIComponent(
  new URL('./src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
);

export default defineConfig({
  plugins: [react()],
  css: {
    postcss: {
      plugins: [tailwindcss('./tailwind.config.js'), autoprefixer()],
    },
  },
  resolve: {
    alias: {
      '@': srcDir,
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
