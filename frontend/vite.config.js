import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    // Ignorar advertencias de módulos dinámicos (Capacitor se carga en nativo)
    rollupOptions: {
      onwarn(warning, warn) {
        // Ignorar errores de imports dinámicos de Capacitor y ZEGOCLOUD en build web
        if (
          warning.code === 'UNRESOLVED_IMPORT' ||
          warning.message?.includes('@capacitor') ||
          warning.message?.includes('zego') ||
          warning.message?.includes('zegocloud')
        ) return;
        warn(warning);
      },
      external: (id) => {
        // Solo externalizar paquetes que son ÚNICAMENTE nativos (sin capa JS para el WebView)
        const nativeOnly = [
          '@capacitor/android',
          '@capacitor/ios',
        ];
        return nativeOnly.some(pkg => id.startsWith(pkg));
      }
    }
  },
  optimizeDeps: {
    exclude: [
      '@capacitor/android',
      '@capacitor/ios',
    ]
  }
});
