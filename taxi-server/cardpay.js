/**
 * cardpay — pago con TARJETA DE CRÉDITO en el taxi (como Uber):
 *   · Pedir viaje → se RESERVA el precio cerrado en la tarjeta (el viaje queda "esperando pago" hasta que el cliente
 *     confirma la tarjeta en la app; entonces empieza la búsqueda de conductor).
 *   · Fin del viaje → se COBRA lo reservado y la ganancia del conductor va a su monedero.
 *   · Cancelación → se libera la reserva o se cobra solo el gasto de cancelación. Sin conductores → se libera.
 *   · Recarga del monedero del cliente con tarjeta.
 * Cada cobro queda en card_payments; el webhook de Stripe confirma lo mismo por si la app se cierra a mitad.
 */
const { all, get, run, tx, now } = require('./db');
const stripe = require('./stripe');
const wallet = require('./wallet');

const err = (status, message) => Object.assign(new Error(message), { status });
const money = wallet.money;
const lazy = (m) => require(m);                     // dispatch/realtime se cargan al usarlos (evita dependencias circulares)

const TOPUP_MIN = 5, TOPUP_MAX = 500;

// ── Viajes ───────────────────────────────────────────────────────────────────
/** Reserva el importe del viaje (booking en estado 'awaiting_payment') → datos para confirmar la tarjeta en la app */
async function startBooking(b) {
  const pi = await stripe.createIntent({
    amount: b.estimated_fare, currency: b.currency, capture: 'manual',
    description: `Viaje ${b.code} · OldFace Taxi`, metadata: { kind: 'booking', booking: b.code }, idempotencyKey: `booking-${b.code}`,
  });
  run(`INSERT INTO card_payments (intent_id, kind, owner_type, owner_id, booking_id, amount, currency, status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(intent_id) DO NOTHING`,
      pi.id, 'booking', 'customer', b.customer_id, b.id, money(b.estimated_fare), b.currency, 'created', now(), now());
  run('UPDATE bookings SET payment_ref = ? WHERE id = ?', pi.id, b.id);
  return { intentId: pi.id, clientSecret: pi.client_secret };
}

/** Tarjeta autorizada → el viaje pasa a buscar conductor (idempotente: app y webhook pueden llegar los dos) */
function markAuthorized(bookingId) {
  const changed = tx(() => {
    const r = run("UPDATE bookings SET status = 'searching', payment_status = 'authorized' WHERE id = ? AND status = 'awaiting_payment'", bookingId);
    run("UPDATE card_payments SET status = 'authorized', updated_at = ? WHERE booking_id = ? AND kind = 'booking' AND status = 'created'", now(), bookingId);
    return r.changes;
  });
  if (changed) {
    const b = get('SELECT code FROM bookings WHERE id = ?', bookingId);
    const dispatch = lazy('./dispatch');
    dispatch.logEvent(bookingId, 'card_authorized');
    dispatch.start(bookingId);
    lazy('./realtime').toAdmins('booking:update', { code: b.code, status: 'searching' });
  }
  return !!changed;
}

/** La app avisa de que la tarjeta se ha confirmado: se comprueba con Stripe (nunca nos fiamos solo de la app) */
async function confirmBooking(b) {
  if (b.status !== 'awaiting_payment') return;
  if (!b.payment_ref) throw err(409, 'Este viaje no tiene un pago con tarjeta pendiente');
  const pi = await stripe.retrieve(b.payment_ref);
  if (!['requires_capture', 'succeeded'].includes(pi.status)) throw err(402, 'La tarjeta no se ha confirmado. Inténtalo de nuevo.');
  markAuthorized(b.id);
}

const paymentOf = (bookingId) => get("SELECT * FROM card_payments WHERE booking_id = ? AND kind = 'booking' ORDER BY id DESC LIMIT 1", bookingId);

/** Fin del viaje: cobrar lo reservado y abonar la ganancia al conductor */
async function captureBooking(bookingId) {
  const b = get('SELECT * FROM bookings WHERE id = ?', bookingId);
  const cp = paymentOf(bookingId);
  if (!b || !cp || cp.status !== 'authorized') return;
  const amount = money(Math.min(Number(b.total_amount ?? b.estimated_fare), cp.amount));
  try {
    await stripe.capture(cp.intent_id, amount, cp.currency);
    tx(() => {
      run("UPDATE card_payments SET status = 'succeeded', captured = ?, updated_at = ? WHERE id = ?", amount, now(), cp.id);
      run("UPDATE bookings SET payment_status = 'paid' WHERE id = ?", b.id);
      run("UPDATE invoices SET payment_status = 'paid' WHERE booking_id = ?", b.id);
      if (b.driver_id && b.driver_earning > 0) {
        wallet.credit('driver', b.driver_id, b.driver_earning, `Ganancia del viaje ${b.code} (tarjeta de crédito)`, { refType: 'booking', refId: b.id });
      }
    });
    lazy('./dispatch').logEvent(b.id, 'card_captured', { amount });
  } catch (e) {
    run("UPDATE bookings SET payment_status = 'failed' WHERE id = ?", b.id);
    run("UPDATE card_payments SET status = 'failed', updated_at = ? WHERE id = ?", now(), cp.id);
    lazy('./dispatch').logEvent(b.id, 'card_capture_failed', { error: e.message });
    console.error('[tarjeta] no se pudo cobrar el viaje', b.code, e.message);
  }
}

/** Cancelación o sin conductores: cobrar solo el gasto de cancelación (si hay) o liberar la reserva */
async function settleCancelled(bookingId, fee = 0) {
  const cp = paymentOf(bookingId);
  if (!cp || !['created', 'authorized'].includes(cp.status)) return;
  try {
    if (fee > 0 && cp.status === 'authorized') {
      const amount = money(Math.min(fee, cp.amount));
      await stripe.capture(cp.intent_id, amount, cp.currency);
      run("UPDATE card_payments SET status = 'succeeded', captured = ?, updated_at = ? WHERE id = ?", amount, now(), cp.id);
      run("UPDATE bookings SET payment_status = 'paid' WHERE id = ?", bookingId);
    } else {
      await stripe.cancel(cp.intent_id);
      run("UPDATE card_payments SET status = 'canceled', updated_at = ? WHERE id = ?", now(), cp.id);
      run("UPDATE bookings SET payment_status = 'released' WHERE id = ?", bookingId);
    }
  } catch (e) {
    console.error('[tarjeta] no se pudo liquidar la cancelación', bookingId, e.message);
  }
}

/** Viajes que se quedaron esperando la tarjeta (el cliente cerró la ventana): se anulan al pedir otro */
function dropAbandoned(customerId) {
  for (const b of all("SELECT id FROM bookings WHERE customer_id = ? AND status = 'awaiting_payment'", customerId)) {
    run("UPDATE bookings SET status = 'cancelled', cancelled_by = 'customer', cancel_reason = 'Pago con tarjeta no completado', cancelled_at = ? WHERE id = ? AND status = 'awaiting_payment'", now(), b.id);
    settleCancelled(b.id, 0);
  }
}

// ── Recargas del monedero ────────────────────────────────────────────────────
async function startTopup(customerId, amount) {
  amount = money(amount);
  if (!(amount >= TOPUP_MIN && amount <= TOPUP_MAX)) throw err(400, `La recarga debe ser de ${TOPUP_MIN} a ${TOPUP_MAX}`);
  const w = wallet.ensureWallet('customer', customerId);
  const pi = await stripe.createIntent({ amount, currency: w.currency, capture: 'automatic', description: 'Recarga del monedero · OldFace Taxi',
                                         metadata: { kind: 'topup', customer: String(customerId) } });
  run(`INSERT INTO card_payments (intent_id, kind, owner_type, owner_id, amount, currency, status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)`, pi.id, 'topup', 'customer', customerId, amount, w.currency, 'created', now(), now());
  return { intentId: pi.id, clientSecret: pi.client_secret, amount, currency: w.currency };
}

/** Abona la recarga una sola vez (app y webhook pueden llegar los dos) */
function applyTopup(intentId) {
  return tx(() => {
    const r = run("UPDATE card_payments SET status = 'succeeded', captured = amount, updated_at = ? WHERE intent_id = ? AND kind = 'topup' AND status != 'succeeded'", now(), intentId);
    if (!r.changes) return false;
    const cp = get('SELECT * FROM card_payments WHERE intent_id = ?', intentId);
    wallet.credit('customer', cp.owner_id, cp.amount, 'Recarga con tarjeta de crédito', { refType: 'card_payment', refId: cp.id });
    return true;
  });
}

async function confirmTopup(customerId, intentId) {
  const cp = get("SELECT * FROM card_payments WHERE intent_id = ? AND kind = 'topup' AND owner_id = ?", String(intentId || ''), customerId);
  if (!cp) throw err(404, 'Recarga no encontrada');
  if (cp.status === 'succeeded') return;
  const pi = await stripe.retrieve(cp.intent_id);
  if (pi.status !== 'succeeded') throw err(402, 'La tarjeta no se ha confirmado. Inténtalo de nuevo.');
  applyTopup(cp.intent_id);
}

// ── Avisos de Stripe (webhook) ───────────────────────────────────────────────
function webhook(req, res) {
  const ev = stripe.verifyWebhook(req.body, req.headers['stripe-signature']);
  if (!ev) return res.status(400).json({ error: 'Firma no válida' });
  const pi = ev.data?.object || {};
  const cp = pi.id ? get('SELECT * FROM card_payments WHERE intent_id = ?', pi.id) : null;
  try {
    if (cp && ev.type === 'payment_intent.amount_capturable_updated' && cp.kind === 'booking') markAuthorized(cp.booking_id);
    else if (cp && ev.type === 'payment_intent.succeeded' && cp.kind === 'topup') applyTopup(cp.intent_id);
    else if (cp && ev.type === 'payment_intent.canceled') run("UPDATE card_payments SET status = 'canceled', updated_at = ? WHERE id = ? AND status IN ('created','authorized')", now(), cp.id);
    else if (cp && ev.type === 'payment_intent.payment_failed') run("UPDATE card_payments SET status = 'failed', updated_at = ? WHERE id = ? AND status = 'created'", now(), cp.id);
  } catch (e) { console.error('[tarjeta] webhook', ev.type, e.message); }
  res.json({ received: true });
}

module.exports = { startBooking, confirmBooking, markAuthorized, captureBooking, settleCancelled, dropAbandoned, startTopup, confirmTopup, applyTopup, webhook, TOPUP_MIN, TOPUP_MAX };
