/**
 * CustomerApp — parte del CLIENTE del taxi (tipo Uber):
 *   Inicio: mapa propio → ¿A dónde vas? → buscador (o elegir en el mapa) → tipos de viaje con precio cerrado
 *           → forma de pago y código promocional → Pedir → buscando conductor → conductor en camino (posición en
 *           directo) → ha llegado (código de 4 cifras) → en viaje → fin: total y valoración.
 *   Pestañas: Inicio · Mis viajes · Monedero · Perfil
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { taxiApi, taxiSocket, tx, money, decodePolyline, currentPosition, taxiUrl } from '../../utils/taxiApi';
import { BRAND, C, Btn, Sheet, Spinner, Toast, Stars, Tabs, inputStyle } from './ui.jsx';
import TaxiMap from './TaxiMap.jsx';
import CardPay from './CardPay.jsx';
import { TripChatButton } from './TripChat.jsx';
import { TripsTab, WalletTab, ProfileTab } from './CustomerTabs.jsx';

const ACTIVE = ['searching', 'accepted', 'arrived', 'started'];

export default function CustomerApp({ boot, reload, onExit }) {
  const [tab, setTab] = useState('home');
  const [toast, setToast] = useState(null);
  const timer = useRef(null);
  const notify = useCallback((msg, err = false) => {
    setToast({ msg, err });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  const tabs = [
    { key: 'home', icon: '🚕', label: tx('Inicio') },
    { key: 'trips', icon: '🧾', label: tx('Mis viajes') },
    { key: 'wallet', icon: '👛', label: tx('Monedero') },
    { key: 'profile', icon: '👤', label: tx('Perfil') },
  ];

  return (
    <>
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {/* El inicio se mantiene montado para no perder el mapa ni el viaje en curso */}
        <div style={{ position: 'absolute', inset: 0, visibility: tab === 'home' ? 'visible' : 'hidden' }}>
          <RideHome boot={boot} notify={notify} onExit={onExit} />
        </div>
        {tab === 'trips' && <TripsTab boot={boot} notify={notify} />}
        {tab === 'wallet' && <WalletTab boot={boot} notify={notify} />}
        {tab === 'profile' && <ProfileTab boot={boot} notify={notify} reload={reload} onExit={onExit} />}
      </div>
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      <Toast {...(toast || {})} />
    </>
  );
}

// ══ Inicio: pedir un viaje y seguirlo ════════════════════════════════════════
function RideHome({ boot, notify, onExit }) {
  const navigate = useNavigate();
  const settings = boot.settings;
  const lang = boot.language?.code || 'es';
  const country = boot.countries.find(c => c.id === boot.profile?.country_id) || boot.countries.find(c => c.is_default);

  const [center, setCenter] = useState(country?.lat ? { lat: country.lat, lng: country.lng } : null);
  const [pickup, setPickup] = useState(null);
  const [dropoff, setDropoff] = useState(null);
  const [step, setStep] = useState('idle');          // idle · search · pick · quote · trip
  const [pickField, setPickField] = useState('dropoff');
  const [pinPlace, setPinPlace] = useState(null);
  const [quote, setQuote] = useState(null);
  const [rideTypeId, setRideTypeId] = useState(null);
  const [payment, setPayment] = useState('cash');
  const [promo, setPromo] = useState('');
  const [busy, setBusy] = useState(false);
  const [booking, setBooking] = useState(null);
  const [driverPos, setDriverPos] = useState(null);
  const [fit, setFit] = useState(0);
  const codeRef = useRef(null);
  codeRef.current = booking?.code || null;

  const reverse = useCallback(async (lat, lng) => {
    const fallback = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    try { const { place } = await taxiApi(`/maps/reverse?lat=${lat}&lng=${lng}&lang=${lang}`); return { lat, lng, address: place?.address || fallback }; }
    catch { return { lat, lng, address: fallback }; }
  }, [lang]);

  const [locFailed, setLocFailed] = useState(false);
  const locateMe = useCallback(async () => {
    try {
      const p = await currentPosition();
      setCenter({ ...p });
      setLocFailed(false);
      setPickup(await reverse(p.lat, p.lng));
    } catch (e) { setLocFailed(true); notify(e.message, true); }
  }, [reverse, notify]);

  const loadBooking = useCallback(async (code) => {
    try {
      const { booking: b } = await taxiApi(`/customer/bookings/${code}`);
      setBooking(b);
      if (b.driver?.lat) setDriverPos(p => p || { lat: b.driver.lat, lng: b.driver.lng, heading: b.driver.heading });
      return b;
    } catch (e) { notify(e.message, true); return null; }
  }, [notify]);

  // Al abrir: retomar el viaje en curso o situarme en el mapa
  useEffect(() => {
    (async () => {
      try {
        const { active } = await taxiApi('/customer/bookings');
        if (active) { await loadBooking(active.code); setStep('trip'); setFit(f => f + 1); return; }
      } catch { /* sin viajes */ }
      locateMe();
    })();
  }, []); // eslint-disable-line

  // Tiempo real: estados del viaje y posición del conductor (y consulta periódica por si se pierde la conexión)
  useEffect(() => {
    let s, alive = true;
    const onUpdate = (p) => {
      if (p.code !== codeRef.current) return;
      if (p.message) notify(tx(p.message));
      loadBooking(p.code).then(b => { if (b && ['accepted', 'arrived'].includes(b.status)) setFit(f => f + 1); });
    };
    const onLoc = (p) => { if (p.code === codeRef.current) setDriverPos({ lat: p.lat, lng: p.lng, heading: p.heading }); };
    taxiSocket().then(sock => {
      if (!alive) return;
      s = sock; s.on('booking:update', onUpdate); s.on('trip:location', onLoc);
    }).catch(() => {});
    return () => { alive = false; s?.off('booking:update', onUpdate); s?.off('trip:location', onLoc); };
  }, [loadBooking, notify]);

  useEffect(() => {
    if (step !== 'trip' || !booking || !ACTIVE.includes(booking.status)) return;
    const id = setInterval(() => loadBooking(booking.code), 10000);
    return () => clearInterval(id);
  }, [step, booking?.code, booking?.status, loadBooking]); // eslint-disable-line

  // ── Presupuesto ──
  const getQuote = useCallback(async (p, d, promoCode = '') => {
    if (!p || !d) return;
    setBusy(true);
    try {
      const q = await taxiApi('/customer/quote', { method: 'POST', body: { pickup: p, dropoff: d, promoCode: promoCode || undefined } });
      setQuote(q);
      setRideTypeId(id => (q.options.some(o => o.rideType.id === id) ? id : q.options[0]?.rideType.id || null));
      setStep('quote'); setFit(f => f + 1);
      if (promoCode && q.promoError) notify(tx(q.promoError), true);
    } catch (e) { notify(e.message, true); }
    setBusy(false);
  }, [notify]);

  const [cardPay, setCardPay] = useState(null);      // { booking, card } mientras se confirma la tarjeta de crédito
  const order = async () => {
    setBusy(true);
    try {
      const { booking: b, card } = await taxiApi('/customer/bookings', { method: 'POST', body: { pickup, dropoff, rideTypeId, paymentMethod: payment, promoCode: promo || undefined } });
      if (card) setCardPay({ booking: b, card });   // tarjeta de crédito: primero se confirma la tarjeta (se reserva el importe)
      else { setBooking(b); setDriverPos(null); setStep('trip'); }
    } catch (e) { notify(e.message, true); }
    setBusy(false);
  };
  const cardConfirmed = async () => {
    const { booking: b } = await taxiApi(`/customer/bookings/${cardPay.booking.code}/card`, { method: 'POST' });
    setCardPay(null); setBooking(b); setDriverPos(null); setStep('trip');
  };
  const cardCancelled = async () => {
    const code = cardPay.booking.code;
    setCardPay(null);
    try { await taxiApi(`/customer/bookings/${code}/cancel`, { method: 'POST', body: { reason: 'Pago con tarjeta no completado' } }); } catch { /* ya anulado */ }
  };

  const resetRide = () => { setBooking(null); setDriverPos(null); setQuote(null); setDropoff(null); setPromo(''); setStep('idle'); if (pickup) setCenter({ lat: pickup.lat, lng: pickup.lng }); };

  // ── Elegir en el mapa ──
  const pinTimer = useRef(null);
  const onCenterChange = useCallback((lat, lng) => {
    if (step !== 'pick') return;
    clearTimeout(pinTimer.current);
    setPinPlace(null);
    pinTimer.current = setTimeout(async () => setPinPlace(await reverse(lat, lng)), 350);
  }, [step, reverse]);

  // Recorrido del conductor durante el viaje (línea gris de por dónde ha ido) — se reinicia en cada viaje
  const [trail, setTrail] = useState([]);
  useEffect(() => { setTrail([]); }, [booking?.code, booking?.status === 'started']); // eslint-disable-line
  useEffect(() => {
    if (booking?.status !== 'started' || !driverPos) return;
    setTrail(t => {
      const last = t[t.length - 1];
      if (last && km({ lat: last[1], lng: last[0] }, driverPos) < 0.01) return t;   // menos de 10 m: nada
      return [...t, [driverPos.lng, driverPos.lat]].slice(-3000);
    });
  }, [booking?.status, driverPos?.lat, driverPos?.lng]); // eslint-disable-line

  // Mientras viene a recogerme: ruta del conductor hasta el punto de recogida (se recalcula si se mueve > 300 m)
  const [toPickup, setToPickup] = useState(null);       // { code, from, line }
  useEffect(() => {
    if (booking?.status !== 'accepted' || !driverPos) { if (toPickup) setToPickup(null); return; }
    if (toPickup?.code === booking.code && km(toPickup.from, driverPos) < 0.3) return;
    const from = { lat: driverPos.lat, lng: driverPos.lng };
    taxiApi('/maps/route', { method: 'POST', body: { points: [from, { lat: booking.pickup_lat, lng: booking.pickup_lng }] } })
      .then(({ route }) => setToPickup({ code: booking.code, from, line: decodePolyline(route.shape) }))
      .catch(() => setToPickup({ code: booking.code, from, line: null }));
  }, [booking?.code, booking?.status, driverPos?.lat, driverPos?.lng]); // eslint-disable-line

  const routeLine = useMemo(() => {
    if (step === 'trip' && booking?.status === 'accepted' && toPickup?.code === booking.code && toPickup.line) return toPickup.line;
    if (step === 'trip' && booking?.route_shape) return decodePolyline(booking.route_shape);
    if (step === 'quote' && quote?.route?.shape) return decodePolyline(quote.route.shape);
    return null;
  }, [step, booking?.code, booking?.status, booking?.route_shape, quote?.route?.shape, toPickup]);

  const inTrip = step === 'trip' && booking;
  const showPick = inTrip ? { lat: booking.pickup_lat, lng: booking.pickup_lng } : pickup;
  const showDrop = inTrip ? { lat: booking.dropoff_lat, lng: booking.dropoff_lng } : step === 'quote' ? dropoff : null;
  const goBack = () => {
    if (step === 'quote' || step === 'search') setStep('idle');
    else if (step === 'pick') setStep('search');
    else onExit();
  };

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <TaxiMap config={settings.map} lang={lang} center={center} pickup={showPick} dropoff={showDrop}
               driver={inTrip && booking.driver ? driverPos : null} route={routeLine} centerPin={step === 'pick'}
               trail={inTrip && booking.status === 'started' ? trail : null} follow={inTrip && booking.status === 'started'}
               onCenterChange={onCenterChange} fit={fit} padding={{ top: 70, bottom: Math.round(window.innerHeight * (step === 'quote' ? 0.62 : 0.45)) }} />

      {/* Botones flotantes */}
      <div style={{ position: 'absolute', top: 'calc(var(--sat) + 10px)', left: 12, right: 12, display: 'flex', justifyContent: 'space-between', zIndex: 3, pointerEvents: 'none' }}>
        <RoundBtn label={tx('Volver')} onClick={goBack}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={BRAND} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M15 19l-7-7 7-7" /></svg>
        </RoundBtn>
        {step !== 'trip' && (
          <RoundBtn label={tx('Mi ubicación')} onClick={locateMe}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={BRAND} strokeWidth="2.2"><circle cx="12" cy="12" r="4" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></svg>
          </RoundBtn>
        )}
      </div>

      {step === 'idle' && (
        <Sheet>
          <p style={{ fontSize: 20, fontWeight: 900, margin: '0 0 12px' }}>{tx('¿A dónde vas?')}</p>
          <button onClick={() => { setPickField('dropoff'); setStep('search'); }} style={{ ...inputStyle, display: 'flex', alignItems: 'center', gap: 10, background: '#f1f5f9', border: 'none', fontWeight: 700, cursor: 'pointer', textAlign: 'left', color: C.muted, fontSize: 16, padding: '15px 14px' }}>
            <span style={{ fontSize: 18 }}>🔍</span> {tx('Buscar destino')}
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, fontSize: 13, color: C.muted }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: C.ok, flexShrink: 0 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pickup ? pickup.address : locFailed ? tx('Elige el punto de recogida') : tx('Buscando tu ubicación…')}</span>
            <button onClick={() => { setPickField('pickup'); setStep('search'); }} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: BRAND, fontWeight: 800, cursor: 'pointer', flexShrink: 0 }}>{tx('Cambiar')}</button>
          </div>
        </Sheet>
      )}

      {step === 'search' && (
        <SearchPanel lang={lang} near={center} pickup={pickup} dropoff={dropoff} field={pickField} setField={setPickField}
          onPick={(place) => {
            if (pickField === 'pickup') { setPickup(place); setCenter({ lat: place.lat, lng: place.lng }); if (!dropoff) { setPickField('dropoff'); return; } getQuote(place, dropoff, promo); }
            else { setDropoff(place); if (pickup) getQuote(pickup, place, promo); else setPickField('pickup'); }
          }}
          onMap={() => { setPinPlace(null); setStep('pick'); }}
          onMine={async () => { await locateMe(); setPickField('dropoff'); }}
          onClose={() => setStep('idle')} busy={busy} />
      )}

      {step === 'pick' && (
        <Sheet>
          <p style={{ fontSize: 13, fontWeight: 800, color: C.muted, margin: '0 0 6px' }}>{pickField === 'pickup' ? tx('Punto de recogida') : tx('Destino')}</p>
          <p style={{ fontSize: 16, fontWeight: 800, margin: '0 0 14px', minHeight: 22 }}>{pinPlace ? pinPlace.address : tx('Mueve el mapa para elegir el punto…')}</p>
          <Btn disabled={!pinPlace || busy} onClick={() => {
            if (pickField === 'pickup') { setPickup(pinPlace); if (dropoff) getQuote(pinPlace, dropoff, promo); else { setPickField('dropoff'); setStep('search'); } }
            else { setDropoff(pinPlace); if (pickup) getQuote(pickup, pinPlace, promo); else { setPickField('pickup'); setStep('search'); } }
          }}>{tx('Confirmar')}</Btn>
        </Sheet>
      )}

      {step === 'quote' && quote && (
        <QuotePanel quote={quote} settings={settings} rideTypeId={rideTypeId} setRideTypeId={setRideTypeId} payment={payment} setPayment={setPayment}
          promo={promo} setPromo={setPromo} applyPromo={() => getQuote(pickup, dropoff, promo)} pickup={pickup} dropoff={dropoff}
          onEdit={(f) => { setPickField(f); setStep('search'); }} onOrder={order} busy={busy} />
      )}

      {inTrip && (
        <TripPanel booking={booking} settings={settings} driverPos={driverPos} notify={notify} reload={() => loadBooking(booking.code)}
          onCall={() => booking.driver?.user_id && navigate(`/call/${booking.driver.user_id}`)}
          onDone={resetRide}
          onRetry={() => {
            const p = { lat: booking.pickup_lat, lng: booking.pickup_lng, address: booking.pickup_address };
            const d = { lat: booking.dropoff_lat, lng: booking.dropoff_lng, address: booking.dropoff_address };
            setPickup(p); setDropoff(d); setBooking(null); getQuote(p, d, promo);
          }} />
      )}

      {cardPay && (
        <CardPay card={cardPay.card} lang={lang} title={tx('Pagar con tarjeta de crédito')}
          note={tx('Se reserva {amount} en tu tarjeta y se cobra al terminar el viaje. Si se cancela sin gastos, la reserva se libera.', { amount: money(cardPay.booking.estimated_fare, cardPay.booking.currency) })}
          payLabel={`${tx('Confirmar y pedir')} · ${money(cardPay.booking.estimated_fare, cardPay.booking.currency)}`}
          onPaid={cardConfirmed} onCancel={cardCancelled} />
      )}
    </div>
  );
}

function RoundBtn({ children, onClick, label }) {
  return (
    <button onClick={onClick} aria-label={label} title={label} style={{ width: 44, height: 44, borderRadius: '50%', background: 'white', border: 'none', boxShadow: '0 2px 10px rgba(0,0,0,0.2)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', pointerEvents: 'auto' }}>{children}</button>
  );
}

// ── Buscador de direcciones (Photon propio) ──────────────────────────────────
function SearchPanel({ lang, near, pickup, dropoff, field, setField, onPick, onMap, onMine, onClose, busy }) {
  const [q, setQ] = useState({ pickup: pickup?.address || '', dropoff: dropoff?.address || '' });
  const [places, setPlaces] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const t = useRef(null);
  const pickRef = useRef(null), dropRef = useRef(null);

  useEffect(() => { (field === 'pickup' ? pickRef : dropRef).current?.focus(); setPlaces([]); }, [field]);
  useEffect(() => { setQ({ pickup: pickup?.address || '', dropoff: dropoff?.address || '' }); }, [pickup?.address, dropoff?.address]);

  const search = (text) => {
    setQ(v => ({ ...v, [field]: text }));
    clearTimeout(t.current);
    if (text.trim().length < 2) { setPlaces([]); return; }
    t.current = setTimeout(async () => {
      setLoading(true); setError('');
      try {
        const bias = near ? `&lat=${near.lat}&lng=${near.lng}` : '';
        const r = await taxiApi(`/maps/search?q=${encodeURIComponent(text.trim())}${bias}&lang=${lang}`);
        setPlaces(r.places || []);
      } catch (e) { setError(e.message); setPlaces([]); }
      setLoading(false);
    }, 300);
  };

  const row = (key, ref, dot) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      {dot}
      <input ref={ref} value={q[key]} onFocus={() => setField(key)} onChange={e => search(e.target.value)}
        placeholder={key === 'pickup' ? tx('Punto de recogida') : tx('¿A dónde vas?')}
        style={{ ...inputStyle, background: field === key ? 'white' : '#f1f5f9', borderColor: field === key ? BRAND : 'transparent' }} />
    </div>
  );

  return (
    <div style={{ position: 'absolute', inset: 0, background: 'white', zIndex: 5, display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: 'calc(var(--sat) + 10px) 14px 12px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <button onClick={onClose} aria-label={tx('Volver')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={BRAND} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M15 19l-7-7 7-7" /></svg>
          </button>
          <p style={{ margin: 0, fontWeight: 900, fontSize: 17 }}>{tx('Tu viaje')}</p>
        </div>
        <div style={{ display: 'grid', gap: 8 }}>
          {row('pickup', pickRef, <span style={{ width: 10, height: 10, borderRadius: '50%', background: C.ok, flexShrink: 0 }} />)}
          {row('dropoff', dropRef, <span style={{ width: 10, height: 10, background: BRAND, flexShrink: 0 }} />)}
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {field === 'pickup' && <ListRow icon="📍" title={tx('Usar mi ubicación actual')} onClick={onMine} />}
        <ListRow icon="🗺️" title={tx('Elegir en el mapa')} onClick={onMap} />
        {(loading || busy) && <div style={{ display: 'flex', justifyContent: 'center', padding: 18 }}><Spinner /></div>}
        {error && <p style={{ color: C.danger, padding: '8px 18px', fontWeight: 700 }}>{error}</p>}
        {places.map((p, i) => (
          <ListRow key={i} icon="📌" title={p.name || p.address} subtitle={p.name ? p.address : p.city}
            onClick={() => onPick({ lat: p.lat, lng: p.lng, address: p.address || p.name })} />
        ))}
        {!loading && !error && q[field].trim().length >= 2 && !places.length && <p style={{ color: C.muted, padding: '8px 18px' }}>{tx('Sin resultados')}</p>}
      </div>
    </div>
  );
}

function ListRow({ icon, title, subtitle, onClick }) {
  return (
    <button onClick={onClick} style={{ width: '100%', display: 'flex', gap: 12, alignItems: 'center', padding: '13px 18px', background: 'none', border: 'none',
      borderBottom: `1px solid ${C.line}`, cursor: 'pointer', textAlign: 'left' }}>
      <span style={{ fontSize: 20, width: 28, textAlign: 'center' }}>{icon}</span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontWeight: 800, color: C.text, fontSize: 15 }}>{title}</span>
        {subtitle && <span style={{ display: 'block', color: C.muted, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{subtitle}</span>}
      </span>
    </button>
  );
}

// ── Tipos de viaje, precio y pago ────────────────────────────────────────────
function QuotePanel({ quote, settings, rideTypeId, setRideTypeId, payment, setPayment, promo, setPromo, applyPromo, pickup, dropoff, onEdit, onOrder, busy }) {
  const cur = quote.currency?.code || 'EUR';
  const sel = quote.options.find(o => o.rideType.id === rideTypeId);
  const methods = [
    settings.payments.cash && { key: 'cash', label: tx('Efectivo'), icon: '💶' },
    settings.payments.wallet && { key: 'wallet', label: tx('Monedero'), icon: '👛' },
    settings.payments.stripe && { key: 'stripe', label: tx('Tarjeta de crédito'), icon: '💳' },
  ].filter(Boolean);
  useEffect(() => { if (methods.length && !methods.some(m => m.key === payment)) setPayment(methods[0].key); }, [methods.length]); // eslint-disable-line
  const [showPromo, setShowPromo] = useState(!!promo);

  return (
    <Sheet style={{ maxHeight: '62%' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 4, marginBottom: 10 }}>
        <AddrLine dot={C.ok} text={pickup?.address} onClick={() => onEdit('pickup')} />
        <AddrLine dot={BRAND} square text={dropoff?.address} onClick={() => onEdit('dropoff')} />
      </div>
      <p style={{ fontSize: 12, color: C.muted, margin: '0 0 8px', fontWeight: 700 }}>
        {quote.route.distanceKm} km · {Math.round(quote.route.durationMin)} min{quote.route.estimated ? ` · ${tx('estimado')}` : ''}
        {quote.zone?.surge > 1 ? ` · ${tx('alta demanda')} ×${quote.zone.surge}` : ''}
      </p>
      {!quote.served ? (
        <p style={{ background: '#fef3c7', color: '#92400e', padding: 12, borderRadius: 12, fontWeight: 700 }}>{tx('Todavía no damos servicio en esta zona')}</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 8, marginBottom: 12 }}>
          {quote.options.map(o => {
            const on = o.rideType.id === rideTypeId;
            return (
              <button key={o.rideType.id} onClick={() => setRideTypeId(o.rideType.id)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '7px 12px', borderRadius: 14,
                border: `2px solid ${on ? BRAND : C.line}`, background: on ? '#E3EDF2' : 'white', cursor: 'pointer', textAlign: 'left' }}>
                {o.rideType.icon ? <img src={taxiUrl(o.rideType.icon)} alt="" style={{ width: 44, height: 30, objectFit: 'contain' }} /> : <span style={{ fontSize: 26, width: 44, textAlign: 'center' }}>{rideEmoji(o.rideType.code)}</span>}
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontWeight: 900, fontSize: 16, color: C.text }}>{o.rideType.name} <span style={{ fontWeight: 600, fontSize: 12, color: C.muted }}>👤{o.rideType.seats}</span></span>
                  <span style={{ display: 'block', fontSize: 12, color: C.muted }}>{o.etaMin ? tx('Llega en {n} min', { n: o.etaMin }) : tx('Sin conductores cerca ahora')}</span>
                </span>
                <span style={{ textAlign: 'right' }}>
                  <span style={{ display: 'block', fontWeight: 900, fontSize: 16, color: C.text }}>{money(o.price.total, cur)}</span>
                  {o.price.discount > 0 && <span style={{ display: 'block', fontSize: 12, color: C.ok, fontWeight: 700 }}>−{money(o.price.discount, cur)}</span>}
                </span>
              </button>
            );
          })}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        {methods.map(m => (
          <button key={m.key} onClick={() => setPayment(m.key)} style={{ padding: '8px 12px', borderRadius: 20, border: `1.5px solid ${payment === m.key ? BRAND : C.line}`,
            background: payment === m.key ? '#E3EDF2' : 'white', color: payment === m.key ? BRAND : C.text, fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>{m.icon} {m.label}</button>
        ))}
        <button onClick={() => setShowPromo(v => !v)} style={{ padding: '8px 12px', borderRadius: 20, border: `1.5px dashed ${C.line}`, background: 'white', color: C.muted, fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>🏷️ {tx('Código promocional')}</button>
      </div>
      {showPromo && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <input value={promo} onChange={e => setPromo(e.target.value.toUpperCase())} placeholder={tx('Código')} style={{ ...inputStyle, padding: '10px 12px' }} maxLength={30} />
          <button onClick={applyPromo} disabled={!promo.trim() || busy} style={{ padding: '0 16px', borderRadius: 12, border: 'none', background: '#D5E6F0', color: BRAND, fontWeight: 800, cursor: 'pointer' }}>{tx('Aplicar')}</button>
        </div>
      )}
      {quote.promoError && promo && <p style={{ color: C.danger, fontSize: 13, fontWeight: 700, margin: '0 0 10px' }}>{tx(quote.promoError)}</p>}
      <div style={{ position: 'sticky', bottom: -14, background: 'white', padding: '6px 0 14px', margin: '0 0 -14px' }}>
        <Btn onClick={onOrder} disabled={!quote.served || !sel || busy || !methods.length}>
          {busy ? tx('Un momento…') : sel ? `${tx('Pedir')} ${sel.rideType.name} · ${money(sel.price.total, cur)}` : tx('Pedir')}
        </Btn>
      </div>
    </Sheet>
  );
}

function AddrLine({ dot, square, text, onClick }) {
  return (
    <button onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'none', border: 'none', padding: '4px 0', cursor: 'pointer', textAlign: 'left', width: '100%' }}>
      <span style={{ width: 10, height: 10, borderRadius: square ? 0 : '50%', background: dot, flexShrink: 0 }} />
      <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 700, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{text}</span>
    </button>
  );
}

// ── Viaje en curso ───────────────────────────────────────────────────────────
const PAY_LABEL = { cash: 'Efectivo', wallet: 'Monedero', stripe: 'Tarjeta de crédito' };

function TripPanel({ booking: b, settings, driverPos, notify, reload, onCall, onDone, onRetry }) {
  const cur = b.currency || 'EUR';
  const [confirmCancel, setConfirmCancel] = useState(null);   // null | { fee }
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const rated = b.ratings?.some(r => r.from_type === 'customer');

  const askCancel = async () => {
    try { const { fee } = await taxiApi(`/customer/bookings/${b.code}/cancel-fee`); setConfirmCancel({ fee }); }
    catch (e) { notify(e.message, true); }
  };
  const doCancel = async () => {
    setBusy(true);
    try { await taxiApi(`/customer/bookings/${b.code}/cancel`, { method: 'POST', body: { reason: 'Cancelado por el cliente' } }); setConfirmCancel(null); await reload(); }
    catch (e) { notify(e.message, true); }
    setBusy(false);
  };
  const rate = async () => {
    setBusy(true);
    try { await taxiApi(`/customer/bookings/${b.code}/rate`, { method: 'POST', body: { stars, comment } }); notify(tx('¡Gracias por tu valoración!')); onDone(); }
    catch (e) { notify(e.message, true); }
    setBusy(false);
  };

  const eta = driverPos && b.status === 'accepted' ? Math.max(1, Math.round(km(driverPos, { lat: b.pickup_lat, lng: b.pickup_lng }) * 1.3 / 25 * 60)) : null;
  const payLabel = tx(PAY_LABEL[b.payment_method] || b.payment_method);
  const cancel = <CancelBox cur={cur} confirm={confirmCancel} setConfirm={setConfirmCancel} onAsk={askCancel} onCancel={doCancel} busy={busy} />;

  if (b.status === 'searching') return (
    <Sheet>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '8px 0 4px' }}>
        <div style={{ position: 'relative', width: 70, height: 70, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: `${BRAND}22`, animation: 'taxiPulse 1.6s ease-out infinite' }} />
          <span style={{ fontSize: 34 }}>🚕</span>
        </div>
        <p style={{ fontWeight: 900, fontSize: 18, margin: 0 }}>{tx('Buscando conductor…')}</p>
        <p style={{ color: C.muted, margin: 0, fontSize: 14, textAlign: 'center' }}>{b.rideType?.name} · {money(b.estimated_fare, cur)} · {payLabel}</p>
      </div>
      {cancel}
      <style>{'@keyframes taxiPulse{0%{transform:scale(.6);opacity:1}100%{transform:scale(1.6);opacity:0}}'}</style>
    </Sheet>
  );

  if (['accepted', 'arrived', 'started'].includes(b.status)) return (
    <Sheet>
      <p style={{ fontWeight: 900, fontSize: 18, margin: '0 0 2px' }}>
        {b.status === 'accepted' ? tx('Tu conductor va de camino') : b.status === 'arrived' ? tx('Tu conductor ha llegado') : tx('En viaje')}
      </p>
      <p style={{ color: C.muted, margin: '0 0 12px', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {b.status === 'accepted' ? (eta ? tx('Llega en {n} min', { n: eta }) : b.pickup_address) : b.status === 'arrived' ? b.pickup_address : `${tx('Destino')}: ${b.dropoff_address}`}
      </p>
      <DriverCard b={b} />
      {settings.otpRequired && b.start_otp && b.status !== 'started' && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#E3EDF2', borderRadius: 14, padding: '10px 14px', margin: '12px 0 0' }}>
          <span style={{ fontSize: 13, fontWeight: 800, color: BRAND }}>{tx('Código para empezar el viaje')}<br /><span style={{ fontWeight: 600, color: C.muted, fontSize: 12 }}>{tx('Díselo al conductor al subir')}</span></span>
          <span style={{ fontSize: 28, fontWeight: 900, letterSpacing: 6, color: BRAND }}>{b.start_otp}</span>
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <TripChatButton code={b.code} role="customer" otherName={b.driver?.name} label={tx('Mensaje')}
          style={{ flex: 1.6, width: 'auto', height: 'auto', minHeight: 44, borderRadius: 14 }} />
        <Btn variant="soft" onClick={onCall} style={{ flex: 1, padding: '12px 6px', fontSize: 14 }}>📞 {tx('Llamar')}</Btn>
        <Btn variant="soft" onClick={() => shareTrip(b)} style={{ flex: '0 0 48px', padding: '12px 0', fontSize: 16 }}>
          <span role="img" aria-label={tx('Compartir')} title={tx('Compartir')}>🔗</span>
        </Btn>
        {b.status === 'started' && <Btn variant="danger" onClick={() => { window.location.href = 'tel:112'; }} style={{ flex: 1, padding: '12px 6px', fontSize: 14 }}>🆘 SOS</Btn>}
      </div>
      {/* Con el conductor ya en camino el cliente no puede cancelar (solo mientras se busca conductor) */}
      <p style={{ textAlign: 'center', color: C.muted, fontSize: 13, margin: '12px 0 0' }}>{money(b.estimated_fare, cur)} · {payLabel}</p>
    </Sheet>
  );

  if (b.status === 'completed') return (
    <Sheet>
      <p style={{ fontWeight: 900, fontSize: 20, margin: '0 0 4px', textAlign: 'center' }}>{tx('Has llegado a tu destino')}</p>
      <p style={{ fontWeight: 900, fontSize: 30, margin: '6px 0', textAlign: 'center', color: BRAND }}>{money(b.total_amount, cur)}</p>
      <p style={{ color: C.muted, textAlign: 'center', margin: '0 0 14px', fontSize: 13 }}>{payLabel}{b.payment_method === 'cash' ? ` · ${tx('Paga al conductor')}` : b.payment_method === 'stripe' ? ` · ${tx('Se cobra en tu tarjeta')}` : ''}</p>
      {!rated ? (
        <>
          <p style={{ textAlign: 'center', fontWeight: 800, margin: '0 0 8px' }}>{tx('¿Qué tal con {name}?', { name: b.driver?.name || tx('tu conductor') })}</p>
          <Stars value={stars} onChange={setStars} />
          <textarea value={comment} onChange={e => setComment(e.target.value)} placeholder={tx('Comentario (opcional)')} rows={2} maxLength={500} style={{ ...inputStyle, marginTop: 12, resize: 'none' }} />
          <Btn onClick={rate} disabled={!stars || busy} style={{ marginTop: 10 }}>{tx('Enviar valoración')}</Btn>
          <Btn variant="ghost" onClick={onDone} style={{ marginTop: 8 }}>{tx('Ahora no')}</Btn>
        </>
      ) : <Btn onClick={onDone}>{tx('Hecho')}</Btn>}
    </Sheet>
  );

  // cancelado o sin conductores
  return (
    <Sheet>
      <p style={{ fontWeight: 900, fontSize: 18, margin: '0 0 6px', textAlign: 'center' }}>
        {b.status === 'expired' ? tx('No hay conductores disponibles ahora mismo') : tx('Viaje cancelado')}
      </p>
      {b.cancel_fee > 0 && <p style={{ color: C.muted, textAlign: 'center', margin: '0 0 10px' }}>{tx('Gastos de cancelación')}: {money(b.cancel_fee, cur)}</p>}
      <Btn onClick={onRetry} style={{ marginTop: 8 }}>{tx('Volver a intentarlo')}</Btn>
      <Btn variant="ghost" onClick={onDone} style={{ marginTop: 8 }}>{tx('Cerrar')}</Btn>
    </Sheet>
  );
}

function CancelBox({ cur, confirm, setConfirm, onAsk, onCancel, busy }) {
  if (!confirm) return <button onClick={onAsk} style={{ display: 'block', margin: '12px auto 0', background: 'none', border: 'none', color: C.danger, fontWeight: 800, cursor: 'pointer', fontSize: 14 }}>{tx('Cancelar viaje')}</button>;
  return (
    <div style={{ background: '#fef2f2', borderRadius: 14, padding: 12, marginTop: 12 }}>
      <p style={{ margin: '0 0 10px', fontWeight: 800, color: C.danger, fontSize: 14 }}>
        {confirm.fee > 0 ? tx('¿Cancelar el viaje? Se cobrarán {fee} de gastos de cancelación.', { fee: money(confirm.fee, cur) }) : tx('¿Seguro que quieres cancelar el viaje?')}
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <Btn variant="ghost" onClick={() => setConfirm(null)} style={{ flex: 1, padding: 10 }}>{tx('No')}</Btn>
        <Btn variant="danger" onClick={onCancel} disabled={busy} style={{ flex: 1, padding: 10 }}>{tx('Sí, cancelar')}</Btn>
      </div>
    </div>
  );
}

function DriverCard({ b }) {
  const d = b.driver || {}, v = b.vehicle || {};
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      {d.photo ? <img src={taxiUrl(d.photo)} alt="" style={{ width: 54, height: 54, borderRadius: '50%', objectFit: 'cover' }} />
               : <span style={{ width: 54, height: 54, borderRadius: '50%', background: '#D5E6F0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26 }}>🧑‍✈️</span>}
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: 0, fontWeight: 900, fontSize: 16 }}>{d.name}</p>
        <p style={{ margin: 0, fontSize: 13, color: C.muted }}>★ {Number(d.rating || 5).toFixed(1)} · {[v.brand, v.model, v.color].filter(Boolean).join(' ')}</p>
      </div>
      {v.plate && <span style={{ background: '#f1f5f9', border: `1.5px solid ${C.line}`, borderRadius: 8, padding: '6px 10px', fontWeight: 900, letterSpacing: 1, fontSize: 15 }}>{v.plate}</span>}
    </div>
  );
}

async function shareTrip(b) {
  const text = `${tx('Voy en un taxi de OldFace')}: ${b.pickup_address} → ${b.dropoff_address}. ${tx('Conductor')}: ${b.driver?.name || ''} ${b.vehicle?.plate ? `(${b.vehicle.plate})` : ''}`;
  try {
    const { Capacitor } = await import('@capacitor/core');
    if (Capacitor.isNativePlatform()) { const { Share } = await import('@capacitor/share'); await Share.share({ text }); return; }
  } catch { /* web */ }
  try { if (navigator.share) await navigator.share({ text }); else await navigator.clipboard.writeText(text); } catch { /* cancelado */ }
}

const RIDE_EMOJI = { moto: '🏍️', bike: '🏍️', economy: '🚗', comfort: '🚘', premium: '🚘', xl: '🚐', van: '🚐' };
const rideEmoji = (code) => RIDE_EMOJI[String(code || '').toLowerCase()] || '🚕';

function km(a, b) {
  const R = 6371, toR = (x) => x * Math.PI / 180;
  const dLat = toR(b.lat - a.lat), dLng = toR(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
