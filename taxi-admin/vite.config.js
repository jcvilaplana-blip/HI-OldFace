import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// El panel se publica dentro del servidor del taxi: https://oldface.app/taxi/admin/
export default defineConfig({
  plugins: [react()],
  base: '/taxi/admin/',
  build: { outDir: '../taxi-server/public/admin', emptyOutDir: true, sourcemap: false },
  server: { port: 5180, proxy: { '/taxi': 'http://127.0.0.1:4100' } },
});
