import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import { seniorCompanionApiPlugin } from './src/lib/server/viteApiPlugin';

const srcDir = decodeURIComponent(
  new URL('./src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
);

export default defineConfig({
  plugins: [react(), seniorCompanionApiPlugin()],
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
