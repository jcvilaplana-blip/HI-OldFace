/**
 * wallet — monederos de clientes y conductores. Cada movimiento queda registrado con el saldo resultante.
 * Usar SIEMPRE dentro de tx() cuando forme parte de una operación mayor (viaje, reembolso…).
 */
const { get, run, now } = require('./db');

const money = (n) => Math.round((Number(n) || 0) * 100) / 100;

function ensureWallet(ownerType, ownerId, currency = 'EUR') {
  let w = get('SELECT * FROM wallets WHERE owner_type = ? AND owner_id = ?', ownerType, ownerId);
  if (!w) {
    run('INSERT INTO wallets (owner_type, owner_id, currency) VALUES (?, ?, ?)', ownerType, ownerId, currency);
    w = get('SELECT * FROM wallets WHERE owner_type = ? AND owner_id = ?', ownerType, ownerId);
  }
  return w;
}

/**
 * Apunta un movimiento. type: 'credit' (suma) | 'debit' (resta).
 * allowNegative: el monedero del conductor puede quedar en negativo (deuda de comisiones).
 */
function move(ownerType, ownerId, type, amount, description, { refType = null, refId = null, allowNegative = false } = {}) {
  amount = money(amount);
  if (!(amount > 0)) return null;
  const w = ensureWallet(ownerType, ownerId);
  if (w.status !== 'active') throw Object.assign(new Error('El monedero está bloqueado'), { status: 403 });
  const balance = money(w.balance + (type === 'credit' ? amount : -amount));
  if (balance < 0 && !allowNegative) throw Object.assign(new Error('Saldo insuficiente en el monedero'), { status: 402 });
  run(`UPDATE wallets SET balance = ?, ${type === 'credit' ? 'credits = credits' : 'debits = debits'} + ?, last_tx_at = ? WHERE id = ?`,
      balance, amount, now(), w.id);
  run('INSERT INTO wallet_transactions (wallet_id, type, amount, balance_after, description, ref_type, ref_id, status, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      w.id, type, amount, balance, description, refType, refId, 'completed', now());
  return balance;
}

const credit = (t, id, amount, desc, opts) => move(t, id, 'credit', amount, desc, opts);
const debit  = (t, id, amount, desc, opts) => move(t, id, 'debit', amount, desc, opts);
const balanceOf = (t, id) => ensureWallet(t, id).balance;

module.exports = { ensureWallet, credit, debit, balanceOf, money };
