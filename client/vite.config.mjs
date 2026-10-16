import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root,
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL('../dist', import.meta.url)),
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
  },
  server: {
    // npm run dev:client talks to the API started with npm run dev (port 3000)
    proxy: { '/api': 'http://localhost:3000' },
  },
});
