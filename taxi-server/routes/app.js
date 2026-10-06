/**
 * API de las apps del taxi — /taxi/api/app/…  (token de sesión de OldFace en Authorization: Bearer)
 *
 * Común:      GET /bootstrap · POST /role · GET /maps/search · GET /maps/reverse · POST /maps/route
 *             GET /banners · GET /faqs · POST /upload
 * Cliente:    /customer/… presupuesto, reservas, cancelar, valorar, monedero, perfil, invitaciones, reembolsos
 * Conductor:  /driver/…   panel, perfil, vehículos, documentos, conectarse, ofertas, estados del viaje, ganancias,
 *                         monedero, retiradas, incentivos, puntos de cobro
 * Soporte:    /support/…  tickets (cliente y conductor)
 *
 * Regla: una cuenta de OldFace es CLIENTE o CONDUCTOR, nunca las dos cosas (se elige una vez en POST /role).
 */
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { all, get, run, tx, now, getSetting, DB_FILE } = require('../db');
const { appAuth, requireRole } = require('../auth');
const { validPoint } = require('../geo');
const maps = require('../maps');
const pricing = require('../pricing');
const dispatch = require('../dispatch');
const trips = require('../trips');
const wallet = require('../wallet');
const rt = require('../realtime');

const router = express.Router();
const UPLOADS = path.join(path.dirname(DB_FILE), 'uploads');
fs.mkdirSync(UPLOADS, { recursive: true });

const err = (status, message) => Object.assign(new Error(message), { status });
/** Envuelve rutas async para que sus errores lleguen al gestor de errores (Express 4) */
const a = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const pt = (p) => ({ lat: Number(p?.lat), lng: Number(p?.lng), address: String(p?.address || '').slice(0, 300) });
const newCode = (prefix) => `${prefix}${new Date().toISOString().slice(2, 10).replace(/-/g, '')}${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
const referralCode = (name) => `${String(name || 'OF').normalize('NFD').replace(/[^A-Za-z]/g, '').slice(0, 4).toUpperCase() || 'OF'}${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

router.use(appAuth);

// ── Común ───────────────────────────────────────────────────────────────────
function publicSettings() {
  const app = getSetting('app', {}), pay = getSetting('payments', {}), ref = getSetting('referral', {}), refund = getSetting('refund', {});
  return {
    app: { name: app.appName, supportEmail: app.supportEmail, supportPhone: app.supportPhone, maintenance: !!app.maintenanceMode,
           primaryColor: app.appPrimaryColor, androidVersion: app.androidVersion, androidForceUpdate: !!app.androidForceUpdate,
           shareLink: app.androidShareLink },
    payments: { cash: !!pay.cash?.enabled, wallet: !!pay.wallet?.enabled, stripe: !!pay.stripe?.enabled,
                stripePublishableKey: pay.stripe?.enabled ? pay.stripe.publishableKey : null },
    referral: { userReferrer: ref.userReferrer, userReferred: ref.userReferred, driverReferrer: ref.driverReferrer,
                driverReferred: ref.driverReferred, friendDiscount: ref.userFriendDiscount },
    currency: getSetting('currency'), refundHours: refund.requiredHours, otpRequired: getSetting('booking', {}).otpRequired !== false,
    // Mapa propio: archivo PMTiles y fuentes/iconos servidos en el mismo dominio
    map: { tiles: process.env.MAPS_TILES_URL || '/maps/tiles/world.pmtiles', assets: process.env.MAPS_ASSETS_URL || '/maps/assets' },
  };
}

/** Todo lo que la app necesita al abrir el taxi: rol (si ya lo eligió), perfil, ajustes, países, idiomas y textos */
router.get('/bootstrap', (req, res) => {
  const profile = req.taxiRole ? get(`SELECT * FROM ${req.taxiRole === 'driver' ? 'drivers' : 'customers'} WHERE user_id = ?`, req.userId) : null;
  const langCode = String(req.query.lang || profile?.language || '');
  const lang = get('SELECT code, name, rtl, app_json FROM languages WHERE active = 1 AND code = ?', langCode)
            || get('SELECT code, name, rtl, app_json FROM languages WHERE active = 1 AND is_default = 1');
  res.json({
    role: req.taxiRole, profile,
    settings: publicSettings(),
    countries: all('SELECT id, name, code, currency_code, currency_symbol, phone_code, default_language, lat, lng, zoom, is_default FROM countries WHERE active = 1 ORDER BY sort_order, name'),
    languages: all('SELECT code, name, name_en, image, rtl, is_default FROM languages WHERE active = 1 ORDER BY is_default DESC, name'),
    language: lang ? { code: lang.code, name: lang.name, rtl: !!lang.rtl, texts: JSON.parse(lang.app_json || '{}') } : null,
  });
});

/** Elegir rol la PRIMERA vez (queda fijado; solo el administrador puede cambiarlo) */
router.post('/role', (req, res) => {
  const role = req.body?.role;
  if (!['customer', 'driver'].includes(role)) throw err(400, 'Elige cliente o conductor');
  if (req.taxiRole) throw err(409, `Tu cuenta ya es de ${req.taxiRole === 'driver' ? 'conductor' : 'cliente'}. Un cliente no puede ser conductor ni al revés.`);
  const name = String(req.body?.name || '').trim().slice(0, 80) || 'Usuario';
  const country = get('SELECT id, default_language FROM countries WHERE id = ? AND active = 1', Number(req.body?.countryId))
               || get('SELECT id, default_language FROM countries WHERE is_default = 1');
  const refBy = String(req.body?.referralCode || '').trim().toUpperCase() || null;
  if (refBy && !get('SELECT 1 FROM customers WHERE referral_code = ? UNION SELECT 1 FROM drivers WHERE referral_code = ?', refBy, refBy)) throw err(400, 'El código de invitación no existe');
  const table = role === 'driver' ? 'drivers' : 'customers';
  tx(() => {
    run('INSERT INTO taxi_accounts (user_id, role, created_at) VALUES (?, ?, ?)', req.userId, role, now());
    run(`INSERT INTO ${table} (user_id, name, phone, email, photo, country_id, language, referral_code, referred_by, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        req.userId, name, req.body?.phone || null, req.body?.email || null, req.body?.photo || null, country?.id || null,
        req.body?.language || country?.default_language || 'es', referralCode(name), refBy, role === 'driver' ? 'pending' : 'active', now());
    const me = get(`SELECT id FROM ${table} WHERE user_id = ?`, req.userId);
    wallet.ensureWallet(role, me.id, get('SELECT currency_code c FROM countries WHERE id = ?', country?.id)?.c || 'EUR');
  });
  res.status(201).json({ role, profile: get(`SELECT * FROM ${table} WHERE user_id = ?`, req.userId) });
});

router.get('/maps/search', a(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ places: [] });
  try { res.json({ places: await maps.search(q, { lat: Number(req.query.lat), lng: Number(req.query.lng), lang: req.query.lang || 'es' }) }); }
  catch { res.status(503).json({ error: 'El buscador de direcciones no está disponible ahora mismo', places: [] }); }
}));
router.get('/maps/reverse', a(async (req, res) => {
  const p = pt(req.query);
  if (!validPoint(p)) throw err(400, 'Punto no válido');
  res.json({ place: await maps.reverse(p.lat, p.lng, { lang: req.query.lang || 'es' }) });
}));
router.post('/maps/route', a(async (req, res) => {
  const points = (req.body?.points || []).map(pt);
  if (points.length < 2 || !points.every(validPoint)) throw err(400, 'Puntos no válidos');
  res.json({ route: await maps.route(points) });
}));

router.get('/banners', (req, res) => {
  const cityId = Number(req.query.cityId) || null;
  const rows = all('SELECT id, title, image_url, row, link, cities FROM banners WHERE active = 1 ORDER BY row, sort_order').filter(b => {
    let c; try { c = JSON.parse(b.cities || '[]'); } catch { c = []; }
    return !c.length || !cityId || c.includes(cityId);
  }).map(({ cities, ...b }) => b);
  res.json({ banners: rows });
});

router.get('/faqs', (req, res) => {
  const audience = req.taxiRole === 'driver' ? 'driver' : 'customer';
  const cats = all("SELECT id, title, icon FROM faq_categories WHERE active = 1 AND audience IN (?, 'all') ORDER BY sort_order", audience);
  res.json({ categories: cats.map(c => ({ ...c, faqs: all('SELECT id, question, answer FROM faqs WHERE category_id = ? AND active = 1 ORDER BY sort_order', c.id) })) });
});

/** Subir un archivo (foto o documento) en binario → URL /taxi/files/… */
const UPLOAD_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'application/pdf': '.pdf' };
router.post('/upload', express.raw({ type: () => true, limit: '12mb' }), (req, res) => {
  if (!req.taxiRole) throw err(403, 'Primero elige cliente o conductor');
  const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (!UPLOAD_TYPES[type]) throw err(415, 'Solo se admiten fotos (JPG, PNG, WebP) o PDF');
  if (!Buffer.isBuffer(req.body) || req.body.length < 100) throw err(400, 'Archivo vacío');
  const name = `${Date.now()}_${crypto.randomBytes(5).toString('hex')}${UPLOAD_TYPES[type]}`;
  fs.writeFileSync(path.join(UPLOADS, name), req.body);
  res.json({ url: `/taxi/files/${name}` });
});

// ══ CLIENTE ═════════════════════════════════════════════════════════════════
const customer = express.Router();
customer.use(requireRole('customer'));

/** Presupuesto: ruta real (Valhalla) + precio de cada tipo de viaje + conductor más cercano */
customer.post('/quote', a(async (req, res) => {
  const pickup = pt(req.body?.pickup), dropoff = pt(req.body?.dropoff);
  if (!validPoint(pickup) || !validPoint(dropoff)) throw err(400, 'Indica origen y destino');
  const route = await maps.route([pickup, dropoff]);
  const q = pricing.quote({ pickup, route, promoCode: req.body?.promoCode, customerId: req.me.id });
  const radius = Number(getSetting('driverSearch', {}).round3Km) || 10;
  for (const o of q.options) {
    const near = dispatch.candidates({ id: 0, pickup_lat: pickup.lat, pickup_lng: pickup.lng, ride_type_id: o.rideType.id }, radius)[0];
    o.nearestKm = near ? Math.round(near.km * 10) / 10 : null;
    o.etaMin = near ? Math.max(2, Math.round(near.km / 25 * 60)) : null;
  }
  res.json({ route, ...q });
}));

customer.post('/bookings', a(async (req, res) => {
  const pickup = pt(req.body?.pickup), dropoff = pt(req.body?.dropoff);
  if (!validPoint(pickup) || !validPoint(dropoff)) throw err(400, 'Indica origen y destino');
  if (get(`SELECT 1 FROM bookings WHERE customer_id = ? AND status IN ('searching','accepted','arrived','started')`, req.me.id)) throw err(409, 'Ya tienes un viaje en curso');
  const method = req.body?.paymentMethod || 'cash';
  const pay = getSetting('payments', {});
  if (!['cash', 'wallet', 'stripe'].includes(method) || !pay[method]?.enabled) throw err(400, 'Esa forma de pago no está disponible');
  const route = await maps.route([pickup, dropoff]);
  const q = pricing.quote({ pickup, route, promoCode: req.body?.promoCode, customerId: req.me.id, rideTypeId: req.body?.rideTypeId });
  if (!q.served) throw err(400, 'Todavía no damos servicio en esta zona');
  if (req.body?.promoCode && q.promoError) throw err(400, q.promoError);
  const opt = q.options[0];
  if (!opt) throw err(400, 'Tipo de viaje no disponible');
  if (method === 'wallet' && wallet.balanceOf('customer', req.me.id) < opt.price.total) throw err(402, 'No tienes saldo suficiente en el monedero');
  const code = newCode('BK');
  const id = Number(run(`INSERT INTO bookings (code, customer_id, ride_type_id, city_id, zone_id, status, pickup_address, pickup_lat, pickup_lng,
      dropoff_address, dropoff_lat, dropoff_lng, distance_km, duration_min, route_shape, currency, base_fare, distance_fare, time_fare, surge,
      discount, promo_code_id, tax_amount, estimated_fare, total_amount, payment_method, created_at)
      VALUES (?,?,?,?,?,'searching',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    code, req.me.id, opt.rideType.id, q.city?.id || null, q.zone?.id || null, pickup.address, pickup.lat, pickup.lng,
    dropoff.address, dropoff.lat, dropoff.lng, route.distanceKm, route.durationMin, route.shape, q.currency.code,
    opt.price.base, opt.price.distance, opt.price.time, opt.price.surge, opt.price.discount, opt.promoId, opt.price.tax,
    opt.price.total, opt.price.total, method, now()).lastInsertRowid);
  dispatch.logEvent(id, 'created', { rideType: opt.rideType.code, total: opt.price.total });
  dispatch.start(id);
  rt.toAdmins('booking:update', { code, status: 'searching' });
  res.status(201).json({ booking: trips.forCustomer(code) });
}));

customer.get('/bookings', (req, res) => {
  const rows = all(`SELECT b.code, b.status, b.pickup_address, b.dropoff_address, b.total_amount, b.estimated_fare, b.currency, b.payment_method,
                    b.created_at, b.completed_at, r.name AS ride_type, r.app_icon FROM bookings b JOIN ride_types r ON r.id = b.ride_type_id
                    WHERE b.customer_id = ? ORDER BY b.created_at DESC LIMIT 100`, req.me.id);
  res.json({ bookings: rows, active: rows.find(b => ['searching', ...trips.ACTIVE].includes(b.status)) || null });
});
customer.get('/bookings/:code', (req, res) => {
  const b = trips.forCustomer(req.params.code);
  if (!b || b.customer_id !== req.me.id) throw err(404, 'Viaje no encontrado');
  res.json({ booking: b });
});
customer.get('/bookings/:code/cancel-fee', (req, res) => {
  const b = get('SELECT * FROM bookings WHERE code = ? AND customer_id = ?', req.params.code, req.me.id);
  if (!b) throw err(404, 'Viaje no encontrado');
  res.json({ fee: trips.cancelFee(b) });
});
customer.post('/bookings/:code/cancel', (req, res) => {
  const r = trips.cancelByCustomer(req.me.id, req.params.code, req.body?.reason);
  res.json({ success: true, fee: r.fee });
});
customer.post('/bookings/:code/rate', (req, res) => { trips.rate('customer', req.me.id, req.params.code, req.body?.stars, req.body?.comment); res.json({ success: true }); });

customer.get('/wallet', (req, res) => {
  const w = wallet.ensureWallet('customer', req.me.id);
  res.json({ wallet: w, transactions: all('SELECT id, type, amount, balance_after, description, created_at FROM wallet_transactions WHERE wallet_id = ? ORDER BY id DESC LIMIT 200', w.id) });
});

customer.put('/profile', (req, res) => {
  const b = req.body || {};
  const fields = { name: b.name, email: b.email, phone: b.phone, photo: b.photo, language: b.language,
                   emergency_contact: b.emergencyContact ? JSON.stringify(b.emergencyContact) : undefined,
                   country_id: b.countryId ? Number(b.countryId) : undefined };
  const keys = Object.keys(fields).filter(k => fields[k] !== undefined);
  if (keys.length) run(`UPDATE customers SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`, ...keys.map(k => typeof fields[k] === 'string' ? fields[k].slice(0, 300) : fields[k]), req.me.id);
  res.json({ profile: get('SELECT * FROM customers WHERE id = ?', req.me.id) });
});

customer.get('/referrals', (req, res) => {
  res.json({ code: req.me.referral_code, settings: publicSettings().referral,
             invited: get('SELECT count(*) n FROM customers WHERE referred_by = ?', req.me.referral_code).n + get('SELECT count(*) n FROM drivers WHERE referred_by = ?', req.me.referral_code).n,
             earned: get("SELECT coalesce(sum(amount),0) s FROM referral_bonuses WHERE referrer_type = 'customer' AND referrer_id = ? AND status = 'paid'", req.me.id).s });
});

customer.post('/refunds', (req, res) => {
  const b = get("SELECT * FROM bookings WHERE code = ? AND customer_id = ? AND status = 'completed'", req.body?.code, req.me.id);
  if (!b) throw err(404, 'Viaje no encontrado');
  if (get("SELECT 1 FROM refund_requests WHERE booking_id = ? AND status = 'pending'", b.id)) throw err(409, 'Ya hay una solicitud de reembolso para este viaje');
  const amount = Math.min(Number(req.body?.amount) || b.total_amount, b.total_amount);
  run('INSERT INTO refund_requests (booking_id, customer_id, reason, amount_requested, status, source, created_at) VALUES (?,?,?,?,?,?,?)',
      b.id, req.me.id, String(req.body?.reason || '').slice(0, 500), amount, 'pending', 'app', now());
  res.status(201).json({ success: true, hours: getSetting('refund', {}).requiredHours });
});

// ══ CONDUCTOR ═══════════════════════════════════════════════════════════════
const driver = express.Router();
driver.use(requireRole('driver'));

/** Estado del alta: qué falta para poder conectarse */
function onboarding(d) {
  const required = all('SELECT id, name, type FROM document_types WHERE active = 1 AND required = 1 ORDER BY sort_order');
  const docs = all('SELECT document_type_id, status FROM driver_documents WHERE driver_id = ?', d.id);
  const vehicle = get('SELECT id, status FROM vehicles WHERE driver_id = ? ORDER BY id DESC LIMIT 1', d.id);
  const missing = required.filter(t => !docs.some(x => x.document_type_id === t.id && x.status !== 'rejected')).map(t => t.name);
  return { verified: !!d.verified, status: d.status, hasVehicle: !!vehicle, vehicleStatus: vehicle?.status || null, missingDocuments: missing,
           canGoOnline: d.status === 'active' && !!d.verified && vehicle?.status === 'active' };
}

driver.get('/dashboard', (req, res) => {
  const d = get('SELECT * FROM drivers WHERE id = ?', req.me.id);
  const d0 = new Date(); d0.setHours(0, 0, 0, 0);
  const since = (ms) => get(`SELECT count(*) trips, coalesce(sum(driver_earning),0) earnings FROM bookings WHERE driver_id = ? AND status = 'completed' AND completed_at >= ?`, d.id, ms);
  const active = get("SELECT code FROM bookings WHERE driver_id = ? AND status IN ('accepted','arrived','started') ORDER BY id DESC LIMIT 1", d.id);
  const offer = get(`SELECT b.code FROM booking_offers o JOIN bookings b ON b.id = o.booking_id WHERE o.driver_id = ? AND o.status = 'offered' AND b.status = 'searching'`, d.id);
  res.json({
    driver: d, onboarding: onboarding(d), wallet: wallet.ensureWallet('driver', d.id),
    today: since(d0.getTime()), week: since(d0.getTime() - 6 * 86400000), month: since(d0.getTime() - 29 * 86400000),
    acceptance: get('SELECT sum(status = \'accepted\') accepted, count(*) offers FROM booking_offers WHERE driver_id = ? AND created_at > ?', d.id, now() - 30 * 86400000),
    activeTrip: active ? trips.forDriver(active.code) : null, pendingOffer: offer?.code || null,
  });
});

driver.put('/profile', (req, res) => {
  const b = req.body || {};
  const fields = { name: b.name, email: b.email, phone: b.phone, photo: b.photo, language: b.language, city_id: b.cityId ? Number(b.cityId) : undefined };
  const keys = Object.keys(fields).filter(k => fields[k] !== undefined);
  if (keys.length) run(`UPDATE drivers SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`, ...keys.map(k => fields[k]), req.me.id);
  res.json({ profile: get('SELECT * FROM drivers WHERE id = ?', req.me.id) });
});

driver.get('/ride-types', (req, res) => res.json({ rideTypes: all('SELECT id, name, code, description, seats, app_icon FROM ride_types WHERE active = 1 ORDER BY sort_order') }));
driver.get('/document-types', (req, res) => res.json({ documentTypes: all('SELECT id, name, type, required, has_expiry FROM document_types WHERE active = 1 ORDER BY sort_order') }));

driver.get('/vehicles', (req, res) => res.json({ vehicles: all('SELECT v.*, r.name AS ride_type FROM vehicles v LEFT JOIN ride_types r ON r.id = v.ride_type_id WHERE driver_id = ?', req.me.id) }));
driver.post('/vehicles', (req, res) => {
  const b = req.body || {};
  if (!b.plate || !b.rideTypeId) throw err(400, 'Matrícula y tipo de viaje obligatorios');
  if (!get('SELECT 1 FROM ride_types WHERE id = ? AND active = 1', Number(b.rideTypeId))) throw err(400, 'Tipo de viaje no válido');
  const id = Number(run('INSERT INTO vehicles (driver_id, ride_type_id, brand, model, color, plate, year, seats, photo, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    req.me.id, Number(b.rideTypeId), b.brand || null, b.model || null, b.color || null, String(b.plate).toUpperCase().slice(0, 20),
    Number(b.year) || null, Number(b.seats) || 4, b.photo || null, 'pending', now()).lastInsertRowid);
  res.status(201).json({ vehicle: get('SELECT * FROM vehicles WHERE id = ?', id) });
});

driver.get('/documents', (req, res) => res.json({ documents: all('SELECT d.*, t.name AS type_name FROM driver_documents d JOIN document_types t ON t.id = d.document_type_id WHERE driver_id = ? ORDER BY d.id DESC', req.me.id) }));
driver.post('/documents', (req, res) => {
  const b = req.body || {};
  if (!get('SELECT 1 FROM document_types WHERE id = ? AND active = 1', Number(b.documentTypeId))) throw err(400, 'Tipo de documento no válido');
  if (!/^\/taxi\/files\/[\w.-]+$/.test(String(b.fileUrl || ''))) throw err(400, 'Sube primero el archivo');
  run('INSERT INTO driver_documents (driver_id, document_type_id, file_url, number, expires_at, status, created_at) VALUES (?,?,?,?,?,?,?)',
      req.me.id, Number(b.documentTypeId), b.fileUrl, b.number || null, b.expiresAt || null, 'pending', now());
  res.status(201).json({ success: true });
});

/** Conectarse / desconectarse (solo verificados con vehículo aprobado) */
driver.post('/online', (req, res) => {
  const online = !!req.body?.online;
  const d = get('SELECT * FROM drivers WHERE id = ?', req.me.id);
  if (online) {
    if (!onboarding(d).canGoOnline) throw err(403, !d.verified || d.status !== 'active' ? 'Tu cuenta está pendiente de verificación' : 'Necesitas un vehículo aprobado para conectarte');
    const lat = Number(req.body?.lat), lng = Number(req.body?.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) run('UPDATE drivers SET lat = ?, lng = ?, location_at = ? WHERE id = ?', lat, lng, now(), d.id);
  }
  const busy = get("SELECT 1 FROM bookings WHERE driver_id = ? AND status IN ('accepted','arrived','started')", d.id);
  run('UPDATE drivers SET online = ?, available = ? WHERE id = ?', online ? 1 : 0, online && !busy ? 1 : 0, d.id);
  rt.toAdmins('driver:status', { id: d.id, online });
  res.json({ online });
});

/** Posición enviada por HTTP (servicio de ubicación en segundo plano del móvil, cuando el WebView está dormido) */
driver.post('/location', (req, res) => {
  if (!rt.driverLocation(req.me.id, req.body || {})) throw err(400, 'Posición no válida');
  res.json({ ok: true });
});

driver.get('/offers/:code', (req, res) => {
  const offer = dispatch.pendingOffer(req.me.id, req.params.code);
  if (!offer) throw err(404, 'La oferta ya no está disponible');
  res.json({ offer });
});
driver.post('/offers/:code/accept', (req, res) => {
  dispatch.accept(req.me.id, req.params.code);
  const b = trips.forDriver(req.params.code);
  rt.toCustomer(b.customer_id, 'booking:update', { code: b.code, status: 'accepted', message: `${b.driver?.name} va de camino` });
  rt.toAdmins('booking:update', { code: b.code, status: 'accepted' });
  res.json({ booking: b });
});
driver.post('/offers/:code/reject', (req, res) => { dispatch.reject(req.me.id, req.params.code); res.json({ success: true }); });

driver.post('/bookings/:code/arrived', (req, res) => { trips.arrived(req.me.id, req.params.code); res.json({ booking: trips.forDriver(req.params.code) }); });
driver.post('/bookings/:code/start', (req, res) => { trips.startTrip(req.me.id, req.params.code, req.body?.otp); res.json({ booking: trips.forDriver(req.params.code) }); });
driver.post('/bookings/:code/complete', (req, res) => { trips.complete(req.me.id, req.params.code); res.json({ booking: trips.forDriver(req.params.code) }); });
driver.post('/bookings/:code/cancel', (req, res) => { trips.cancelByDriver(req.me.id, req.params.code, req.body?.reason); res.json({ success: true }); });
driver.post('/bookings/:code/rate', (req, res) => { trips.rate('driver', req.me.id, req.params.code, req.body?.stars, req.body?.comment); res.json({ success: true }); });
driver.get('/bookings/:code', (req, res) => {
  const b = trips.forDriver(req.params.code);
  if (!b || b.driver_id !== req.me.id) throw err(404, 'Viaje no encontrado');
  res.json({ booking: b });
});
driver.get('/bookings', (req, res) => {
  res.json({ bookings: all(`SELECT b.code, b.status, b.pickup_address, b.dropoff_address, b.total_amount, b.driver_earning, b.currency,
    b.payment_method, b.created_at, b.completed_at, r.name AS ride_type FROM bookings b JOIN ride_types r ON r.id = b.ride_type_id
    WHERE b.driver_id = ? ORDER BY b.created_at DESC LIMIT 100`, req.me.id) });
});

driver.get('/wallet', (req, res) => {
  const w = wallet.ensureWallet('driver', req.me.id);
  res.json({ wallet: w, debt: get('SELECT debt FROM drivers WHERE id = ?', req.me.id).debt,
             transactions: all('SELECT id, type, amount, balance_after, description, created_at FROM wallet_transactions WHERE wallet_id = ? ORDER BY id DESC LIMIT 200', w.id),
             withdrawals: all('SELECT id, amount, method, status, note, created_at, processed_at FROM withdrawal_requests WHERE driver_id = ? ORDER BY id DESC LIMIT 50', req.me.id) });
});
driver.post('/withdrawals', (req, res) => {
  const amount = wallet.money(req.body?.amount);
  const w = wallet.ensureWallet('driver', req.me.id);
  const pending = get("SELECT coalesce(sum(amount),0) s FROM withdrawal_requests WHERE driver_id = ? AND status IN ('pending','approved')", req.me.id).s;
  if (!(amount > 0)) throw err(400, 'Importe no válido');
  if (amount > w.balance - pending) throw err(400, 'No tienes saldo suficiente para retirar esa cantidad');
  if (!String(req.body?.accountDetails || '').trim()) throw err(400, 'Indica la cuenta (IBAN) donde quieres recibirlo');
  run('INSERT INTO withdrawal_requests (driver_id, amount, method, account_details, status, created_at) VALUES (?,?,?,?,?,?)',
      req.me.id, amount, req.body?.method === 'cash_point' ? 'cash_point' : 'bank', String(req.body.accountDetails).slice(0, 200), 'pending', now());
  res.status(201).json({ success: true });
});

driver.get('/incentives', (req, res) => {
  const d = get('SELECT city_id FROM drivers WHERE id = ?', req.me.id);
  const list = all(`SELECT * FROM driver_incentives WHERE active = 1 AND status != 'finished' AND (city_id IS NULL OR city_id = ?) ORDER BY start_time`, d.city_id || 0);
  for (const i of list) {
    const from = i.start_time ? Date.parse(i.start_time) : 0, to = i.end_time ? Date.parse(i.end_time) : now();
    const s = get(`SELECT count(*) trips, coalesce(sum(driver_earning),0) earnings FROM bookings WHERE driver_id = ? AND status = 'completed'
                   AND completed_at BETWEEN ? AND ? AND (? IS NULL OR ride_type_id = ?)`, req.me.id, from, to, i.ride_type_id, i.ride_type_id);
    i.progress = i.type === 'earnings' ? s.earnings : s.trips;
  }
  res.json({ incentives: list });
});

driver.get('/cash-points', (req, res) => {
  const d = get('SELECT city_id FROM drivers WHERE id = ?', req.me.id);
  res.json({ points: all('SELECT * FROM cash_collection_points WHERE active = 1 AND (city_id IS NULL OR city_id = ?) ORDER BY name', d.city_id || 0) });
});

driver.get('/referrals', (req, res) => {
  res.json({ code: req.me.referral_code, settings: publicSettings().referral,
             earned: get("SELECT coalesce(sum(amount),0) s FROM referral_bonuses WHERE referrer_type = 'driver' AND referrer_id = ? AND status = 'paid'", req.me.id).s });
});

// ══ Soporte (cliente y conductor) ═══════════════════════════════════════════
const support = express.Router();
support.use((req, res, next) => (req.taxiRole ? requireRole(req.taxiRole)(req, res, next) : next(err(403, 'Primero elige cliente o conductor'))));
support.get('/tickets', (req, res) => res.json({ tickets: all('SELECT * FROM support_tickets WHERE owner_type = ? AND owner_id = ? ORDER BY id DESC', req.taxiRole, req.me.id) }));
support.post('/tickets', (req, res) => {
  const subject = String(req.body?.subject || '').trim(), message = String(req.body?.message || '').trim();
  if (!subject || !message) throw err(400, 'Escribe el asunto y el mensaje');
  const booking = req.body?.code ? get('SELECT id FROM bookings WHERE code = ?', req.body.code) : null;
  const id = tx(() => {
    const tid = Number(run('INSERT INTO support_tickets (number, owner_type, owner_id, booking_id, subject, category, status, priority, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      newCode('TK'), req.taxiRole, req.me.id, booking?.id || null, subject.slice(0, 200), req.body?.category || null, 'open', 'normal', now()).lastInsertRowid);
    run('INSERT INTO ticket_messages (ticket_id, sender_type, sender_id, message, created_at) VALUES (?,?,?,?,?)', tid, req.taxiRole, req.me.id, message.slice(0, 4000), now());
    return tid;
  });
  rt.toAdmins('ticket:new', { id });
  res.status(201).json({ ticket: get('SELECT * FROM support_tickets WHERE id = ?', id) });
});
support.get('/tickets/:id', (req, res) => {
  const t = get('SELECT * FROM support_tickets WHERE id = ? AND owner_type = ? AND owner_id = ?', req.params.id, req.taxiRole, req.me.id);
  if (!t) throw err(404, 'Ticket no encontrado');
  res.json({ ticket: t, messages: all('SELECT sender_type, message, attachment, created_at FROM ticket_messages WHERE ticket_id = ? ORDER BY id', t.id) });
});
support.post('/tickets/:id/messages', (req, res) => {
  const t = get('SELECT * FROM support_tickets WHERE id = ? AND owner_type = ? AND owner_id = ?', req.params.id, req.taxiRole, req.me.id);
  if (!t) throw err(404, 'Ticket no encontrado');
  const message = String(req.body?.message || '').trim();
  if (!message) throw err(400, 'Escribe un mensaje');
  run('INSERT INTO ticket_messages (ticket_id, sender_type, sender_id, message, created_at) VALUES (?,?,?,?,?)', t.id, req.taxiRole, req.me.id, message.slice(0, 4000), now());
  run("UPDATE support_tickets SET status = 'open' WHERE id = ?", t.id);
  res.status(201).json({ success: true });
});

router.use('/customer', customer);
router.use('/driver', driver);
router.use('/support', support);

// Errores en JSON
router.use((e, _req, res, _next) => {
  if (/UNIQUE constraint failed: ratings/i.test(e.message)) return res.status(409).json({ error: 'Ya has valorado este viaje' });
  if (/UNIQUE constraint/i.test(e.message)) return res.status(409).json({ error: 'Ya existe' });
  res.status(e.status || 500).json({ error: e.status ? e.message : 'Error interno' });
  if (!e.status) console.error('[app]', e);
});

module.exports = router;
