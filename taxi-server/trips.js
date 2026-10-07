/**
 * trips — ciclo de vida del viaje y su dinero.
 *
 *   accepted → arrived ("He llegado") → started (con el código de 4 cifras del cliente) → completed
 *   Cancelaciones: cliente (con la política de cancelación) o conductor (se vuelve a buscar otro).
 *
 * Al completar (precio cerrado calculado al pedir):
 *   comisión = (total − impuesto) × % del tipo de viaje;  ganancia del conductor = total − impuesto − comisión
 *   · Efectivo: el conductor cobra todo → debe comisión + impuesto (deuda en su monedero).
 *   · Monedero: se descuenta al cliente y se abona la ganancia al conductor.
 *   · Stripe:   el cobro lo confirma el webhook de Stripe (fase de pagos).
 *   + factura, uso de la promoción, bonos de invitación en el primer viaje, valoraciones.
 */
const { all, get, run, tx, now, getSetting } = require('./db');
const wallet = require('./wallet');
const rt = require('./realtime');
const dispatch = require('./dispatch');

const money = wallet.money;
const err = (status, message) => Object.assign(new Error(message), { status });
const ACTIVE = ['accepted', 'arrived', 'started'];

/** Reserva con los datos que necesita cada app (sin teléfonos: se llaman por OldFace) */
function view(code) {
  const b = get('SELECT * FROM bookings WHERE code = ?', code);
  if (!b) return null;
  const rtype = get('SELECT id, name, code, app_icon, map_icon, seats FROM ride_types WHERE id = ?', b.ride_type_id);
  const driver = b.driver_id ? get('SELECT id, user_id, name, photo, rating, rating_count, lat, lng, heading, location_at FROM drivers WHERE id = ?', b.driver_id) : null;
  const vehicle = b.vehicle_id ? get('SELECT brand, model, color, plate, photo FROM vehicles WHERE id = ?', b.vehicle_id) : null;
  const customer = get('SELECT id, user_id, name, photo, rating FROM customers WHERE id = ?', b.customer_id);
  const ratings = all('SELECT from_type, stars, comment FROM ratings WHERE booking_id = ?', b.id);
  return { ...b, rideType: rtype, driver, vehicle, customer, ratings };
}

/** Lo que ve el cliente (incluye el código para empezar) / el conductor (sin el código) */
const forCustomer = (code) => view(code);
const forDriver = (code) => { const v = view(code); if (v) delete v.start_otp; return v; };

function notify(b, extra = {}) {
  const payload = { code: b.code, status: b.status, ...extra };
  rt.toCustomer(b.customer_id, 'booking:update', payload);
  if (b.driver_id) rt.toDriver(b.driver_id, 'booking:update', payload);
  rt.toAdmins('booking:update', payload);
}

function own(code, driverId) {
  const b = get('SELECT * FROM bookings WHERE code = ?', code);
  if (!b || b.driver_id !== driverId) throw err(404, 'Viaje no encontrado');
  return b;
}

// ── Conductor ─────────────────────────────────────────────────────────────────
function arrived(driverId, code) {
  const b = own(code, driverId);
  if (b.status !== 'accepted') throw err(409, 'El viaje no está en camino a la recogida');
  run("UPDATE bookings SET status = 'arrived', arrived_at = ? WHERE id = ?", now(), b.id);
  dispatch.logEvent(b.id, 'arrived');
  notify({ ...b, status: 'arrived' }, { message: 'Tu conductor ha llegado' });
}

function startTrip(driverId, code, otp) {
  const b = own(code, driverId);
  if (b.status !== 'arrived') throw err(409, 'Primero indica que has llegado al punto de recogida');
  if (getSetting('booking', {}).otpRequired !== false && String(otp || '').trim() !== b.start_otp) throw err(400, 'Código incorrecto. Pídeselo al cliente.');
  run("UPDATE bookings SET status = 'started', started_at = ? WHERE id = ?", now(), b.id);
  dispatch.logEvent(b.id, 'started');
  notify({ ...b, status: 'started' }, { message: 'Viaje iniciado' });
}

function complete(driverId, code) {
  const result = tx(() => {
    const b = own(code, driverId);
    if (b.status !== 'started') throw err(409, 'El viaje no está en curso');
    const rtype = get('SELECT * FROM ride_types WHERE id = ?', b.ride_type_id);
    const total = money(b.total_amount ?? b.estimated_fare);
    const tax = money(b.tax_amount);
    const commission = money((total - tax) * (Number(rtype?.commission_rate) || 0) / 100);
    const earning = money(total - tax - commission);
    let paymentStatus = 'pending', debt = 0;

    if (b.payment_method === 'cash') {
      paymentStatus = 'paid';                       // el conductor cobra en mano
      debt = money(commission + tax);
      if (debt > 0) {
        wallet.debit('driver', driverId, debt, `Comisión e impuestos del viaje ${b.code} (efectivo)`, { refType: 'booking', refId: b.id, allowNegative: true });
        run('UPDATE drivers SET debt = round(debt + ?, 2) WHERE id = ?', debt, driverId);
      }
    } else if (b.payment_method === 'wallet') {
      try {
        wallet.debit('customer', b.customer_id, total, `Pago del viaje ${b.code}`, { refType: 'booking', refId: b.id });
        wallet.credit('driver', driverId, earning, `Ganancia del viaje ${b.code}`, { refType: 'booking', refId: b.id });
        paymentStatus = 'paid';
      } catch {
        paymentStatus = 'failed';                     // sin saldo: queda pendiente de cobro
      }
    }

    run(`UPDATE bookings SET status = 'completed', completed_at = ?, total_amount = ?, commission_amount = ?, driver_earning = ?,
         payment_status = ? WHERE id = ?`, now(), total, commission, earning, paymentStatus, b.id);
    run('UPDATE drivers SET available = CASE WHEN online = 1 THEN 1 ELSE 0 END WHERE id = ?', driverId);
    run('INSERT INTO commissions (booking_id, driver_id, service, fare, commission, tax, debt_amount, driver_earning, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
        b.id, driverId, rtype?.name, total, commission, tax, debt, earning, now());
    const d = new Date();
    run(`INSERT INTO invoices (number, booking_id, customer_id, driver_id, invoice_date, amount, driver_amount, platform_commission, tax, currency, payment_method, payment_status)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        `F${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}-${String(b.id).padStart(6, '0')}`,
        b.id, b.customer_id, driverId, now(), total, earning, commission, tax, b.currency, b.payment_method, paymentStatus);
    if (b.promo_code_id) {
      run('INSERT INTO promo_uses (promo_id, customer_id, booking_id, discount, created_at) VALUES (?,?,?,?,?)', b.promo_code_id, b.customer_id, b.id, b.discount, now());
      run('UPDATE promo_codes SET used = used + 1 WHERE id = ?', b.promo_code_id);
    }
    referralBonus('customer', b.customer_id);
    referralBonus('driver', driverId);
    dispatch.logEvent(b.id, 'completed', { total, commission, earning, paymentStatus });
    return { ...b, status: 'completed', paymentStatus, total };
  });
  notify(result, { message: 'Viaje finalizado', total: result.total, paymentStatus: result.paymentStatus });
  // Tarjeta de crédito: se cobra lo reservado y se abona la ganancia al conductor (en segundo plano)
  if (result.payment_method === 'stripe') require('./cardpay').captureBooking(result.id);
  return result;
}

/** Dueño de un código de invitación → ['customer'|'driver', id] */
function referralOwner(code) {
  const c = get('SELECT id FROM customers WHERE referral_code = ?', code);
  if (c) return ['customer', c.id];
  const d = get('SELECT id FROM drivers WHERE referral_code = ?', code);
  return d ? ['driver', d.id] : null;
}

/**
 * Bonos de invitación al completar el PRIMER viaje del invitado (cliente o conductor).
 * Importes del panel: el de quien invita depende de SU rol (userReferrer / driverReferrer) y
 * el del invitado del rol del invitado (userReferred / driverReferred).
 */
function referralBonus(type, id) {
  const me = get(`SELECT referred_by FROM ${type === 'driver' ? 'drivers' : 'customers'} WHERE id = ?`, id);
  if (!me?.referred_by) return;
  if (get(`SELECT count(*) n FROM bookings WHERE ${type === 'driver' ? 'driver_id' : 'customer_id'} = ? AND status = 'completed'`, id).n !== 1) return;
  if (get('SELECT 1 FROM referral_bonuses WHERE referred_type = ? AND referred_id = ?', type, id)) return;
  const owner = referralOwner(me.referred_by);
  if (!owner) return;
  const cfg = getSetting('referral', {});
  const forReferrer = Number(owner[0] === 'driver' ? cfg.driverReferrer : cfg.userReferrer) || 0;
  const forReferred = Number(type === 'driver' ? cfg.driverReferred : cfg.userReferred) || 0;
  const t = now();
  const add = (bonusFor, toType, toId, amount, text) => {
    if (!(amount > 0)) return;
    wallet.credit(toType, toId, amount, text, { refType: 'referral', refId: id });
    run('INSERT INTO referral_bonuses (referrer_type, referrer_id, referred_type, referred_id, type, amount, status, created_at, paid_at) VALUES (?,?,?,?,?,?,?,?,?)',
        owner[0], owner[1], type, id, bonusFor, amount, 'paid', t, t);
  };
  add('referrer', owner[0], owner[1], forReferrer, 'Bono por invitar a un amigo');
  add('referred', type, id, forReferred, 'Bono de bienvenida por invitación');
}

// ── Cancelaciones ────────────────────────────────────────────────────────────
/** Cargo por cancelar del cliente según la política (ventana gratuita, fijo y/o %) */
function cancelFee(b) {
  if (!['accepted', 'arrived'].includes(b.status) || !b.accepted_at) return 0;
  const p = get(`SELECT * FROM cancellation_policies WHERE active = 1 AND applies_to = 'customer'
                 AND (city_id IS NULL OR city_id = ?) AND (ride_type_id IS NULL OR ride_type_id = ?)
                 ORDER BY (city_id IS NOT NULL) + (ride_type_id IS NOT NULL) DESC LIMIT 1`, b.city_id || 0, b.ride_type_id);
  if (!p) return 0;
  if (now() - b.accepted_at <= p.free_window_min * 60000) return 0;
  return money(Number(p.fixed_fee || 0) + Number(b.estimated_fare || 0) * Number(p.fee_percent || 0) / 100);
}

function cancelByCustomer(customerId, code, reason) {
  const out = tx(() => {
    const b = get('SELECT * FROM bookings WHERE code = ? AND customer_id = ?', code, customerId);
    if (!b) throw err(404, 'Viaje no encontrado');
    if (!['awaiting_payment', 'searching', 'accepted', 'arrived'].includes(b.status)) throw err(409, b.status === 'started' ? 'El viaje ya ha empezado' : 'Este viaje ya no se puede cancelar');
    const fee = cancelFee(b);
    if (fee > 0) {
      // Con tarjeta de crédito el gasto se cobra de la reserva de la tarjeta (después de la transacción); si no, del monedero
      if (b.payment_method !== 'stripe') wallet.debit('customer', customerId, fee, `Cargo por cancelación del viaje ${b.code}`, { refType: 'booking', refId: b.id, allowNegative: true });
      if (b.driver_id) wallet.credit('driver', b.driver_id, fee, `Compensación por cancelación del viaje ${b.code}`, { refType: 'booking', refId: b.id });
    }
    run("UPDATE bookings SET status = 'cancelled', cancelled_by = 'customer', cancel_reason = ?, cancel_fee = ?, cancelled_at = ? WHERE id = ?",
        String(reason || '').slice(0, 300) || null, fee, now(), b.id);
    dispatch.expireOffers(b);
    if (b.driver_id) run('UPDATE drivers SET available = CASE WHEN online = 1 THEN 1 ELSE 0 END WHERE id = ?', b.driver_id);
    dispatch.clear(b.id);
    dispatch.logEvent(b.id, 'cancelled', { by: 'customer', fee });
    return { ...b, status: 'cancelled', fee };
  });
  notify(out, { message: 'El cliente ha cancelado el viaje', cancelledBy: 'customer', fee: out.fee });
  if (out.payment_method === 'stripe') require('./cardpay').settleCancelled(out.id, out.fee);
  return out;
}

function cancelByDriver(driverId, code, reason) {
  const b = own(code, driverId);
  if (!['accepted', 'arrived'].includes(b.status)) throw err(409, 'Este viaje ya no se puede cancelar');
  run('UPDATE drivers SET available = CASE WHEN online = 1 THEN 1 ELSE 0 END WHERE id = ?', driverId);
  dispatch.logEvent(b.id, 'driver_cancelled', { driverId, reason: String(reason || '').slice(0, 300) });
  rt.toDriver(driverId, 'booking:update', { code: b.code, status: 'cancelled', cancelledBy: 'driver' });
  rt.toCustomer(b.customer_id, 'booking:update', { code: b.code, status: 'searching', message: 'Tu conductor ha cancelado. Buscando otro conductor…' });
  dispatch.restart(b.id);
}

// ── Valoraciones ─────────────────────────────────────────────────────────────
function rate(fromType, fromId, code, stars, comment) {
  const b = get('SELECT * FROM bookings WHERE code = ?', code);
  const mine = b && (fromType === 'customer' ? b.customer_id === fromId : b.driver_id === fromId);
  if (!mine) throw err(404, 'Viaje no encontrado');
  if (b.status !== 'completed') throw err(409, 'Solo se pueden valorar viajes completados');
  stars = Math.round(Number(stars));
  if (!(stars >= 1 && stars <= 5)) throw err(400, 'La valoración debe ser de 1 a 5 estrellas');
  const toType = fromType === 'customer' ? 'driver' : 'customer';
  const toId = fromType === 'customer' ? b.driver_id : b.customer_id;
  tx(() => {
    run('INSERT INTO ratings (booking_id, from_type, from_id, to_type, to_id, stars, comment, created_at) VALUES (?,?,?,?,?,?,?,?)',
        b.id, fromType, fromId, toType, toId, stars, String(comment || '').slice(0, 500) || null, now());
    const agg = get('SELECT avg(stars) a, count(*) n FROM ratings WHERE to_type = ? AND to_id = ?', toType, toId);
    run(`UPDATE ${toType === 'driver' ? 'drivers' : 'customers'} SET rating = ?, rating_count = ? WHERE id = ?`, Math.round(agg.a * 10) / 10, agg.n, toId);
  });
}

module.exports = { view, forCustomer, forDriver, arrived, startTrip, complete, cancelByCustomer, cancelByDriver, cancelFee, rate, ACTIVE };
