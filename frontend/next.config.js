/** @type {import('next').NextConfig} */
// OldFace puede deployarse con Vite (preferido para Capacitor)
// o con Next.js en modo output:'export' (SPA estático)
// Este archivo es para el caso Next.js

const nextConfig = {
  output: 'export',        // Genera HTML estático para Plesk/Nginx
  trailingSlash: true,     // Necesario para SPA routing en Nginx
  images: {
    unoptimized: true,     // Requerido con output: export
  },
  env: {
    NEXT_PUBLIC_BACKEND_URL: process.env.VITE_BACKEND_URL,
    NEXT_PUBLIC_POLL_URL: process.env.VITE_POLL_URL,
  },
};

module.exports = nextConfig;
