/**
 * OldFace Taxi — servidor propio del módulo de taxi (servicio systemd, como rtc-server).
 *
 *   /taxi/api/admin/…   panel de administración (CRUD con permisos por rol)
 *   /taxi/api/app/…     apps de cliente y conductor (token de sesión de OldFace)
 *   /taxi/socket.io     tiempo real: ofertas de viaje, posición del conductor, estados
 *   /taxi/files/…       archivos subidos (documentos, fotos, iconos)
 *   /taxi/health        estado del servicio
 *
 * Configuración: el mismo .env del backend de OldFace (ENV_FILE) — RTC_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD…
 */
const path = require('path');
require('dotenv').config({ path: process.env.ENV_FILE || path.join(__dirname, '..', 'frontend', 'backend', '.env') });

const http = require('http');
const express = require('express');
const cors = require('cors');

const PORT = Number(process.env.TAXI_PORT || 4100);
const { DB_FILE } = require('./db');

const app = express();
app.disable('x-powered-by');
app.use(cors());
// Avisos de la pasarela de la tarjeta de crédito (Stripe): cuerpo SIN procesar para comprobar la firma → antes de express.json
app.post('/taxi/api/payments/stripe/webhook', express.raw({ type: () => true, limit: '1mb' }), (req, res) => require('./cardpay').webhook(req, res));
app.use(express.json({ limit: '2mb' }));

const started = Date.now();
app.get('/taxi/health', (_req, res) => res.json({ ok: true, service: 'oldface-taxi', db: path.basename(DB_FILE), uptime: Math.round((Date.now() - started) / 1000) }));

app.use('/taxi/api/admin', require('./routes/admin'));
app.use('/taxi/api/app', require('./routes/app'));
app.use('/taxi/files', express.static(path.join(path.dirname(DB_FILE), 'uploads'), { maxAge: '30d', fallthrough: false }));

// Panel de administración (taxi-admin compilado en public/admin; rutas con hash → basta con index.html)
const ADMIN_DIR = path.join(__dirname, 'public', 'admin');
app.get('/taxi/admin', (req, res, next) => (req.path.endsWith('/') ? next() : res.redirect(301, '/taxi/admin/')));
app.use('/taxi/admin', express.static(ADMIN_DIR, { index: 'index.html', setHeaders: (res, file) => {
  res.setHeader('Cache-Control', file.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable');
} }));

// Mapa (PMTiles + fuentes/iconos): en producción lo sirve nginx desde /srv/maps; aquí solo si se indica MAPS_DIR (desarrollo)
if (process.env.MAPS_DIR) {
  for (const sub of ['tiles', 'assets']) {
    app.use(`/maps/${sub}`, express.static(path.join(process.env.MAPS_DIR, sub), { maxAge: '7d', fallthrough: false }));
  }
}

app.use('/taxi', (_req, res) => res.status(404).json({ error: 'No encontrado' }));
app.use((e, _req, res, _next) => res.status(e.status || e.statusCode || 500).json({ error: e.expose ? e.message : 'Error' }));

const server = http.createServer(app);
require('./realtime').init(server);
server.listen(PORT, '127.0.0.1', () => {
  console.log(`🚕 OldFace Taxi en http://127.0.0.1:${PORT}/taxi/health`);
  require('./dispatch').resume();      // retomar búsquedas de conductor pendientes
});

module.exports = { app, server };
