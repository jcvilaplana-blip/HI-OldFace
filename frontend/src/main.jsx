import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';

// ── Detectar plataforma nativa (Capacitor) y marcar clase en <html> ───────────
// Esto permite que CSS use --sat / --sab con valores reales en APK
// sin afectar el navegador web (donde env() safe-area devuelve 0px).
try {
  // window.Capacitor está disponible de forma síncrona antes del bundle de React
  if (window.Capacitor?.isNativePlatform?.()) {
    document.documentElement.classList.add('cap-native');
  }
} catch { /* web: ignorar */ }

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
