import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
export default defineConfig(({ mode }) => ({
  root: 'static/ui', base: './', plugins: [react()],
  worker: { format: 'es' },
  resolve: { alias: mode === 'mock' ? { '@forge/bridge': fileURLToPath(new URL('./static/ui/mock-bridge.js', import.meta.url)) } : {} },
  build: { outDir: 'build', emptyOutDir: true },
  server: { port: 4178, strictPort: true, fs: { allow: ['../..'] } }
}));
