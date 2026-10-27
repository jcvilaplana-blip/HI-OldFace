/**
 * AvatarViewer — foto de perfil a pantalla completa (pellizcar para ampliar, Atrás o ✕ para cerrar).
 * Se monta una sola vez en App.jsx; cualquier pantalla la abre con openAvatar(src, name).
 */
import React, { useEffect, useState } from 'react';
import ZoomImage from './ZoomImage.jsx';
import { useBackClose } from '../utils/backHandler';

const EVENT = 'oldface-avatar';

/** Abre la foto ampliada (sin foto no hace nada) */
export function openAvatar(src, name = '') {
  if (!src) return;
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { src, name } }));
}

export default function AvatarViewer() {
  const [photo, setPhoto] = useState(null);   // { src, name }

  useEffect(() => {
    const onOpen = (e) => setPhoto(e.detail);
    window.addEventListener(EVENT, onOpen);
    return () => window.removeEventListener(EVENT, onOpen);
  }, []);

  useBackClose(!!photo, () => setPhoto(null));

  if (!photo) return null;
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 3000, background: '#000' }}>
      <ZoomImage src={photo.src} onTap={() => setPhoto(null)} />
      <div style={{ position: 'absolute', left: 0, right: 0, top: 0, display: 'flex', alignItems: 'center', gap: 12,
                    padding: 'calc(var(--sat, 0px) + 12px) 16px 24px', background: 'linear-gradient(rgba(0,0,0,0.6), transparent)', pointerEvents: 'none' }}>
        <p style={{ flex: 1, minWidth: 0, margin: 0, color: 'white', fontSize: 17, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {photo.name}
        </p>
        <button onClick={() => setPhoto(null)} aria-label="✕"
          style={{ pointerEvents: 'all', width: 40, height: 40, borderRadius: '50%', background: 'rgba(0,0,0,0.5)', border: '1.5px solid rgba(255,255,255,0.3)',
                   cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      </div>
    </div>
  );
}
