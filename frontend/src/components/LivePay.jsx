/**
 * Directos de pago en la app:
 *   · PaySheet: ver un directo o grabación de pago → pagar con tarjeta (Stripe, formulario seguro de la pasarela) o
 *     canjear un código del emisor. El servidor lo comprueba todo; al terminar se llama onUnlocked().
 *   · CodesSheet: el emisor crea códigos de un solo uso para su directo y los comparte (uno por persona).
 *   · EarningsSheet: saldo del emisor (lo cobrado menos la comisión de OldFace), movimientos y retiradas al banco.
 */
import { useEffect, useState } from 'react';
import { useBackClose } from '../utils/backHandler';
import { payConfig, startPay, confirmPay, redeemCode, listCodes, createCodes, deleteCode,
         getEarnings, requestWithdrawal, formatMoney } from '../utils/directos';
import CardPay from '../pages/taxi/CardPay.jsx';
import { tr, LANG, LOCALE } from '../i18n';

const BRAND = '#3D5A80';
const RED   = '#ef4444';
const TEXT  = 'var(--text-primary)';
const MUTED = 'var(--text-secondary)';
const GREEN = '#15803d';

function Sheet({ title, onClose, children, z = 760 }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: z, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'flex-end' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', background: 'var(--bg-surface)', borderRadius: '24px 24px 0 0', maxHeight: '92vh', overflowY: 'auto',
                                                        padding: '18px 16px calc(18px + env(safe-area-inset-bottom, 0px))', boxSizing: 'border-box', color: TEXT }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h2 style={{ fontSize: 17, fontWeight: 900, margin: 0 }}>{title}</h2>
          <button onClick={onClose} aria-label={tr('Cerrar')} style={{ background: 'var(--bg-hover)', border: 'none', borderRadius: '50%', width: 30, height: 30, cursor: 'pointer', fontSize: 15, fontWeight: 800, color: MUTED }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ── Pagar o canjear código ───────────────────────────────────────────────────
/** kind: 'directo' | 'recording' · id · price · title · ownerName */
export function PaySheet({ kind, id, price, title, ownerName, onClose, onUnlocked }) {
  const [mode, setMode]   = useState('choose');   // choose | code | card
  const [card, setCard]   = useState(null);       // { clientSecret, publishableKey, testMode, paymentId }
  const [code, setCode]   = useState('');
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState('');
  const [cfg, setCfg]     = useState(null);
  useBackClose(true, () => (mode === 'choose' ? onClose() : setMode('choose')));
  useEffect(() => { payConfig().then(setCfg).catch(() => setCfg({ ready: false })); }, []);

  const payCard = async () => {
    setBusy(true); setError('');
    try {
      const r = await startPay(kind, id);
      if (r.already) return onUnlocked();
      setCard(r); setMode('card');
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  const redeem = async () => {
    if (!code.trim()) { setError(tr('Escribe el código')); return; }
    setBusy(true); setError('');
    try { await redeemCode(kind, id, code); onUnlocked(); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  if (mode === 'card' && card) {
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 780 }}>
        <CardPay card={card} lang={LANG} title={tr('Pagar el directo')}
          note={`${title || tr('Directo')} · ${formatMoney(price)}`} payLabel={tr('Pagar {p0}', { p0: formatMoney(price) })}
          onPaid={async () => { await confirmPay(card.paymentId); onUnlocked(); }}
          onCancel={() => setMode('choose')} />
      </div>
    );
  }

  return (
    <Sheet title={tr('Directo de pago')} onClose={onClose}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 14, background: 'rgba(250,204,21,0.25)', borderRadius: 16, marginBottom: 14 }}>
        <span style={{ fontSize: 26 }}>🔒</span>
        <div style={{ minWidth: 0 }}>
          <p style={{ margin: 0, fontWeight: 900, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title || tr('Directo')}</p>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: MUTED }}>
            {ownerName ? `${ownerName} · ` : ''}{tr('Precio: {p0}', { p0: formatMoney(price) })}
          </p>
        </div>
      </div>
      <p style={{ fontSize: 12, color: MUTED, margin: '0 0 14px', lineHeight: 1.5 }}>
        {tr('Con un solo pago puedes verlo en directo y también su grabación cuando termine.')}
      </p>

      {mode === 'choose' && (
        <>
          <button onClick={payCard} disabled={busy || cfg?.ready === false} style={{ ...btn, width: '100%', background: RED, color: 'white', opacity: busy || cfg?.ready === false ? 0.6 : 1 }}>
            {busy ? tr('Un momento…') : `💳 ${tr('Pagar {p0} con tarjeta', { p0: formatMoney(price) })}`}
          </button>
          {cfg?.ready === false && <p style={{ fontSize: 12, color: MUTED, margin: '8px 0 0', textAlign: 'center' }}>{tr('El pago con tarjeta no está disponible ahora. Puedes usar un código.')}</p>}
          {cfg?.testMode && <p style={{ fontSize: 12, color: '#92400e', margin: '8px 0 0', textAlign: 'center' }}>🧪 {tr('Modo pruebas: no se cobra dinero real.')}</p>}
          <button onClick={() => { setMode('code'); setError(''); }} style={{ ...btn, width: '100%', marginTop: 10, background: 'var(--accent-dim)', color: 'var(--accent-text)' }}>
            🎟️ {tr('Tengo un código')}
          </button>
        </>
      )}

      {mode === 'code' && (
        <>
          <p style={labelStyle}>{tr('CÓDIGO DE PROMOCIÓN')}</p>
          <input value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="ABCD2345" maxLength={12} autoFocus
            style={{ ...inputStyle, fontSize: 20, fontWeight: 800, letterSpacing: 3, textAlign: 'center' }} />
          <p style={{ fontSize: 11, color: MUTED, margin: '6px 0 0' }}>{tr('Te lo da quien hace el directo. Cada código sirve para una sola persona.')}</p>
          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <button onClick={() => { setMode('choose'); setError(''); }} style={{ ...btn, flex: 1, background: 'var(--bg-hover)', color: MUTED }}>{tr('Atrás')}</button>
            <button onClick={redeem} disabled={busy} style={{ ...btn, flex: 2, background: BRAND, color: 'white', opacity: busy ? 0.7 : 1 }}>{busy ? tr('Comprobando…') : tr('Usar código')}</button>
          </div>
        </>
      )}

      {error && <p style={{ fontSize: 13, color: RED, background: 'rgba(239,68,68,0.14)', padding: '10px 14px', borderRadius: 10, margin: '12px 0 0', fontWeight: 600 }}>{error}</p>}
      <p style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', margin: '14px 0 0' }}>🔒 {tr('Pago seguro. Los datos de tu tarjeta no se guardan en OldFace.')}</p>
    </Sheet>
  );
}

// ── Códigos del emisor ───────────────────────────────────────────────────────
export function CodesSheet({ directo, onClose }) {
  useBackClose(true, onClose);
  const [codes, setCodes] = useState([]);
  const [count, setCount] = useState(1);
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');

  const load = () => listCodes(directo.id).then(setCodes).catch(e => setError(e.message));
  useEffect(() => { load(); }, []); // eslint-disable-line

  const make = async () => {
    setBusy(true); setError('');
    try { await createCodes(directo.id, Number(count) || 1); await load(); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  const share = async (c) => {
    const text = tr('Código para ver mi directo "{p0}" en OldFace: {p1}', { p0: directo.title, p1: c });
    try {
      if (navigator.share) await navigator.share({ text });
      else { await navigator.clipboard.writeText(c); setCopied(c); setTimeout(() => setCopied(''), 2000); }
    } catch { /* cancelado */ }
  };
  const remove = async (c) => {
    try { await deleteCode(directo.id, c); setCodes(l => l.filter(x => x.code !== c)); }
    catch (e) { setError(e.message); }
  };

  const unused = codes.filter(c => !c.used), used = codes.filter(c => c.used);
  return (
    <Sheet title={tr('Códigos de promoción')} onClose={onClose}>
      <p style={{ fontSize: 12, color: MUTED, margin: '0 0 12px', lineHeight: 1.5 }}>
        {tr('Cada código deja ver "{p0}" gratis a UNA persona (solo a tus contactos). Envíaselo por chat.', { p0: directo.title })}
      </p>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <select value={count} onChange={e => setCount(e.target.value)} style={{ ...inputStyle, width: 90 }}>
          {[1, 2, 3, 5, 10, 20].map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <button onClick={make} disabled={busy} style={{ ...btn, flex: 1, background: BRAND, color: 'white', opacity: busy ? 0.7 : 1 }}>
          {busy ? tr('Creando…') : tr('Crear códigos')}
        </button>
      </div>
      {error && <p style={{ fontSize: 12, color: RED, margin: '10px 0 0' }}>{error}</p>}

      {unused.length > 0 && <p style={labelStyle}>{tr('SIN USAR ({n})', { n: unused.length })}</p>}
      {unused.map(c => (
        <div key={c.code} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'var(--bg-section)', borderRadius: 12, marginBottom: 6 }}>
          <span style={{ flex: 1, fontFamily: 'monospace', fontSize: 17, fontWeight: 800, letterSpacing: 2 }}>{c.code}</span>
          <button onClick={() => share(c.code)} style={{ ...chip, background: 'var(--accent-dim)', color: 'var(--accent-text)' }}>{copied === c.code ? tr('Copiado') : tr('Enviar')}</button>
          <button onClick={() => remove(c.code)} aria-label={tr('Anular')} style={{ ...chip, background: 'rgba(239,68,68,0.14)', color: RED }}>✕</button>
        </div>
      ))}
      {used.length > 0 && <p style={labelStyle}>{tr('USADOS ({n})', { n: used.length })}</p>}
      {used.map(c => (
        <div key={c.code} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 12, marginBottom: 4 }}>
          <span style={{ fontFamily: 'monospace', fontSize: 14, color: 'var(--text-muted)', textDecoration: 'line-through' }}>{c.code}</span>
          <span style={{ flex: 1, fontSize: 12, color: MUTED, textAlign: 'right' }}>{c.usedByName || ''}</span>
        </div>
      ))}
      {!codes.length && !error && <p style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', padding: '18px 0 4px' }}>{tr('Todavía no has creado códigos')}</p>}
    </Sheet>
  );
}

// ── Ganancias del emisor ─────────────────────────────────────────────────────
const MOVE_LABEL = { sale: 'Venta', refund: 'Devolución', withdrawal: 'Retirada', withdrawal_back: 'Retirada rechazada' };
const WD_LABEL = { pending: ['Pendiente', 'rgba(250,204,21,0.25)', '#92400e'], paid: ['Pagada', 'rgba(34,197,94,0.16)', GREEN], rejected: ['Rechazada', 'rgba(239,68,68,0.14)', RED] };

export function EarningsSheet({ onClose }) {
  useBackClose(true, onClose);
  const [data, setData]     = useState(null);
  const [form, setForm]     = useState(false);
  const [amount, setAmount] = useState('');
  const [holder, setHolder] = useState('');
  const [iban, setIban]     = useState('');
  const [busy, setBusy]     = useState(false);
  const [error, setError]   = useState('');

  const load = () => getEarnings().then(setData).catch(e => setError(e.message));
  useEffect(() => { load(); }, []);

  const withdraw = async () => {
    setBusy(true); setError('');
    try {
      await requestWithdrawal({ amount: Number(String(amount).replace(',', '.')), holder, iban });
      setForm(false); setAmount(''); await load();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  const fmtDate = (ts) => new Date(ts).toLocaleDateString(LOCALE, { day: '2-digit', month: 'short' });
  const pending = data?.withdrawals?.some(w => w.status === 'pending');

  return (
    <Sheet title={tr('Mis ganancias')} onClose={onClose}>
      {!data && !error && <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 30 }}>{tr('Cargando…')}</p>}
      {data && (
        <>
          <div style={{ background: `linear-gradient(135deg, ${RED}, #ec4899)`, color: 'white', borderRadius: 18, padding: '16px 18px' }}>
            <p style={{ margin: 0, fontSize: 12, opacity: 0.85, fontWeight: 700 }}>{tr('SALDO DISPONIBLE')}</p>
            <p style={{ margin: '2px 0 6px', fontSize: 32, fontWeight: 900 }}>{formatMoney(data.balance)}</p>
            <p style={{ margin: 0, fontSize: 12, opacity: 0.85 }}>
              {tr('Ganado en total: {p0} · OldFace se queda el {p1} % de cada pago', { p0: formatMoney(data.earned), p1: data.feePercent })}
            </p>
          </div>

          {!form && (
            <button onClick={() => { setForm(true); setError(''); }} disabled={pending || data.balance < data.minWithdrawal}
              style={{ ...btn, width: '100%', marginTop: 12, background: BRAND, color: 'white', opacity: pending || data.balance < data.minWithdrawal ? 0.5 : 1 }}>
              🏦 {tr('Retirar a mi cuenta')}
            </button>
          )}
          {!form && (pending || data.balance < data.minWithdrawal) && (
            <p style={{ fontSize: 11, color: MUTED, textAlign: 'center', margin: '6px 0 0' }}>
              {pending ? tr('Tienes una retirada pendiente') : tr('Puedes retirar a partir de {p0}', { p0: formatMoney(data.minWithdrawal) })}
            </p>
          )}

          {form && (
            <div style={{ marginTop: 12, padding: 12, background: 'var(--bg-section)', borderRadius: 16 }}>
              <p style={labelStyle}>{tr('IMPORTE (€)')}</p>
              <input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" placeholder={String(data.balance)} style={inputStyle} />
              <p style={labelStyle}>{tr('TITULAR DE LA CUENTA')}</p>
              <input value={holder} onChange={e => setHolder(e.target.value)} maxLength={120} style={inputStyle} />
              <p style={labelStyle}>IBAN</p>
              <input value={iban} onChange={e => setIban(e.target.value.toUpperCase())} placeholder="ES00 0000 0000 0000 0000 0000" maxLength={42} style={{ ...inputStyle, fontFamily: 'monospace' }} />
              <p style={{ fontSize: 11, color: MUTED, margin: '6px 0 0' }}>{tr('La cuenta se guarda cifrada y solo la ve el administrador para hacerte la transferencia.')}</p>
              <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                <button onClick={() => setForm(false)} style={{ ...btn, flex: 1, background: 'var(--bg-surface)', color: MUTED }}>{tr('Cancelar')}</button>
                <button onClick={withdraw} disabled={busy} style={{ ...btn, flex: 2, background: BRAND, color: 'white', opacity: busy ? 0.7 : 1 }}>{busy ? tr('Enviando…') : tr('Pedir retirada')}</button>
              </div>
            </div>
          )}
          {error && <p style={{ fontSize: 12, color: RED, background: 'rgba(239,68,68,0.14)', padding: '10px 14px', borderRadius: 10, margin: '10px 0 0' }}>{error}</p>}

          {data.withdrawals?.length > 0 && <p style={labelStyle}>{tr('RETIRADAS')}</p>}
          {data.withdrawals?.map(w => {
            const [label, bg, color] = WD_LABEL[w.status] || WD_LABEL.pending;
            return (
              <div key={w.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--bg-hover)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 14, fontWeight: 800 }}>{formatMoney(w.amount)}</p>
                  <p style={{ margin: 0, fontSize: 11, color: MUTED }}>{fmtDate(w.createdAt)} · {w.account}{w.note ? ` · ${w.note}` : ''}</p>
                </div>
                <span style={{ fontSize: 11, fontWeight: 800, background: bg, color, borderRadius: 20, padding: '3px 9px' }}>{tr(label)}</span>
              </div>
            );
          })}

          {data.moves?.length > 0 && <p style={labelStyle}>{tr('MOVIMIENTOS')}</p>}
          {data.moves?.map((m, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--bg-hover)' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 700 }}>{tr(MOVE_LABEL[m.kind] || 'Movimiento')}</p>
                <p style={{ margin: 0, fontSize: 11, color: MUTED, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fmtDate(m.at)} · {m.text}</p>
              </div>
              <span style={{ fontSize: 14, fontWeight: 900, color: m.amount >= 0 ? GREEN : RED }}>{m.amount >= 0 ? '+' : ''}{formatMoney(m.amount)}</span>
            </div>
          ))}
          {!data.moves?.length && <p style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', padding: '18px 0 4px' }}>{tr('Cuando alguien pague uno de tus directos aparecerá aquí.')}</p>}
        </>
      )}
    </Sheet>
  );
}

const labelStyle = { fontSize: 11, fontWeight: 800, color: MUTED, letterSpacing: '0.4px', margin: '14px 0 6px' };
const inputStyle = { width: '100%', padding: '11px 14px', borderRadius: 12, border: '1.5px solid var(--border-strong)', fontSize: 14, color: TEXT,
                     background: 'var(--bg-surface)', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' };
const btn  = { padding: '13px', border: 'none', borderRadius: 14, fontWeight: 800, fontSize: 14, cursor: 'pointer' };
const chip = { border: 'none', borderRadius: 20, padding: '6px 12px', fontSize: 12, fontWeight: 800, cursor: 'pointer' };
