/**
 * CardPay — ventana de pago con TARJETA DE CRÉDITO (formulario seguro de la pasarela Stripe, cargado desde js.stripe.com):
 * los datos de la tarjeta van directamente a la pasarela, nunca pasan por nuestros servidores.
 *   card: { clientSecret, publishableKey, testMode } (lo devuelve el servidor al pedir el viaje o la recarga)
 *   onPaid(): se llama cuando la tarjeta está confirmada (el servidor lo comprueba con la pasarela)
 */
import React, { useEffect, useRef, useState } from 'react';
import { tx } from '../../utils/taxiApi';
import { BRAND, C, Btn, Spinner } from './ui.jsx';

let loading = null, loadedKey = null;
function loadGateway(publishableKey, locale) {
  if (loading && loadedKey === publishableKey) return loading;
  loadedKey = publishableKey;
  loading = new Promise((resolve, reject) => {
    const ready = () => resolve(window.Stripe(publishableKey, { locale }));
    if (window.Stripe) return ready();
    const s = document.createElement('script');
    s.src = 'https://js.stripe.com/v3/';
    s.async = true;
    s.onload = ready;
    s.onerror = () => { loading = null; reject(new Error(tx('No se pudo cargar el pago con tarjeta. Revisa tu conexión.'))); };
    document.head.appendChild(s);
  });
  return loading;
}

export default function CardPay({ card, title, note, payLabel, lang = 'es', onPaid, onCancel }) {
  const box = useRef(null);
  const [gw, setGw] = useState(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true, element = null;
    setReady(false); setError('');
    loadGateway(card.publishableKey, lang).then((stripe) => {
      if (!alive) return;
      const elements = stripe.elements({ clientSecret: card.clientSecret, locale: lang,
        appearance: { theme: 'stripe', variables: { colorPrimary: BRAND, borderRadius: '12px', fontSizeBase: '16px' } } });
      element = elements.create('payment', { layout: 'tabs', wallets: { applePay: 'never', googlePay: 'never' } });
      element.mount(box.current);
      element.on('ready', () => alive && setReady(true));
      setGw({ stripe, elements });
    }).catch((e) => alive && setError(e.message));
    return () => { alive = false; try { element?.destroy(); } catch { /* ya desmontado */ } };
  }, [card.clientSecret]); // eslint-disable-line

  const pay = async () => {
    setBusy(true); setError('');
    const { error: e } = await gw.stripe.confirmPayment({ elements: gw.elements, redirect: 'if_required', confirmParams: { return_url: window.location.href } });
    if (e) { setError(e.message || tx('La tarjeta no se ha podido confirmar')); setBusy(false); return; }
    try { await onPaid(); } catch (err) { setError(err.message); }
    setBusy(false);
  };

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 20, background: 'rgba(15,23,42,0.45)', display: 'flex', alignItems: 'flex-end' }}>
      <div style={{ width: '100%', maxHeight: '92%', overflowY: 'auto', background: 'white', borderRadius: '22px 22px 0 0', padding: '18px 16px calc(var(--sab) + 16px)' }}>
        <p style={{ fontSize: 19, fontWeight: 900, margin: '0 0 4px' }}>💳 {title || tx('Tarjeta de crédito')}</p>
        {note && <p style={{ fontSize: 13, color: C.muted, margin: '0 0 12px' }}>{note}</p>}
        {card.testMode && (
          <div style={{ background: '#fef3c7', color: '#92400e', borderRadius: 12, padding: '10px 12px', fontSize: 13, fontWeight: 700, margin: '0 0 12px' }}>
            🧪 {tx('Modo pruebas: no se cobra dinero real. Usa la tarjeta 4242 4242 4242 4242, cualquier fecha futura y cualquier CVC.')}
          </div>
        )}
        {!ready && !error && <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}><Spinner /></div>}
        <div ref={box} style={{ minHeight: ready ? 0 : 1 }} />
        {error && <p style={{ color: C.danger, fontWeight: 700, fontSize: 14, margin: '12px 0 0' }}>{error}</p>}
        <Btn onClick={pay} disabled={!ready || busy} style={{ marginTop: 16 }}>{busy ? tx('Un momento…') : payLabel || tx('Pagar')}</Btn>
        <Btn variant="ghost" onClick={onCancel} disabled={busy} style={{ marginTop: 8 }}>{tx('Cancelar')}</Btn>
        <p style={{ fontSize: 11, color: C.muted, textAlign: 'center', margin: '10px 0 0' }}>🔒 {tx('Pago seguro. Los datos de tu tarjeta no se guardan en OldFace.')}</p>
      </div>
    </div>
  );
}
