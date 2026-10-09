/**
 * LinkDevicePanel — en el ordenador / la tablet: QR + código para entrar con la cuenta del móvil.
 * El móvil lo escanea (o escribe el código) en Ajustes → Dispositivos vinculados.
 * Pregunta cada 2 s si ya lo aprobaron; el código caduca a los 3 minutos y se renueva solo.
 */
import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { startLink, linkStatus, setDeviceId } from '../utils/devices';
import { tr } from '../i18n';

const fmtCode = (c) => (c ? `${c.slice(0, 4)}-${c.slice(4)}` : '');

export default function LinkDevicePanel({ onBack, onLinked }) {
  const [link, setLink] = useState(null);     // { linkId, code, expiresAt }
  const [qr, setQr] = useState(null);
  const [error, setError] = useState('');
  const [left, setLeft] = useState(0);
  const alive = useRef(true);

  const create = async () => {
    setError('');
    try {
      const l = await startLink();
      if (!alive.current) return;
      setLink(l);
      setQr(await QRCode.toDataURL(`oldface-link:${l.code}`, { width: 240, margin: 1, color: { dark: '#293241', light: '#ffffff' } }));
    } catch (e) {
      setError(e.message || tr('No se pudo generar el código'));
    }
  };

  useEffect(() => { alive.current = true; create(); return () => { alive.current = false; }; }, []); // eslint-disable-line

  // ¿Ya lo aprobaron? + cuenta atrás
  useEffect(() => {
    if (!link) return;
    let busy = false;
    const iv = setInterval(async () => {
      setLeft(Math.max(0, Math.round((link.expiresAt - Date.now()) / 1000)));
      if (busy) return;
      busy = true;
      try {
        const r = await linkStatus(link.linkId);
        if (!alive.current) return;
        if (r.status === 'approved') {
          clearInterval(iv);
          setDeviceId(r.deviceId);
          onLinked(r);
        } else if (r.status === 'expired') {
          clearInterval(iv);
          create();
        }
      } catch { /* sin red: se reintenta */ }
      finally { busy = false; }
    }, 2000);
    return () => clearInterval(iv);
  }, [link]); // eslint-disable-line

  return (
    <>
      <button onClick={onBack} className="mb-4 text-oldface-500 font-semibold text-sm flex items-center gap-1">{tr('← Atrás')}</button>
      <h2 className="text-xl font-bold text-gray-800 mb-2">{tr('Vincular con tu móvil')}</h2>
      <ol className="text-sm text-gray-600 mb-5 space-y-1 list-decimal pl-5">
        <li>{tr('Abre OldFace en tu móvil')}</li>
        <li>{tr('Ve a')}{' '}<strong>{tr('Ajustes → Dispositivos vinculados')}</strong></li>
        <li>{tr('Toca')}{' '}<strong>{tr('Vincular un dispositivo')}</strong>{' '}{tr('y escanea este código')}</li>
      </ol>

      <div className="flex flex-col items-center">
        <div className="w-60 h-60 rounded-2xl border-2 border-gray-100 flex items-center justify-center bg-white overflow-hidden">
          {qr ? <img src={qr} alt={tr('Código QR de vinculación {p0}', { p0: fmtCode(link?.code) })} className="w-full h-full" />
              : <div className="w-10 h-10 border-4 border-oldface-200 border-t-oldface-500 rounded-full animate-spin" />}
        </div>
        {link && (
          <>
            <p className="text-xs text-gray-400 mt-4">{tr('O escribe este código en el móvil')}</p>
            <p className="text-2xl font-black tracking-widest text-gray-800 mt-1" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtCode(link.code)}</p>
            <p className="text-xs text-gray-400 mt-2">
              {left > 0 ? tr('Caduca en {p0}:{p1} · se renueva solo', { p0: Math.floor(left / 60), p1: String(left % 60).padStart(2, '0') }) : tr('Renovando…')}
            </p>
          </>
        )}
        {error && (
          <div className="mt-4 w-full">
            <p className="text-sm text-red-500 font-medium bg-red-50 px-4 py-3 rounded-2xl">{error}</p>
            <button onClick={create} className="mt-3 w-full py-3 rounded-2xl font-bold text-white bg-oldface-500">{tr('Reintentar')}</button>
          </div>
        )}
      </div>
    </>
  );
}
