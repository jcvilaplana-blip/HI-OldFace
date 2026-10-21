/**
 * stripe — pago con TARJETA DE CRÉDITO (Stripe) para la API de OldFace, sin librerías: llamadas directas a su API REST.
 * Misma cuenta de Stripe que el taxi, pero con sus claves en el .env de la API (nunca en el código ni en la app):
 *   STRIPE_SECRET_KEY (sk_…) · STRIPE_PUBLISHABLE_KEY (pk_…) · STRIPE_WEBHOOK_SECRET (whsec_…)
 *   STRIPE_API_BASE permite apuntar a un Stripe simulado en las pruebas automáticas.
 * Las claves de pruebas (sk_test_/pk_test_) cobran en modo pruebas; las reales (sk_live_/pk_live_), dinero de verdad.
 */
const crypto = require('crypto');

const API_VERSION = '2024-06-20';
const err = (status, message) => Object.assign(new Error(message), { status });
const cfg = () => ({
  base: process.env.STRIPE_API_BASE || 'https://api.stripe.com',
  sk: String(process.env.STRIPE_SECRET_KEY || '').trim(),
  pk: String(process.env.STRIPE_PUBLISHABLE_KEY || '').trim(),
  whsec: String(process.env.STRIPE_WEBHOOK_SECRET || '').trim(),
});
const isTestKey = (k) => /^(sk|pk|rk)_test_/.test(k);

/** ¿Está configurada? (las dos claves y del mismo modo) */
function status() {
  const { sk, pk, whsec } = cfg();
  let problem = null;
  if (!sk || !pk) problem = 'El pago con tarjeta no está configurado';
  else if (isTestKey(sk) !== isTestKey(pk)) problem = 'Las claves de la tarjeta de crédito no son del mismo modo';
  return { ready: !problem, problem, testMode: isTestKey(sk), publishableKey: problem ? null : pk, webhook: !!whsec };
}

const toCents = (amount) => Math.round(Number(amount) * 100);

/** Objeto → application/x-www-form-urlencoded al estilo de Stripe (metadata[x]=…) */
function form(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') form(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}

async function api(method, p, params, { idempotencyKey } = {}) {
  const { base, sk } = cfg();
  if (!sk) throw err(503, 'El pago con tarjeta no está configurado');
  let res;
  try {
    res = await fetch(`${base}/v1${p}`, {
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
    throw err(res.status >= 500 ? 502 : 402, d.error?.message || 'El pago con tarjeta no se ha podido completar');
  }
  return d;
}

/** Cobro inmediato con tarjeta (se cobra al confirmar la tarjeta en la app) */
const createIntent = ({ amount, currency = 'eur', description, metadata, idempotencyKey }) => api('POST', '/payment_intents', {
  amount: toCents(amount), currency: String(currency).toLowerCase(), capture_method: 'automatic',
  payment_method_types: ['card'], description, metadata,
}, { idempotencyKey });
const retrieve = (id) => api('GET', `/payment_intents/${encodeURIComponent(id)}`);
const refund = (id) => api('POST', '/refunds', { payment_intent: id }, { idempotencyKey: `refund-${id}` });

/** Verifica la firma "Stripe-Signature" (t=…,v1=…) del aviso de Stripe → evento o null */
function verifyWebhook(rawBody, header, toleranceSec = 300) {
  const secret = cfg().whsec;
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

module.exports = { status, createIntent, retrieve, refund, verifyWebhook };
