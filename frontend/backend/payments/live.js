/**
 * Directos de pago — pases, cobros con tarjeta (Stripe), códigos de promoción, ganancias del emisor y retiradas.
 *
 * Reglas (decididas 2026-10-21):
 *   · Un directo con precio solo lo ve (en vivo o grabado) el contacto que tiene PASE: lo ha pagado con tarjeta o ha
 *     canjeado un código del emisor. Un pase vale para el directo y para su grabación (clave: directoId).
 *   · OldFace se queda LIVE_FEE_PERCENT (20 % por defecto); el resto va al saldo del emisor, que pide la retirada a su
 *     cuenta bancaria y el administrador la marca como pagada (o la rechaza y el dinero vuelve al saldo).
 *   · Códigos personales de un solo uso; solo los puede canjear un contacto que ya puede ver el directo.
 * Quién puede ver qué (contactos) lo decide server.js con getTarget(); aquí solo se mira el pase.
 * Datos: data/live_passes.json · live_payments.json · live_codes.json · live_earnings.json · live_withdrawals.json
 * La cuenta bancaria de las retiradas se guarda CIFRADA (AES-256-GCM, clave derivada de RTC_SECRET).
 */
const crypto = require('crypto');
const stripe = require('./stripe');

const MIN_PRICE = 1, MAX_PRICE = 200, MIN_WITHDRAWAL = 10;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const money = (n) => Math.round(Number(n) * 100) / 100;

module.exports = function livePayments({ router, authUser, requireSession, adminAuth, loadJSON, saveJSON, secret,
                                         findUserById, getTarget, notify = () => {} }) {
  const FEE = Math.min(90, Math.max(0, Number(process.env.LIVE_FEE_PERCENT ?? 20)));
  const store = (file) => {
    const map = new Map(Object.entries(loadJSON(file, {})));
    return { map, save: () => saveJSON(file, Object.fromEntries(map)) };
  };
  const passes = store('live_passes.json');           // `${directoId}|${userId}` → { directoId, userId, via, ref, at }
  const payments = store('live_payments.json');       // pay_… → { id, intentId, directoId, ownerId, buyerId, amount, fee, net, status, … }
  const codes = store('live_codes.json');             // CÓDIGO → { code, directoId, ownerId, createdAt, usedBy, usedAt }
  const earnings = store('live_earnings.json');       // ownerId → { balance, earned, withdrawn, moves: [] }
  const withdrawals = store('live_withdrawals.json'); // wd_… → { id, ownerId, amount, holder, account (cifrada), status, … }

  const passKey = (directoId, userId) => `${directoId}|${userId}`;
  const hasPass = (directoId, userId) => passes.map.has(passKey(directoId, userId));
  function grantPass(directoId, userId, via, ref) {
    if (hasPass(directoId, userId)) return false;
    passes.map.set(passKey(directoId, userId), { directoId, userId, via, ref, at: Date.now() });
    passes.save();
    return true;
  }

  // ── Saldo del emisor ──
  const earningOf = (ownerId) => earnings.map.get(ownerId) || { balance: 0, earned: 0, withdrawn: 0, moves: [] };
  function move(ownerId, amount, kind, ref, text) {
    const e = earningOf(ownerId);
    e.balance = money(e.balance + amount);
    if (kind === 'sale' || kind === 'refund') e.earned = money(e.earned + amount);
    if (kind === 'withdrawal') e.withdrawn = money(e.withdrawn - amount);
    if (kind === 'withdrawal_back') e.withdrawn = money(e.withdrawn - amount);
    e.moves = [{ at: Date.now(), amount: money(amount), kind, ref, text }, ...(e.moves || [])].slice(0, 300);
    earnings.map.set(ownerId, e);
    earnings.save();
  }

  // ── Cifrado de la cuenta bancaria ──
  const KEY = crypto.createHash('sha256').update(`oldface-live-account:${secret || ''}`).digest();
  const encrypt = (text) => {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
    const data = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
    return `v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${data.toString('base64')}`;
  };
  const decrypt = (blob) => {
    try {
      const [, iv, tag, data] = String(blob).split(':');
      const d = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(iv, 'base64'));
      d.setAuthTag(Buffer.from(tag, 'base64'));
      return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
    } catch { return null; }
  };
  const cleanIban = (s) => String(s || '').replace(/\s+/g, '').toUpperCase();
  function validIban(iban) {
    if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
    const n = (iban.slice(4) + iban.slice(0, 4)).replace(/[A-Z]/g, ch => String(ch.charCodeAt(0) - 55));
    let r = 0;
    for (const d of n) r = (r * 10 + Number(d)) % 97;
    return r === 1;
  }
  const maskIban = (iban) => (iban ? `${iban.slice(0, 4)} •••• ${iban.slice(-4)}` : '');

  // ── Pagos ──
  /** Cobro confirmado (la app y el aviso de Stripe pueden llegar los dos: solo cuenta una vez) */
  function applyPayment(p) {
    if (!p || p.status === 'succeeded' || p.status === 'refunded') return false;
    p.status = 'succeeded'; p.paidAt = Date.now(); p.updatedAt = Date.now();
    payments.map.set(p.id, p); payments.save();
    grantPass(p.directoId, p.buyerId, 'card', p.id);
    const buyer = findUserById(p.buyerId)?.name || 'Alguien';
    move(p.ownerId, p.net, 'sale', p.id, `${buyer} · ${p.title || 'Directo'}`);
    try { notify(p.ownerId, `💶 ${buyer} ha pagado tu directo`, `${p.title || 'Directo'} · +${p.net.toFixed(2)} €`); } catch { /* sin avisos */ }
    return true;
  }
  const paymentByIntent = (intentId) => [...payments.map.values()].find(p => p.intentId === intentId) || null;

  /** Destino del pago o del código → { directoId, ownerId, price, title } si el usuario puede verlo (contacto) */
  function target(req, res, userId) {
    const kind = req.body?.kind === 'recording' ? 'recording' : 'directo';
    const t = getTarget(kind, String(req.body?.id || ''), userId);
    if (!t) { res.status(404).json({ error: 'Directo no encontrado' }); return null; }
    return t;
  }

  /** GET /directos/pay/config?userId= — ¿se puede pagar con tarjeta? (clave pública, modo pruebas, comisión) */
  router.get('/directos/pay/config', (req, res) => {
    if (!authUser(req, res, req.query.userId)) return;
    const s = stripe.status();
    res.json({ ready: s.ready, testMode: s.testMode, publishableKey: s.publishableKey, feePercent: FEE, minPrice: MIN_PRICE, maxPrice: MAX_PRICE });
  });

  /** POST /directos/pay — { userId, kind: 'directo'|'recording', id } empieza el pago con tarjeta (Bearer) */
  router.post('/directos/pay', async (req, res) => {
    const userId = requireSession(req, res);
    if (!userId) return;
    const t = target(req, res, userId);
    if (!t) return;
    if (t.ownerId === userId || !(t.price > 0) || hasPass(t.directoId, userId)) return res.json({ already: true });
    const s = stripe.status();
    if (!s.ready) return res.status(503).json({ error: s.problem });
    const amount = money(t.price);
    const fee = money(amount * FEE / 100);
    const p = {
      id: `pay_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`, intentId: null,
      directoId: t.directoId, ownerId: t.ownerId, buyerId: userId, title: t.title,
      amount, currency: 'EUR', fee, net: money(amount - fee), status: 'created', createdAt: Date.now(), updatedAt: Date.now(),
    };
    try {
      const pi = await stripe.createIntent({ amount, currency: 'eur', description: `Directo · ${t.title || 'OldFace'}`.slice(0, 200),
        metadata: { app: 'oldface-live', payment: p.id, directo: t.directoId }, idempotencyKey: p.id });
      p.intentId = pi.id;
      payments.map.set(p.id, p); payments.save();
      res.json({ paymentId: p.id, clientSecret: pi.client_secret, publishableKey: s.publishableKey, testMode: s.testMode, amount, currency: 'EUR' });
    } catch (e) { res.status(e.status || 502).json({ error: e.message }); }
  });

  /** POST /directos/pay/confirm — { userId, paymentId } la app avisa; se comprueba SIEMPRE con Stripe (Bearer) */
  router.post('/directos/pay/confirm', async (req, res) => {
    const userId = requireSession(req, res);
    if (!userId) return;
    const p = payments.map.get(String(req.body?.paymentId || ''));
    if (!p || p.buyerId !== userId) return res.status(404).json({ error: 'Pago no encontrado' });
    if (p.status === 'succeeded') return res.json({ ok: true });
    try {
      const pi = await stripe.retrieve(p.intentId);
      if (pi.status !== 'succeeded') return res.status(402).json({ error: 'La tarjeta no se ha confirmado. Inténtalo de nuevo.' });
      applyPayment(p);
      res.json({ ok: true });
    } catch (e) { res.status(e.status || 502).json({ error: e.message }); }
  });

  /** POST /payments/stripe/webhook — avisos de Stripe (firma verificada; ignora los cobros que no son nuestros, p. ej. del taxi) */
  router.post('/payments/stripe/webhook', (req, res) => {
    const ev = stripe.verifyWebhook(req.rawBody, req.get('stripe-signature'));
    if (!ev) return res.status(400).json({ error: 'Firma no válida' });
    const pi = ev.data?.object || {};
    const p = pi.metadata?.app === 'oldface-live' && pi.id ? paymentByIntent(pi.id) : null;
    try {
      if (p && ev.type === 'payment_intent.succeeded') applyPayment(p);
      else if (p && ['payment_intent.canceled', 'payment_intent.payment_failed'].includes(ev.type) && p.status === 'created') {
        p.status = ev.type === 'payment_intent.canceled' ? 'canceled' : 'failed'; p.updatedAt = Date.now();
        payments.save();
      }
    } catch (e) { console.error('[directos·pago] webhook', ev.type, e.message); }
    res.json({ received: true });
  });

  // ── Códigos de promoción ──
  const redeemTries = new Map();   // userId → [instantes] (máx. 10 intentos cada 10 min)
  /** POST /directos/redeem — { userId, kind, id, code } canjea un código del emisor (Bearer) */
  router.post('/directos/redeem', (req, res) => {
    const userId = requireSession(req, res);
    if (!userId) return;
    const now = Date.now();
    const tries = (redeemTries.get(userId) || []).filter(t => now - t < 600_000);
    if (tries.length >= 10) return res.status(429).json({ error: 'Demasiados intentos. Espera unos minutos.' });
    tries.push(now); redeemTries.set(userId, tries);
    const t = target(req, res, userId);
    if (!t) return;
    if (t.ownerId === userId || !(t.price > 0) || hasPass(t.directoId, userId)) return res.json({ ok: true, already: true });
    const c = codes.map.get(String(req.body?.code || '').trim().toUpperCase().replace(/[\s-]/g, ''));
    if (!c || c.directoId !== t.directoId) return res.status(400).json({ error: 'El código no es válido para este directo' });
    if (c.usedBy) return res.status(400).json({ error: 'Este código ya se ha usado' });
    c.usedBy = userId; c.usedAt = now;
    codes.save();
    grantPass(t.directoId, userId, 'code', c.code);
    const who = findUserById(userId)?.name || 'Alguien';
    try { notify(t.ownerId, `🎟️ ${who} ha usado un código`, t.title || 'Directo'); } catch { /* sin avisos */ }
    res.json({ ok: true });
  });

  /** Solo el emisor gestiona los códigos de su directo */
  function ownDirecto(req, res, userId) {
    const t = getTarget('directo', req.params.id, userId);
    if (!t || t.ownerId !== userId) { res.status(404).json({ error: 'Directo no encontrado' }); return null; }
    return t;
  }
  const codeFor = (c) => ({ code: c.code, createdAt: c.createdAt, used: !!c.usedBy, usedAt: c.usedAt || null,
                            usedByName: c.usedBy ? (findUserById(c.usedBy)?.name || null) : null });

  /** GET /directos/:id/codes?userId= — códigos del directo (solo el emisor, Bearer) */
  router.get('/directos/:id/codes', (req, res) => {
    const userId = requireSession(req, res);
    if (!userId || !ownDirecto(req, res, userId)) return;
    const list = [...codes.map.values()].filter(c => c.directoId === req.params.id).sort((a, b) => b.createdAt - a.createdAt).map(codeFor);
    res.json({ codes: list });
  });

  /** POST /directos/:id/codes — { userId, count } crea códigos de un solo uso (solo el emisor, Bearer) */
  router.post('/directos/:id/codes', (req, res) => {
    const userId = requireSession(req, res);
    if (!userId || !ownDirecto(req, res, userId)) return;
    const count = req.body?.count === undefined ? 1 : Math.floor(Number(req.body.count));
    if (!(count >= 1 && count <= 50)) return res.status(400).json({ error: 'Puedes crear de 1 a 50 códigos a la vez' });
    const unused = [...codes.map.values()].filter(c => c.directoId === req.params.id && !c.usedBy).length;
    if (unused + count > 200) return res.status(400).json({ error: 'Tienes demasiados códigos sin usar en este directo' });
    const made = [];
    while (made.length < count) {
      let code = '';
      for (const b of crypto.randomBytes(8)) code += CODE_CHARS[b % CODE_CHARS.length];
      if (codes.map.has(code)) continue;
      const c = { code, directoId: req.params.id, ownerId: userId, createdAt: Date.now(), usedBy: null, usedAt: null };
      codes.map.set(code, c); made.push(codeFor(c));
    }
    codes.save();
    res.status(201).json({ codes: made });
  });

  /** DELETE /directos/:id/codes/:code?userId= — anula un código sin usar (solo el emisor, Bearer) */
  router.delete('/directos/:id/codes/:code', (req, res) => {
    const userId = requireSession(req, res);
    if (!userId || !ownDirecto(req, res, userId)) return;
    const c = codes.map.get(String(req.params.code).toUpperCase());
    if (!c || c.directoId !== req.params.id) return res.status(404).json({ error: 'Código no encontrado' });
    if (c.usedBy) return res.status(400).json({ error: 'Este código ya se ha usado' });
    codes.map.delete(c.code); codes.save();
    res.json({ success: true });
  });

  // ── Ganancias y retiradas del emisor ──
  const withdrawalFor = (w) => ({ id: w.id, amount: w.amount, status: w.status, createdAt: w.createdAt, decidedAt: w.decidedAt || null,
                                  note: w.note || '', holder: w.holder, account: maskIban(decrypt(w.account)) });

  /** GET /directos/earnings?userId= — saldo, movimientos y retiradas del emisor (Bearer) */
  router.get('/directos/earnings', (req, res) => {
    const userId = requireSession(req, res);
    if (!userId) return;
    const e = earningOf(userId);
    const list = [...withdrawals.map.values()].filter(w => w.ownerId === userId).sort((a, b) => b.createdAt - a.createdAt).map(withdrawalFor);
    res.json({ balance: e.balance, earned: e.earned, withdrawn: e.withdrawn, moves: (e.moves || []).slice(0, 100),
               withdrawals: list, feePercent: FEE, minWithdrawal: MIN_WITHDRAWAL });
  });

  /** POST /directos/earnings/withdraw — { userId, amount, holder, iban } pide una retirada a su cuenta (Bearer) */
  router.post('/directos/earnings/withdraw', (req, res) => {
    const userId = requireSession(req, res);
    if (!userId) return;
    const amount = money(req.body?.amount);
    const holder = String(req.body?.holder || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 120);
    const iban = cleanIban(req.body?.iban);
    const e = earningOf(userId);
    if (!(amount >= MIN_WITHDRAWAL)) return res.status(400).json({ error: `La retirada mínima es de ${MIN_WITHDRAWAL} €` });
    if (amount > e.balance) return res.status(400).json({ error: 'No tienes saldo suficiente' });
    if (holder.length < 3) return res.status(400).json({ error: 'Escribe el nombre del titular de la cuenta' });
    if (!validIban(iban)) return res.status(400).json({ error: 'El IBAN no es válido' });
    if ([...withdrawals.map.values()].some(w => w.ownerId === userId && w.status === 'pending'))
      return res.status(409).json({ error: 'Ya tienes una retirada pendiente' });
    const w = { id: `wd_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`, ownerId: userId, amount, holder,
                account: encrypt(iban), status: 'pending', createdAt: Date.now() };
    withdrawals.map.set(w.id, w); withdrawals.save();
    move(userId, -amount, 'withdrawal', w.id, 'Retirada solicitada');
    res.status(201).json(withdrawalFor(w));
  });

  // ── Administrador ──
  /** GET /admin/live/payments — cobros de directos, saldos de los emisores y comisión */
  router.get('/admin/live/payments', adminAuth, (_req, res) => {
    const name = (id) => findUserById(id)?.name || id;
    const list = [...payments.map.values()].filter(p => p.status !== 'created').sort((a, b) => b.createdAt - a.createdAt).slice(0, 500)
      .map(p => ({ ...p, ownerName: name(p.ownerId), buyerName: name(p.buyerId) }));
    const owners = [...earnings.map.entries()].map(([ownerId, e]) => ({ ownerId, name: name(ownerId), balance: e.balance, earned: e.earned, withdrawn: e.withdrawn }));
    const ok = list.filter(p => p.status === 'succeeded');
    const { publishableKey, ...st } = stripe.status();
    res.json({ payments: list, owners, feePercent: FEE, stripe: st,
               totals: { amount: money(ok.reduce((n, p) => n + p.amount, 0)), fee: money(ok.reduce((n, p) => n + p.fee, 0)) } });
  });

  /** POST /admin/live/payments/:id/refund — devuelve el dinero al espectador, le quita el pase y lo descuenta al emisor */
  router.post('/admin/live/payments/:id/refund', adminAuth, async (req, res) => {
    const p = payments.map.get(req.params.id);
    if (!p || p.status !== 'succeeded') return res.status(404).json({ error: 'Pago no encontrado' });
    try {
      await stripe.refund(p.intentId);
      p.status = 'refunded'; p.refundedAt = Date.now(); p.updatedAt = Date.now();
      payments.save();
      if (passes.map.get(passKey(p.directoId, p.buyerId))?.ref === p.id) { passes.map.delete(passKey(p.directoId, p.buyerId)); passes.save(); }
      move(p.ownerId, -p.net, 'refund', p.id, `Devolución · ${p.title || 'Directo'}`);
      res.json({ success: true });
    } catch (e) { res.status(e.status || 502).json({ error: e.message }); }
  });

  /** GET /admin/live/withdrawals — retiradas (con la cuenta completa, solo aquí) */
  router.get('/admin/live/withdrawals', adminAuth, (_req, res) => {
    const list = [...withdrawals.map.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, 500)
      .map(w => ({ ...withdrawalFor(w), ownerId: w.ownerId, ownerName: findUserById(w.ownerId)?.name || w.ownerId, account: decrypt(w.account) }));
    res.json({ withdrawals: list });
  });

  /** PUT /admin/live/withdrawals/:id — { status: 'paid'|'rejected', note } (rechazada → el dinero vuelve al saldo) */
  router.put('/admin/live/withdrawals/:id', adminAuth, (req, res) => {
    const w = withdrawals.map.get(req.params.id);
    const status = req.body?.status;
    if (!w) return res.status(404).json({ error: 'Retirada no encontrada' });
    if (w.status !== 'pending') return res.status(409).json({ error: 'Esta retirada ya está resuelta' });
    if (!['paid', 'rejected'].includes(status)) return res.status(400).json({ error: 'Estado no válido' });
    w.status = status; w.decidedAt = Date.now(); w.note = String(req.body?.note || '').slice(0, 300);
    withdrawals.save();
    if (status === 'rejected') move(w.ownerId, w.amount, 'withdrawal_back', w.id, 'Retirada rechazada: vuelve a tu saldo');
    try { notify(w.ownerId, status === 'paid' ? '🏦 Retirada pagada' : 'Retirada rechazada', `${w.amount.toFixed(2)} €${w.note ? ' · ' + w.note : ''}`); } catch { /* sin avisos */ }
    res.json(withdrawalFor(w));
  });

  /** Eliminar cuenta: se borran sus pases y sus códigos; los cobros y retiradas se conservan (contabilidad) */
  function forgetUser(userId) {
    let n = 0;
    for (const [k, p] of passes.map) if (p.userId === userId) { passes.map.delete(k); n++; }
    if (n) passes.save();
    let m = 0;
    for (const [k, c] of codes.map) if (c.ownerId === userId) { codes.map.delete(k); m++; }
    if (m) codes.save();
  }

  return { hasPass, forgetUser, MIN_PRICE, MAX_PRICE };
};
