/**
 * LinkedDevicesSheet — Ajustes → Dispositivos vinculados (en el móvil con la sesión iniciada).
 *  · Lista de dispositivos con la cuenta abierta ("Este dispositivo" marcado) y "Cerrar sesión" en los demás.
 *  · "Vincular un dispositivo": escanear el QR del ordenador/tablet con la cámara o escribir su código.
 */
import { useEffect, useRef, useState } from 'react';
import { listDevices, revokeDevice, approveLink, getDeviceId } from '../utils/devices';
import { tr, LOCALE } from '../i18n';

const BRAND = '#3D5A80';

const ago = (ts) => {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 2) return tr('activo ahora');
  if (m < 60) return tr('hace {m} min', { m });
  const h = Math.round(m / 60);
  if (h < 24) return tr('hace {h} h', { h });
  return new Date(ts).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short' });
};

export default function LinkedDevicesSheet({ onClose }) {
  const [devices, setDevices] = useState(null);
  const [error, setError] = useState('');
  const [scan, setScan] = useState(false);
  const [notice, setNotice] = useState('');
  const [confirm, setConfirm] = useState(null);   // deviceId a cerrar
  const me = getDeviceId();

  const load = () => listDevices().then(setDevices).catch(e => { setError(e.message); setDevices([]); });
  useEffect(() => { load(); }, []);

  const doRevoke = async (id) => {
    setConfirm(null);
    try { await revokeDevice(id); setNotice(tr('Sesión cerrada en ese dispositivo')); load(); }
    catch (e) { setError(e.message); }
  };

  const onLinked = (name) => {
    setScan(false);
    setNotice(tr('Vinculado: {name}', { name }));
    load();
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'flex-end' }}>
      <div onClick={e => e.stopPropagation()}
        style={{ width: '100%', maxHeight: '88vh', overflowY: 'auto', background: 'white', borderRadius: '22px 22px 0 0',
                 padding: '18px 20px', paddingBottom: 'calc(var(--sab, 0px) + 20px)' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
          <p style={{ flex: 1, margin: 0, fontWeight: 800, fontSize: 17, color: '#293241' }}>
            {scan ? tr('Vincular un dispositivo') : tr('Dispositivos vinculados')}
          </p>
          <button onClick={scan ? () => setScan(false) : onClose} aria-label={tr('Cerrar')}
            style={{ background: 'none', border: 'none', padding: 4, cursor: 'pointer' }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>

        {scan ? <Scanner onLinked={onLinked} /> : (
          <>
            <p style={{ margin: '0 0 14px', fontSize: 13, color: '#6b7280' }}>{tr('Usa OldFace en el ordenador o en una tablet con tu misma cuenta. Abre')}{' '}<strong>{tr('oldface.app')}</strong>{' '}{tr('en el otro dispositivo, elige')}{' '}<strong>{tr('Vincular con mi móvil')}</strong>{' '}{tr('y escanea el código.')}</p>
            <button onClick={() => { setNotice(''); setError(''); setScan(true); }}
              style={{ width: '100%', padding: 14, borderRadius: 16, border: 'none', background: BRAND, color: 'white', fontWeight: 800, fontSize: 15, cursor: 'pointer' }}>{tr('Vincular un dispositivo')}</button>

            {notice && <p style={{ margin: '12px 0 0', fontSize: 13, fontWeight: 700, color: '#15803d' }}>{notice}</p>}
            {error && <p style={{ margin: '12px 0 0', fontSize: 13, fontWeight: 700, color: '#ef4444' }}>{error}</p>}

            <p style={{ margin: '20px 0 6px', fontSize: 11, fontWeight: 800, letterSpacing: '0.6px', color: '#6b7280' }}>{tr('CON LA SESIÓN INICIADA')}</p>
            {devices === null && <p style={{ fontSize: 13, color: '#9ca3af' }}>{tr('Cargando…')}</p>}
            {devices?.length === 0 && !error && <p style={{ fontSize: 13, color: '#9ca3af' }}>{tr('Todavía no hay dispositivos.')}</p>}
            {devices?.map(d => (
              <div key={d.deviceId} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderTop: '1px solid #f1f5f9' }}>
                <DeviceIcon platform={d.platform} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: '#293241', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</p>
                  <p style={{ margin: '2px 0 0', fontSize: 12, color: d.deviceId === me ? '#15803d' : '#6b7280', fontWeight: d.deviceId === me ? 700 : 500 }}>
                    {d.deviceId === me ? tr('Este dispositivo') : tr('Última vez {p0}', { p0: ago(d.lastSeen) })}
                  </p>
                </div>
                {d.deviceId !== me && (confirm === d.deviceId ? (
                  <span style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => setConfirm(null)} style={smallBtn('#E3EDF2', '#293241')}>{tr('No')}</button>
                    <button onClick={() => doRevoke(d.deviceId)} style={smallBtn('#ef4444', 'white')}>{tr('Cerrar')}</button>
                  </span>
                ) : (
                  <button onClick={() => setConfirm(d.deviceId)} style={smallBtn('#fee2e2', '#b91c1c')}>{tr('Cerrar sesión')}</button>
                ))}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

const smallBtn = (bg, color) => ({ border: 'none', borderRadius: 14, padding: '7px 12px', background: bg, color, fontWeight: 800, fontSize: 12, cursor: 'pointer', flexShrink: 0 });

function DeviceIcon({ platform }) {
  const desk = platform === 'web' || platform === 'desktop';
  return (
    <span style={{ width: 40, height: 40, borderRadius: 12, background: '#E3EDF2', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={BRAND} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {desk ? <><rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></>
              : <><rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/></>}
      </svg>
    </span>
  );
}

/** Cámara trasera leyendo QR (BarcodeDetector o jsQR) + código escrito a mano */
function Scanner({ onLinked }) {
  const videoRef = useRef(null);
  const [camError, setCamError] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const doneRef = useRef(false);

  const approve = async (raw) => {
    if (doneRef.current) return;
    const c = String(raw || '').trim();
    if (!/^oldface-link:/i.test(c) && c.replace(/[^A-Za-z0-9]/g, '').length !== 8) {
      setError(tr('Ese código no es de OldFace'));
      return;
    }
    doneRef.current = true;
    setBusy(true);
    setError('');
    try {
      const r = await approveLink(c);
      onLinked(r.deviceName || 'dispositivo');
    } catch (e) {
      setError(e.message);
      // Un QR caducado no se vuelve a leer en bucle: esperar un poco antes de aceptar otro
      setTimeout(() => { doneRef.current = false; }, 2500);
    } finally { setBusy(false); }
  };
  const approveRef = useRef(approve);
  approveRef.current = approve;

  useEffect(() => {
    let stream = null, timer = null, stopped = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false });
        if (stopped) { stream.getTracks().forEach(t => t.stop()); return; }
        const v = videoRef.current;
        v.srcObject = stream;
        await v.play().catch(() => {});
        let detect = null;
        if ('BarcodeDetector' in window) {
          try {
            const bd = new window.BarcodeDetector({ formats: ['qr_code'] });
            detect = async () => (await bd.detect(v))[0]?.rawValue || null;
          } catch { detect = null; }
        }
        if (!detect) {
          const { default: jsQR } = await import('jsqr');
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          detect = async () => {
            if (!v.videoWidth) return null;
            const scale = Math.min(1, 640 / v.videoWidth);
            canvas.width = Math.round(v.videoWidth * scale);
            canvas.height = Math.round(v.videoHeight * scale);
            ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            return jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })?.data || null;
          };
        }
        const tick = async () => {
          if (stopped) return;
          try {
            const val = await detect();
            if (val && /^oldface-link:/i.test(val) && !doneRef.current) approveRef.current(val);
          } catch { /* fotograma sin leer */ }
          timer = setTimeout(tick, 250);
        };
        tick();
      } catch {
        setCamError(tr('No se pudo abrir la cámara. Escribe el código que ves en el otro dispositivo.'));
      }
    })();
    return () => { stopped = true; clearTimeout(timer); stream?.getTracks().forEach(t => t.stop()); };
  }, []);

  const typed = code.replace(/[^A-Z0-9]/g, '');
  return (
    <div>
      {!camError ? (
        <div style={{ position: 'relative', width: '100%', aspectRatio: '1', maxHeight: '50vh', borderRadius: 18, overflow: 'hidden', background: '#111827' }}>
          <video ref={videoRef} playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          <div style={{ position: 'absolute', inset: '16%', border: '3px solid rgba(255,255,255,0.9)', borderRadius: 18, boxShadow: '0 0 0 999px rgba(0,0,0,0.35)' }} />
          {busy && <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 800 }}>{tr('Vinculando…')}</div>}
        </div>
      ) : (
        <p style={{ fontSize: 13, color: '#6b7280', margin: '4px 0 0' }}>{camError}</p>
      )}
      {!camError && <p style={{ fontSize: 13, color: '#6b7280', textAlign: 'center', margin: '10px 0 0' }}>{tr('Apunta al código QR de la pantalla del otro dispositivo')}</p>}

      <p style={{ margin: '18px 0 6px', fontSize: 11, fontWeight: 800, letterSpacing: '0.6px', color: '#6b7280' }}>{tr('O ESCRIBE EL CÓDIGO')}</p>
      <div style={{ display: 'flex', gap: 8 }}>
        <input value={code} onChange={e => { setCode(e.target.value.toUpperCase().slice(0, 9)); setError(''); }}
          placeholder="ABCD-EFGH" autoCapitalize="characters" autoComplete="off" aria-label={tr('Código de vinculación')}
          onKeyDown={e => { if (e.key === 'Enter') approve(code); }}
          style={{ flex: 1, minWidth: 0, padding: '12px 14px', borderRadius: 14, border: '2px solid #D5E6F0', fontSize: 18, fontWeight: 800, letterSpacing: 3, color: '#293241', outline: 'none' }} />
        <button onClick={() => approve(code)} disabled={busy || typed.length !== 8}
          style={{ padding: '0 18px', borderRadius: 14, border: 'none', background: BRAND, color: 'white', fontWeight: 800, fontSize: 14, cursor: 'pointer',
                   opacity: busy || typed.length !== 8 ? 0.5 : 1 }}>{tr('Vincular')}</button>
      </div>
      {error && <p style={{ margin: '10px 0 0', fontSize: 13, fontWeight: 700, color: '#ef4444' }}>{error}</p>}
    </div>
  );
}
