/**
 * DriverApp — parte del CONDUCTOR del taxi (su propia interfaz y su panel):
 *   Alta: vehículo + documentos → aprobación del equipo (lista de pasos pendientes).
 *   Inicio: mapa con mi posición → Conectarse → ofertas con cuenta atrás (aceptar / rechazar) → ir a recoger
 *           (ruta y navegación) → He llegado → código de 4 cifras del cliente → En viaje → Finalizar (cobro) → valorar.
 *   Pestañas: Inicio · Ganancias · Viajes · Cuenta
 * Mientras está conectado manda su posición en tiempo real (la usa el reparto de viajes y el cliente la ve en su mapa),
 * también con el móvil bloqueado (servicio nativo de ubicación, ver trackDriver); las ofertas llegan además por push.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { taxiApi, taxiSocket, tx, money, decodePolyline, currentPosition, trackDriver, openNavigation, taxiUrl } from '../../utils/taxiApi';
import { playMessageSound } from '../../utils/sounds';
import { BRAND, C, Header, Btn, Card, Sheet, Spinner, Center, Toast, Stars, Tabs, inputStyle } from './ui.jsx';
import TaxiMap from './TaxiMap.jsx';
import { TripChatButton } from './TripChat.jsx';
import { EarningsTab, DriverTripsTab, AccountTab } from './DriverTabs.jsx';

const GREEN = '#16a34a';
const PAY = { cash: 'Efectivo', wallet: 'Monedero', stripe: 'Tarjeta de crédito' };

export default function DriverApp({ boot, reload, onExit }) {
  const [tab, setTab] = useState('home');
  const [accountSub, setAccountSub] = useState(null);
  const [dash, setDash] = useState(null);
  const [dashError, setDashError] = useState('');
  const [toast, setToast] = useState(null);
  const timer = useRef(null);
  const notify = useCallback((msg, err = false) => {
    setToast({ msg, err });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  const loadDash = useCallback(async () => {
    try { const d = await taxiApi('/driver/dashboard'); setDash(d); setDashError(''); return d; }
    catch (e) { setDashError(e.message); return null; }
  }, []);
  useEffect(() => { loadDash(); }, [loadDash]);
  // Al volver a la app (desde un aviso push o al desbloquear) → datos al día y la oferta pendiente, si la hay
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') loadDash(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [loadDash]);

  const openAccount = (sub) => { setAccountSub(sub); setTab('account'); };

  const tabs = [
    { key: 'home', icon: '🚖', label: tx('Inicio') },
    { key: 'earnings', icon: '💶', label: tx('Ganancias') },
    { key: 'trips', icon: '🧾', label: tx('Viajes') },
    { key: 'account', icon: '👤', label: tx('Cuenta') },
  ];

  if (!dash) return (
    <>
      <Header title={tx('Conductor')} onBack={onExit} />
      <Center>{dashError ? <><p style={{ fontWeight: 700 }}>{dashError}</p><div style={{ width: 200 }}><Btn onClick={loadDash}>{tx('Reintentar')}</Btn></div></> : <Spinner />}</Center>
    </>
  );

  return (
    <>
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {/* El inicio sigue montado: no se pierden la conexión, la posición ni el viaje en curso */}
        <div style={{ position: 'absolute', inset: 0, visibility: tab === 'home' ? 'visible' : 'hidden' }}>
          <DriverHome boot={boot} dash={dash} loadDash={loadDash} notify={notify} onExit={onExit} openAccount={openAccount} />
        </div>
        {tab === 'earnings' && <EarningsTab dash={dash} loadDash={loadDash} notify={notify} openAccount={openAccount} />}
        {tab === 'trips' && <DriverTripsTab notify={notify} />}
        {tab === 'account' && <AccountTab boot={boot} dash={dash} loadDash={loadDash} notify={notify} reload={reload} onExit={onExit} sub={accountSub} setSub={setAccountSub} />}
      </div>
      <Tabs tabs={tabs} value={tab} onChange={(t) => { setTab(t); if (t !== 'account') setAccountSub(null); }} />
      <Toast {...(toast || {})} />
    </>
  );
}

// ══ Inicio ═══════════════════════════════════════════════════════════════════
function DriverHome({ boot, dash, loadDash, notify, onExit, openAccount }) {
  const navigate = useNavigate();
  const settings = boot.settings;
  const lang = boot.language?.code || 'es';
  const cur = dash.wallet?.currency || settings.currency?.code || 'EUR';
  const online = !!dash.driver.online;
  const ob = dash.onboarding;

  const [pos, setPos] = useState(dash.driver.lat ? { lat: dash.driver.lat, lng: dash.driver.lng } : null);
  const [center, setCenter] = useState(pos);
  const [offer, setOffer] = useState(null);
  const [trip, setTrip] = useState(dash.activeTrip || null);
  const [pickupRoute, setPickupRoute] = useState(null);
  const [fit, setFit] = useState(0);
  const [busy, setBusy] = useState(false);
  const posRef = useRef(pos); posRef.current = pos;
  const tripRef = useRef(trip); tripRef.current = trip;
  const offerRef = useRef(offer); offerRef.current = offer;
  const sockRef = useRef(null);

  // Oferta pendiente al abrir la app
  useEffect(() => {
    if (!dash.pendingOffer || offer) return;
    taxiApi(`/driver/offers/${dash.pendingOffer}`).then(({ offer: o }) => setOffer({ ...o, receivedAt: Date.now() })).catch(() => {});
  }, [dash.pendingOffer]); // eslint-disable-line

  // Oferta abierta desde el aviso "Nuevo servicio" (pantalla nativa o push) con el taxi ya abierto
  useEffect(() => {
    const onTaxiOffer = (e) => {
      const code = e.detail?.code;
      if (!code || offerRef.current?.code === code) return;
      if (tripRef.current && ['accepted', 'arrived', 'started'].includes(tripRef.current.status)) return;
      taxiApi(`/driver/offers/${code}`).then(({ offer: o }) => { setOffer({ ...o, receivedAt: Date.now() }); setFit(f => f + 1); })
        .catch(() => notify(tx('La oferta ya no está disponible'), true));
    };
    window.addEventListener('taxi:offer', onTaxiOffer);
    return () => window.removeEventListener('taxi:offer', onTaxiOffer);
  }, [notify]);

  // Primera posición para centrar el mapa
  useEffect(() => {
    if (pos) return;
    currentPosition().then(p => { setPos(p); setCenter(p); }).catch(() => {
      const c = boot.countries.find(x => x.id === dash.driver.country_id) || boot.countries.find(x => x.is_default);
      if (c?.lat) setCenter({ lat: c.lat, lng: c.lng });
    });
  }, []); // eslint-disable-line

  const reloadTrip = useCallback(async (code) => {
    try { const { booking } = await taxiApi(`/driver/bookings/${code}`); setTrip(booking); return booking; }
    catch { return null; }
  }, []);

  // Tiempo real: ofertas y cambios del viaje
  useEffect(() => {
    let s, alive = true;
    const onOffer = (o) => {
      if (tripRef.current && ['accepted', 'arrived', 'started'].includes(tripRef.current.status)) return;
      setOffer({ ...o, receivedAt: Date.now() }); setFit(f => f + 1);
      try { navigator.vibrate?.([300, 150, 300]); } catch { /* sin vibración */ }
    };
    const onExpired = (p) => { if (offerRef.current?.code === p.code) { setOffer(null); notify(tx('La oferta ha caducado')); } };
    const onUpdate = (p) => {
      const t = tripRef.current;
      if (!t || p.code !== t.code) return;
      if (p.status === 'cancelled' && p.cancelledBy !== 'driver') { notify(tx('El cliente ha cancelado el viaje'), true); setTrip(null); setPickupRoute(null); loadDash(); return; }
      if (p.status !== 'cancelled') reloadTrip(p.code);
    };
    taxiSocket().then(sock => {
      if (!alive) return;
      s = sock; sockRef.current = sock;
      s.on('offer:new', onOffer); s.on('offer:expired', onExpired); s.on('booking:update', onUpdate);
    }).catch(() => {});
    return () => { alive = false; s?.off('offer:new', onOffer); s?.off('offer:expired', onExpired); s?.off('booking:update', onUpdate); };
  }, [notify, loadDash, reloadTrip]);

  // Sonido mientras hay una oferta abierta
  useEffect(() => {
    if (!offer) return;
    playMessageSound();
    const id = setInterval(playMessageSound, 3000);
    return () => clearInterval(id);
  }, [offer?.code]); // eslint-disable-line

  // Posición en directo mientras está conectado o con un viaje
  const tracking = online || !!(trip && ['accepted', 'arrived', 'started'].includes(trip.status));
  useEffect(() => {
    if (!tracking) return;
    const send = (p) => sockRef.current?.emit('driver:location', p);
    const stop = trackDriver((p) => { setPos(p); send(p); }, (e) => notify(e?.message || tx('No se pudo obtener tu ubicación'), true));
    const beat = setInterval(() => posRef.current && send(posRef.current), 20000);   // mantener la posición "reciente"
    return () => { stop(); clearInterval(beat); };
  }, [tracking, notify]);

  // Ruta hasta el punto de recogida
  useEffect(() => {
    if (!trip) { setPickupRoute(null); return; }
    if (!['accepted', 'arrived'].includes(trip.status) || !posRef.current || pickupRoute?.code === trip.code) return;
    taxiApi('/maps/route', { method: 'POST', body: { points: [posRef.current, { lat: trip.pickup_lat, lng: trip.pickup_lng }] } })
      .then(({ route }) => { setPickupRoute({ code: trip.code, line: decodePolyline(route.shape), km: route.distanceKm, min: route.durationMin }); setFit(f => f + 1); })
      .catch(() => {});
  }, [trip?.code, trip?.status, pos != null]); // eslint-disable-line

  const route = useMemo(() => {
    if (!trip) return null;
    if (['accepted', 'arrived'].includes(trip.status)) return pickupRoute?.code === trip.code ? pickupRoute.line : null;
    if (trip.status === 'started') return decodePolyline(trip.route_shape);
    return null;
  }, [trip?.code, trip?.status, trip?.route_shape, pickupRoute]); // eslint-disable-line

  const [bgSetup, setBgSetup] = useState(false);

  const toggleOnline = async () => {
    setBusy(true);
    try {
      let p = posRef.current;
      if (!online) p = await Promise.race([currentPosition(), new Promise(r => setTimeout(() => r(posRef.current), 8000))]).catch(() => posRef.current);
      if (p) setPos(p);
      await taxiApi('/driver/online', { method: 'POST', body: { online: !online, lat: p?.lat, lng: p?.lng } });
      if (!online && p) sockRef.current?.emit('driver:location', p);
      await loadDash();
      notify(online ? tx('Te has desconectado') : tx('Conectado: ya puedes recibir viajes'));
      if (!online && needsBackgroundSetup()) setBgSetup(true);   // la primera vez: ajustes para recibir viajes con la app cerrada
    } catch (e) { notify(e.message, true); }
    setBusy(false);
  };

  const act = async (fn) => {
    setBusy(true);
    try { await fn(); } catch (e) { notify(e.message, true); }
    setBusy(false);
  };
  const accept = () => act(async () => {
    const code = offer.code;
    setOffer(null);
    const { booking } = await taxiApi(`/driver/offers/${code}/accept`, { method: 'POST' });
    setTrip(booking); setFit(f => f + 1);
  });
  const reject = () => act(async () => { const code = offer.code; setOffer(null); await taxiApi(`/driver/offers/${code}/reject`, { method: 'POST' }); });
  const step = (path, body) => act(async () => { const { booking } = await taxiApi(`/driver/bookings/${trip.code}/${path}`, { method: 'POST', body }); setTrip(booking); setFit(f => f + 1); });
  const cancelTrip = (reason) => act(async () => { await taxiApi(`/driver/bookings/${trip.code}/cancel`, { method: 'POST', body: { reason } }); setTrip(null); await loadDash(); notify(tx('Viaje cancelado')); });
  const finish = () => { setTrip(null); loadDash(); };

  // Sin completar el alta: lista de pasos
  if (!ob.canGoOnline && !trip) return <Onboarding dash={dash} loadDash={loadDash} openAccount={openAccount} onExit={onExit} />;

  const inTrip = trip && ['accepted', 'arrived', 'started', 'completed'].includes(trip.status);
  const tripPickup = trip ? { lat: trip.pickup_lat, lng: trip.pickup_lng } : null;
  const tripDrop = trip ? { lat: trip.dropoff_lat, lng: trip.dropoff_lng } : null;

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <TaxiMap config={settings.map} lang={lang} center={center} driver={pos}
               pickup={offer ? offer.pickup : inTrip && trip.status !== 'started' ? tripPickup : null}
               dropoff={offer ? offer.dropoff : inTrip ? tripDrop : null}
               route={offer ? null : route} fit={fit} padding={{ top: 80, bottom: Math.round(window.innerHeight * 0.5) }} />

      {/* Barra superior: volver · estado · centrar */}
      <div style={{ position: 'absolute', top: 'calc(var(--sat) + 10px)', left: 12, right: 12, display: 'flex', alignItems: 'center', gap: 10, zIndex: 3 }}>
        <RoundBtn label={tx('Volver')} onClick={onExit}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={BRAND} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M15 19l-7-7 7-7" /></svg>
        </RoundBtn>
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
          <span style={{ background: 'white', borderRadius: 20, padding: '8px 14px', boxShadow: '0 2px 10px rgba(0,0,0,0.2)', fontWeight: 900, fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: online ? GREEN : '#94a3b8' }} />
            {online ? tx('Conectado') : tx('Desconectado')} · {money(dash.today?.earnings, cur)}
          </span>
        </div>
        <RoundBtn label={tx('Mi ubicación')} onClick={() => pos && setCenter({ lat: pos.lat + Math.random() * 1e-7, lng: pos.lng })}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={BRAND} strokeWidth="2.2"><circle cx="12" cy="12" r="4" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></svg>
        </RoundBtn>
      </div>

      {offer ? <OfferPanel offer={offer} cur={cur} onAccept={accept} onReject={reject} onExpire={() => setOffer(null)} busy={busy} />
        : inTrip ? <TripPanel trip={trip} settings={settings} cur={cur} pickupRoute={pickupRoute} busy={busy} notify={notify}
                    onCall={() => trip.customer?.user_id && navigate(`/call/${trip.customer.user_id}`)}
                    onArrived={() => step('arrived')} onStart={(otp) => step('start', { otp })} onComplete={() => step('complete')}
                    onCancel={cancelTrip} onDone={finish} />
        : <IdlePanel online={online} dash={dash} cur={cur} busy={busy} onToggle={toggleOnline} openAccount={openAccount}
                     onBackgroundSetup={backgroundBridge() ? () => setBgSetup(true) : null} />}

      {bgSetup && <BackgroundSetup onClose={() => setBgSetup(false)} />}
    </div>
  );
}

// ── Ajustes del móvil para recibir viajes con la app cerrada (Android) ──────
// Notificaciones, pantalla completa, batería sin restricciones y el "Inicio automático" de cada marca.
const BG_SETUP_KEY = 'oldface_taxi_bg_setup_v1';
const backgroundBridge = () => (typeof window !== 'undefined' && window.OldFaceCalls?.backgroundSetup ? window.OldFaceCalls : null);
function readBackgroundStatus() {
  try { return JSON.parse(backgroundBridge()?.backgroundSetup() || 'null'); } catch { return null; }
}
/** ¿Hay que enseñar el asistente? (solo la primera vez y si queda algo por activar) */
function needsBackgroundSetup() {
  try { if (localStorage.getItem(BG_SETUP_KEY) === 'done') return false; } catch { /* sin almacenamiento */ }
  const st = readBackgroundStatus();
  return !!st && (st.autostart || !st.battery || !st.fullScreen || !st.notifications);
}

/** Qué hay que activar en el ajuste de "Inicio automático" de cada marca */
function autostartHelp(brand = '') {
  if (/samsung/.test(brand)) return tx('Añade OldFace a «Aplicaciones que nunca se suspenden» (Batería → Límites de uso en segundo plano).');
  if (/huawei|honor/.test(brand)) return tx('Busca OldFace, elige «Gestionar manualmente» y activa las tres opciones.');
  if (/xiaomi|redmi|poco/.test(brand)) return tx('Activa «Inicio automático» para OldFace. En Batería, elige «Sin restricciones».');
  if (/oppo|realme|oneplus|vivo/.test(brand)) return tx('Activa «Inicio automático» para OldFace y permite la actividad en segundo plano.');
  return tx('Permite que OldFace se inicie sola y funcione en segundo plano.');
}

function BackgroundSetup({ onClose }) {
  const [st, setSt] = useState(readBackgroundStatus);
  const [autoDone, setAutoDone] = useState(false);
  // Al volver de los ajustes del móvil, comprobar otra vez
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') setSt(readBackgroundStatus()); };
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => { document.removeEventListener('visibilitychange', refresh); window.removeEventListener('focus', refresh); };
  }, []);
  if (!st) return null;
  const open = (kind) => { try { backgroundBridge()?.openBackgroundSettings(kind); } catch { /* app antigua */ } };
  const finish = () => { try { localStorage.setItem(BG_SETUP_KEY, 'done'); } catch { /* sin almacenamiento */ } onClose(); };

  const steps = [
    { key: 'notifications', ok: st.notifications, title: tx('Notificaciones'), text: tx('Permite las notificaciones de OldFace.') },
    { key: 'fullscreen', ok: st.fullScreen, title: tx('Pantalla completa'), text: tx('Para que el aviso de nuevo servicio encienda la pantalla.') },
    { key: 'battery', ok: st.battery, title: tx('Batería sin restricciones'), text: tx('Para que los avisos lleguen en modo ahorro o con la pantalla apagada.') },
    ...(st.autostart ? [{ key: 'autostart', ok: autoDone, manual: true, title: tx('Inicio automático'), text: autostartHelp(st.brand) }] : []),
  ];

  return (
    <div role="dialog" aria-modal="true" style={{ position: 'absolute', inset: 0, zIndex: 20, background: 'rgba(10,13,37,0.55)', display: 'flex', alignItems: 'flex-end' }}>
      <div style={{ background: 'white', width: '100%', borderRadius: '22px 22px 0 0', padding: '20px 18px calc(var(--sab, 0px) + 18px)', maxHeight: '88%', overflowY: 'auto', color: C.text }}>
        <p style={{ fontWeight: 900, fontSize: 19, margin: 0 }}>📲 {tx('Recibe viajes con la app cerrada')}</p>
        <p style={{ color: C.muted, fontSize: 13, margin: '4px 0 14px' }}>
          {tx('Activa estos ajustes una sola vez para que te llegue la pantalla de «Nuevo servicio» aunque el móvil esté bloqueado, en ahorro de batería o con OldFace cerrada.')}
        </p>
        {steps.map((x, i) => (
          <div key={x.key} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderTop: i ? `1px solid ${C.line}` : 'none' }}>
            <span style={{ width: 30, height: 30, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900,
                           background: x.ok ? '#dcfce7' : '#f1f5f9', color: x.ok ? GREEN : C.muted }}>{x.ok ? '✓' : i + 1}</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontWeight: 800, fontSize: 15 }}>{x.title}</span>
              <span style={{ display: 'block', color: C.muted, fontSize: 12.5 }}>{x.text}</span>
            </span>
            {(!x.ok || x.manual) && (
              <button onClick={() => { open(x.key); if (x.manual) setAutoDone(true); }}
                      style={{ background: x.ok ? '#f1f5f9' : BRAND, color: x.ok ? BRAND : 'white', border: 'none', borderRadius: 12, padding: '9px 12px', fontWeight: 800, fontSize: 13, cursor: 'pointer', flexShrink: 0 }}>
                {x.ok ? tx('Abrir otra vez') : tx('Activar')}
              </button>
            )}
          </div>
        ))}
        <p style={{ color: C.muted, fontSize: 12, margin: '6px 0 14px' }}>
          💡 {tx('No cierres OldFace deslizándola desde las apps recientes: sal con el botón de inicio.')}
        </p>
        <div style={{ display: 'flex', gap: 10 }}>
          <Btn variant="soft" onClick={onClose} style={{ flex: 1 }}>{tx('Más tarde')}</Btn>
          <Btn onClick={finish} style={{ flex: 2 }}>{tx('Listo')}</Btn>
        </div>
      </div>
    </div>
  );
}

function RoundBtn({ children, onClick, label }) {
  return (
    <button onClick={onClick} aria-label={label} title={label} style={{ width: 44, height: 44, borderRadius: '50%', background: 'white', border: 'none', boxShadow: '0 2px 10px rgba(0,0,0,0.2)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>{children}</button>
  );
}

// ── Conectado / desconectado ─────────────────────────────────────────────────
function IdlePanel({ online, dash, cur, busy, onToggle, openAccount, onBackgroundSetup }) {
  const debt = Number(dash.driver.debt) || 0;
  return (
    <Sheet>
      {online ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <span style={{ position: 'relative', width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: `${GREEN}33`, animation: 'drvPulse 1.8s ease-out infinite' }} />
            <span style={{ fontSize: 24 }}>📡</span>
          </span>
          <span>
            <span style={{ display: 'block', fontWeight: 900, fontSize: 18 }}>{tx('Buscando viajes…')}</span>
            <span style={{ display: 'block', color: C.muted, fontSize: 13 }}>{tx('Te avisaremos en cuanto haya un viaje cerca')}</span>
          </span>
        </div>
      ) : (
        <div style={{ marginBottom: 12 }}>
          <p style={{ fontWeight: 900, fontSize: 18, margin: 0 }}>{tx('Estás desconectado')}</p>
          <p style={{ color: C.muted, fontSize: 13, margin: '2px 0 0' }}>{tx('Conéctate para empezar a recibir viajes')}</p>
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <Stat label={tx('Hoy')} value={money(dash.today?.earnings, cur)} sub={tx((dash.today?.trips || 0) === 1 ? '1 viaje' : '{n} viajes', { n: dash.today?.trips || 0 })} />
        <Stat label={tx('Monedero')} value={money(dash.wallet?.balance, cur)} />
        <Stat label={tx('Valoración')} value={`★ ${Number(dash.driver.rating || 5).toFixed(1)}`} />
      </div>
      {debt > 0 && (
        <button onClick={() => openAccount('cash')} style={{ width: '100%', textAlign: 'left', background: '#fef3c7', color: '#92400e', border: 'none', borderRadius: 12, padding: 10, fontSize: 13, fontWeight: 700, marginBottom: 12, cursor: 'pointer' }}>
          ⚠️ {tx('Debes {amount} de comisiones de viajes en efectivo. Ver puntos de pago ›', { amount: money(debt, cur) })}
        </button>
      )}
      {online ? <Btn variant="danger" onClick={onToggle} disabled={busy}>{busy ? tx('Un momento…') : tx('Desconectarse')}</Btn>
              : <Btn onClick={onToggle} disabled={busy} style={{ background: GREEN }}>{busy ? tx('Un momento…') : tx('Conectarse')}</Btn>}
      {onBackgroundSetup && (
        <button onClick={onBackgroundSetup} style={{ width: '100%', background: 'none', border: 'none', color: BRAND, fontSize: 13, fontWeight: 800, padding: '12px 0 0', cursor: 'pointer' }}>
          ⚙️ {tx('Ajustes del móvil para recibir viajes con la app cerrada')}
        </button>
      )}
      <style>{'@keyframes drvPulse{0%{transform:scale(.6);opacity:1}100%{transform:scale(1.5);opacity:0}}'}</style>
    </Sheet>
  );
}

function Stat({ label, value, sub }) {
  return (
    <div style={{ flex: 1, background: '#f1f5f9', borderRadius: 12, padding: '8px 10px', minWidth: 0 }}>
      <span style={{ display: 'block', fontSize: 11, fontWeight: 800, color: C.muted }}>{label}</span>
      <span style={{ display: 'block', fontSize: 16, fontWeight: 900, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</span>
      {sub && <span style={{ display: 'block', fontSize: 11, color: C.muted }}>{sub}</span>}
    </div>
  );
}

// ── Oferta con cuenta atrás ──────────────────────────────────────────────────
function OfferPanel({ offer, cur, onAccept, onReject, onExpire, busy }) {
  const total = Math.max(1, offer.expiresIn || 20);
  const calc = () => Math.max(0, Math.round((offer.receivedAt + total * 1000 - Date.now()) / 1000));
  const [left, setLeft] = useState(calc);
  useEffect(() => {
    const id = setInterval(() => { const l = calc(); setLeft(l); if (l <= 0) { clearInterval(id); onExpire(); } }, 500);
    return () => clearInterval(id);
  }, [offer.code]); // eslint-disable-line
  return (
    <Sheet>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
        <span style={{ minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 13, fontWeight: 800, color: BRAND }}>{tx('Nuevo viaje')} · {offer.rideType}</span>
          <span style={{ display: 'block', fontSize: 28, fontWeight: 900 }}>{money(offer.fare, offer.currency || cur)}</span>
          <span style={{ display: 'block', fontSize: 12, color: C.muted, fontWeight: 700 }}>{tx(PAY[offer.paymentMethod] || offer.paymentMethod)} · {offer.distanceKm} km · {Math.round(offer.durationMin || 0)} min</span>
        </span>
        <Countdown left={left} total={total} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 6, marginBottom: 14 }}>
        <Addr dot={GREEN} text={offer.pickup?.address} extra={tx('A {km} km de ti', { km: offer.pickupKm })} />
        <Addr dot={BRAND} square text={offer.dropoff?.address} />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <Btn variant="ghost" onClick={onReject} disabled={busy} style={{ flex: 1 }}>{tx('Rechazar')}</Btn>
        <Btn onClick={onAccept} disabled={busy} style={{ flex: 2, background: GREEN }}>{tx('Aceptar')}</Btn>
      </div>
    </Sheet>
  );
}

function Countdown({ left, total }) {
  const r = 24, len = 2 * Math.PI * r;
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" style={{ flexShrink: 0 }}>
      <circle cx="32" cy="32" r={r} fill="none" stroke="#e2e8f0" strokeWidth="6" />
      <circle cx="32" cy="32" r={r} fill="none" stroke={left <= 5 ? C.danger : GREEN} strokeWidth="6" strokeLinecap="round"
              strokeDasharray={len} strokeDashoffset={len * (1 - left / total)} transform="rotate(-90 32 32)" style={{ transition: 'stroke-dashoffset .5s linear' }} />
      <text x="32" y="38" textAnchor="middle" fontSize="18" fontWeight="900" fill={C.text}>{left}</text>
    </svg>
  );
}

function Addr({ dot, square, text, extra }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, minWidth: 0 }}>
      <span style={{ width: 10, height: 10, borderRadius: square ? 0 : '50%', background: dot, flexShrink: 0, marginTop: 5 }} />
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 14, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{text}</span>
        {extra && <span style={{ display: 'block', fontSize: 12, color: C.muted }}>{extra}</span>}
      </span>
    </div>
  );
}

// ── Viaje en curso ───────────────────────────────────────────────────────────
function TripPanel({ trip: t, settings, cur, pickupRoute, busy, notify, onCall, onArrived, onStart, onComplete, onCancel, onDone }) {
  const [otp, setOtp] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const [stars, setStars] = useState(0);
  const [rated, setRated] = useState(false);
  const c = t.customer || {};
  const curT = t.currency || cur;

  const rate = async () => {
    try { await taxiApi(`/driver/bookings/${t.code}/rate`, { method: 'POST', body: { stars } }); setRated(true); notify(tx('¡Gracias por tu valoración!')); }
    catch (e) { notify(e.message, true); }
  };

  if (t.status === 'completed') {
    const cash = t.payment_method === 'cash';
    return (
      <Sheet>
        <p style={{ fontWeight: 900, fontSize: 20, margin: '0 0 4px', textAlign: 'center' }}>{tx('Viaje finalizado')}</p>
        {cash ? (
          <div style={{ background: '#dcfce7', borderRadius: 14, padding: 12, textAlign: 'center', margin: '8px 0' }}>
            <p style={{ margin: 0, fontWeight: 800, color: '#166534' }}>💶 {tx('Cobra en efectivo')}</p>
            <p style={{ margin: '4px 0 0', fontSize: 32, fontWeight: 900, color: '#166534' }}>{money(t.total_amount, curT)}</p>
          </div>
        ) : (
          <>
            <p style={{ textAlign: 'center', fontSize: 30, fontWeight: 900, color: BRAND, margin: '6px 0' }}>{money(t.total_amount, curT)}</p>
            <p style={{ textAlign: 'center', fontWeight: 800, color: C.ok, margin: '0 0 6px' }}>
              {t.payment_method === 'stripe' ? `💳 ${tx('Pagado con tarjeta de crédito: no cobres nada al cliente')}` : `👛 ${tx('Pagado con el monedero: no cobres nada al cliente')}`}
            </p>
          </>
        )}
        <p style={{ textAlign: 'center', color: C.muted, margin: '0 0 12px', fontSize: 13 }}>
          {tx('Tu ganancia')}: <b style={{ color: C.text }}>{money(t.driver_earning, curT)}</b>
          {t.payment_status === 'failed' ? ` · ${tx('pago pendiente del cliente')}` : ''}
        </p>
        {!rated ? (
          <>
            <p style={{ textAlign: 'center', fontWeight: 800, margin: '0 0 8px' }}>{tx('Valora a {name}', { name: c.name || tx('el cliente') })}</p>
            <Stars value={stars} onChange={setStars} />
            <Btn onClick={rate} disabled={!stars} style={{ marginTop: 12 }}>{tx('Enviar valoración')}</Btn>
            <Btn variant="ghost" onClick={onDone} style={{ marginTop: 8 }}>{tx('Ahora no')}</Btn>
          </>
        ) : <Btn onClick={onDone}>{tx('Seguir conduciendo')}</Btn>}
      </Sheet>
    );
  }

  const toPickup = t.status !== 'started';
  const target = toPickup ? { lat: t.pickup_lat, lng: t.pickup_lng, address: t.pickup_address } : { lat: t.dropoff_lat, lng: t.dropoff_lng, address: t.dropoff_address };
  const otpRequired = settings.otpRequired;

  return (
    <Sheet>
      <p style={{ fontSize: 13, fontWeight: 800, color: BRAND, margin: 0 }}>
        {t.status === 'accepted' ? tx('Ve a recoger al cliente') : t.status === 'arrived' ? tx('Esperando al cliente') : tx('Lleva al cliente a su destino')}
        {t.status === 'accepted' && pickupRoute?.code === t.code ? ` · ${pickupRoute.km} km · ${Math.round(pickupRoute.min)} min` : ''}
      </p>
      <p style={{ fontSize: 16, fontWeight: 900, margin: '2px 0 10px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{target.address}</p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        {c.photo ? <img src={taxiUrl(c.photo)} alt="" style={{ width: 48, height: 48, borderRadius: '50%', objectFit: 'cover' }} />
                 : <span style={{ width: 48, height: 48, borderRadius: '50%', background: '#D5E6F0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, flexShrink: 0 }}>🙋</span>}
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontWeight: 900 }}>{c.name}</p>
          <p style={{ margin: 0, fontSize: 13, color: C.muted }}>★ {Number(c.rating || 5).toFixed(1)} · {money(t.total_amount ?? t.estimated_fare, curT)} · {tx(PAY[t.payment_method] || t.payment_method)}</p>
        </div>
        <TripChatButton code={t.code} role="driver" otherName={c.name} />
        <button onClick={onCall} aria-label={tx('Llamar')} title={tx('Llamar')} style={{ width: 44, height: 44, borderRadius: '50%', border: 'none', background: '#D5E6F0', fontSize: 20, cursor: 'pointer', flexShrink: 0 }}>📞</button>
        <button onClick={() => openNavigation(target.lat, target.lng, target.address)} aria-label={tx('Navegar')} title={tx('Navegar')} style={{ width: 44, height: 44, borderRadius: '50%', border: 'none', background: BRAND, color: 'white', fontSize: 20, cursor: 'pointer', flexShrink: 0 }}>🧭</button>
      </div>

      {t.status === 'accepted' && <Btn onClick={onArrived} disabled={busy}>{tx('He llegado')}</Btn>}
      {t.status === 'arrived' && (
        <>
          {otpRequired && (
            <>
              <p style={{ fontSize: 13, fontWeight: 700, color: C.muted, margin: '0 0 6px' }}>{tx('Pide al cliente su código de 4 cifras')}</p>
              <input value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" placeholder="• • • •" aria-label={tx('Código')}
                     style={{ ...inputStyle, textAlign: 'center', fontSize: 28, fontWeight: 900, letterSpacing: 12, marginBottom: 10 }} />
            </>
          )}
          <Btn onClick={() => onStart(otp)} disabled={busy || (otpRequired && otp.length !== 4)} style={{ background: GREEN }}>{tx('Empezar viaje')}</Btn>
        </>
      )}
      {t.status === 'started' && <Btn onClick={onComplete} disabled={busy}>{tx('Finalizar viaje')}</Btn>}

      {t.status !== 'started' && (!cancelling ? (
        <button onClick={() => setCancelling(true)} style={{ display: 'block', margin: '12px auto 0', background: 'none', border: 'none', color: C.danger, fontWeight: 800, cursor: 'pointer', fontSize: 14 }}>{tx('Cancelar viaje')}</button>
      ) : (
        <div style={{ background: '#fef2f2', borderRadius: 14, padding: 12, marginTop: 12 }}>
          <p style={{ margin: '0 0 8px', fontWeight: 800, color: C.danger, fontSize: 14 }}>{tx('¿Por qué cancelas? El viaje se ofrecerá a otro conductor.')}</p>
          <select value={reason} onChange={e => setReason(e.target.value)} style={{ ...inputStyle, marginBottom: 10 }}>
            <option value="">{tx('Elige un motivo')}</option>
            {['El cliente no aparece', 'El cliente me ha pedido cancelar', 'Problema con el vehículo', 'Tráfico o calle cortada', 'Otro motivo'].map(r => <option key={r} value={r}>{tx(r)}</option>)}
          </select>
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn variant="ghost" onClick={() => setCancelling(false)} style={{ flex: 1, padding: 10 }}>{tx('No')}</Btn>
            <Btn variant="danger" onClick={() => onCancel(reason)} disabled={!reason || busy} style={{ flex: 1, padding: 10 }}>{tx('Sí, cancelar')}</Btn>
          </div>
        </div>
      ))}
    </Sheet>
  );
}

// ── Alta del conductor: qué falta para poder conectarse ─────────────────────
function Onboarding({ dash, loadDash, openAccount, onExit }) {
  const ob = dash.onboarding;
  const [busy, setBusy] = useState(false);
  const refresh = async () => { setBusy(true); await loadDash(); setBusy(false); };
  const vehicleState = !ob.hasVehicle ? 'todo' : ob.vehicleStatus === 'active' ? 'done' : ob.vehicleStatus === 'blocked' ? 'error' : 'wait';
  const docsState = ob.missingDocuments.length ? 'todo' : 'done';
  const accState = ob.status === 'blocked' ? 'error' : ob.verified && ob.status === 'active' ? 'done' : 'wait';
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: C.bg }}>
      <Header title={tx('Hazte conductor')} subtitle={dash.driver.name} onBack={onExit} />
      <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
        <p style={{ fontWeight: 900, fontSize: 20, margin: '4px 0 4px' }}>{tx('Completa tu alta')}</p>
        <p style={{ color: C.muted, margin: '0 0 16px', fontSize: 14 }}>{tx('Cuando el equipo apruebe tu vehículo y tus documentos podrás conectarte y recibir viajes.')}</p>
        <StepCard n={1} state={vehicleState} title={tx('Tu vehículo')}
          text={vehicleState === 'todo' ? tx('Añade la matrícula, el modelo y el tipo de viaje.') : vehicleState === 'done' ? tx('Vehículo aprobado') : vehicleState === 'error' ? tx('Vehículo bloqueado. Contacta con soporte.') : tx('En revisión por el equipo')}
          action={vehicleState === 'todo' ? tx('Añadir') : tx('Ver')} onClick={() => openAccount('vehicles')} />
        <StepCard n={2} state={docsState} title={tx('Documentos')}
          text={docsState === 'todo' ? `${tx('Faltan')}: ${ob.missingDocuments.join(', ')}` : tx('Documentos enviados')}
          action={docsState === 'todo' ? tx('Subir') : tx('Ver')} onClick={() => openAccount('documents')} />
        <StepCard n={3} state={accState} title={tx('Aprobación de la cuenta')}
          text={accState === 'done' ? tx('Cuenta verificada') : accState === 'error' ? tx('Cuenta bloqueada. Contacta con soporte.') : tx('El equipo revisará tus datos. Te avisaremos cuando esté lista.')} />
        <Btn variant="ghost" onClick={refresh} disabled={busy} style={{ marginTop: 8 }}>{busy ? tx('Comprobando…') : tx('Comprobar de nuevo')}</Btn>
      </div>
    </div>
  );
}

function StepCard({ n, state, title, text, action, onClick }) {
  const badge = { done: ['✓', GREEN], wait: ['⏳', '#f59e0b'], error: ['!', C.danger], todo: [n, BRAND] }[state];
  return (
    <Card style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 10 }}>
      <span style={{ width: 36, height: 36, borderRadius: '50%', background: badge[1], color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, flexShrink: 0 }}>{badge[0]}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontWeight: 900 }}>{title}</span>
        <span style={{ display: 'block', fontSize: 13, color: C.muted }}>{text}</span>
      </span>
      {action && <button onClick={onClick} style={{ background: state === 'todo' ? BRAND : '#D5E6F0', color: state === 'todo' ? 'white' : BRAND, border: 'none', borderRadius: 10, padding: '8px 12px', fontWeight: 800, fontSize: 13, cursor: 'pointer', flexShrink: 0 }}>{action}</button>}
    </Card>
  );
}
