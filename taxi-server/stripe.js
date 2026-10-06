/**
 * stripe — pasarela del pago con TARJETA DE CRÉDITO (Stripe), sin librerías: llamadas directas a su API REST.
 *   Claves en el panel → Ajustes → Métodos de pago (payments.stripe). Modo "Pruebas" exige claves sk_test_/pk_test_
 *   y modo "Real" claves sk_live_/pk_live_ (así no se cobra de verdad por error).
 *   STRIPE_API_BASE permite apuntar a un Stripe simulado en las pruebas automáticas.
 */
const crypto = require('crypto');
const { getSetting } = require('./db');

const BASE = process.env.STRIPE_API_BASE || 'https://api.stripe.com';
const API_VERSION = '2024-06-20';
// Monedas sin decimales para Stripe (el importe se manda en unidades, no en céntimos)
const ZERO_DECIMAL = new Set(['BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF']);

const err = (status, message) => Object.assign(new Error(message), { status });
const cfg = () => getSetting('payments', {})?.stripe || {};
const isTestKey = (k) => /^(sk|pk|rk)_test_/.test(String(k || ''));

/** ¿Está activa y bien configurada? (claves presentes y coherentes con el modo elegido) */
function status() {
  const c = cfg();
  const sk = String(c.secretKey || ''), pk = String(c.publishableKey || '');
  const sandbox = (c.mode || 'sandbox') !== 'live';
  let problem = null;
  if (!sk || !pk) problem = 'Faltan las claves de la tarjeta de crédito';
  else if (sandbox && (!isTestKey(sk) || !isTestKey(pk))) problem = 'En modo pruebas las claves deben empezar por sk_test_ y pk_test_';
  else if (!sandbox && (isTestKey(sk) || isTestKey(pk))) problem = 'En modo real las claves deben ser sk_live_ y pk_live_';
  return { enabled: !!c.enabled, configured: !problem, ready: !!c.enabled && !problem, testMode: sandbox, problem,
           publishableKey: problem ? null : pk, webhook: !!c.webhookSecret };
}

const toUnits = (amount, currency) => (ZERO_DECIMAL.has(String(currency).toUpperCase()) ? Math.round(Number(amount)) : Math.round(Number(amount) * 100));
const fromUnits = (units, currency) => (ZERO_DECIMAL.has(String(currency).toUpperCase()) ? Number(units) : Number(units) / 100);

/** Objeto → application/x-www-form-urlencoded al estilo de Stripe (metadata[x]=…, lista[0]=…) */
function form(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') form(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}

async function api(method, path, params, { idempotencyKey } = {}) {
  const sk = cfg().secretKey;
  if (!sk) throw err(503, 'El pago con tarjeta de crédito no está configurado');
  const qs = method === 'GET' && params ? `?${form(params)}` : '';
  let res;
  try {
    res = await fetch(`${BASE}/v1${path}${qs}`, {
      method,
      headers: { Authorization: `Bearer ${sk}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Stripe-Version': API_VERSION,
                 ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
      body: method === 'GET' ? undefined : form(params || {}).toString(),
      signal: AbortSignal.timeout(20000),
    });
  } catch { throw err(502, 'No se pudo conectar con el pago con tarjeta. Inténtalo de nuevo.'); }
  const d = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) throw err(503, 'Las claves de la tarjeta de crédito no son válidas');
    throw Object.assign(err(res.status >= 500 ? 502 : 402, d.error?.message || 'El pago con tarjeta no se ha podido completar'), { stripe: d.error });
  }
  return d;
}

/** Cobro con tarjeta: capture 'manual' = solo reserva el importe (viajes); 'automatic' = cobra al confirmar (recargas) */
function createIntent({ amount, currency, capture = 'automatic', description, metadata, idempotencyKey }) {
  return api('POST', '/payment_intents', {
    amount: toUnits(amount, currency), currency: String(currency).toLowerCase(), capture_method: capture,
    payment_method_types: ['card'], description, metadata,
  }, { idempotencyKey });
}
const retrieve = (id) => api('GET', `/payment_intents/${encodeURIComponent(id)}`);
const capture = (id, amount, currency) => api('POST', `/payment_intents/${encodeURIComponent(id)}/capture`,
  amount === undefined ? {} : { amount_to_capture: toUnits(amount, currency) }, { idempotencyKey: `capture-${id}` });
const cancel = (id) => api('POST', `/payment_intents/${encodeURIComponent(id)}/cancel`, {}, { idempotencyKey: `cancel-${id}` });
const refund = (id, amount, currency) => api('POST', '/refunds', { payment_intent: id, ...(amount ? { amount: toUnits(amount, currency) } : {}) });

/** Comprobar las claves: saldo de la cuenta (y si es de pruebas o real) */
async function check() {
  const b = await api('GET', '/balance');
  return { livemode: !!b.livemode };
}

/** Crear (o rehacer) el webhook en la cuenta de Stripe apuntando a nuestra URL → devuelve su secreto de firma */
const WEBHOOK_EVENTS = ['payment_intent.amount_capturable_updated', 'payment_intent.succeeded', 'payment_intent.canceled', 'payment_intent.payment_failed'];
async function setupWebhook(url) {
  const list = await api('GET', '/webhook_endpoints', { limit: 100 });
  for (const w of list.data || []) if (w.url === url) await api('DELETE', `/webhook_endpoints/${w.id}`);
  const w = await api('POST', '/webhook_endpoints', { url, enabled_events: WEBHOOK_EVENTS, description: 'OldFace Taxi — tarjeta de crédito' });
  return { id: w.id, secret: w.secret };
}

/** Verifica la firma "Stripe-Signature" (t=…,v1=…) del aviso de Stripe → evento o null */
function verifyWebhook(rawBody, header, secret = cfg().webhookSecret, toleranceSec = 300) {
  if (!secret || !header || !Buffer.isBuffer(rawBody)) return null;
  const items = String(header).split(',').map(p => p.trim());
  const t = Number(items.find(p => p.startsWith('t='))?.slice(2));
  const sigs = items.filter(p => p.startsWith('v1=')).map(p => p.slice(3));
  if (!t || !sigs.length || Math.abs(Date.now() / 1000 - t) > toleranceSec) return null;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody.toString('utf8')}`).digest('hex');
  const ok = sigs.some(s => s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
  if (!ok) return null;
  try { return JSON.parse(rawBody.toString('utf8')); } catch { return null; }
}

module.exports = { status, createIntent, retrieve, capture, cancel, refund, check, setupWebhook, verifyWebhook, toUnits, fromUnits, WEBHOOK_EVENTS };
