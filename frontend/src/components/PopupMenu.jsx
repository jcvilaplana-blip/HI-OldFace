/**
 * PopupMenu — Menú emergente OldFace
 * Buscador, 4 acciones destacadas en tarjetas de color (Directo, Social, Taxi, Poll) y la sección "Comunicación"
 * en 2 columnas. Las acciones marcadas como 'soon' (Social, Archivos) se desarrollarán más adelante.
 */
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { tr } from '../i18n';

// ─── Definición de items ────────────────────────────────────────────────────
// route   → navega a esa ruta React Router
// action  → lógica especial (groups, soon…)
// ──────────────────────────────────────────────────────────────────────────
const ITEMS = {
  calls: {
    label: tr('Llamada'),
    route: '/contacts?action=call',
    icon: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"
      d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21
         l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502
         l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 7V5z"/>`
  },
  videocalls: {
    label: tr('Videollamada'),
    route: '/contacts?action=video',
    icon: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"
      d="M15 10l4.553-2.069A1 1 0 0121 8.868v6.264a1 1 0 01-1.447.894
         L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/>`
  },
  directo: {
    label: tr('Directo'),
    route: '/directo',
    highlight: true,
    icon: `<circle cx="12" cy="12" r="3" stroke-width="1.8"/>
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"
      d="M6.343 6.343a8 8 0 000 11.314M17.657 6.343a8 8 0 010 11.314
         M3.515 3.515a13 13 0 000 16.97M20.485 3.515a13 13 0 010 16.97"/>`
  },
  social: {
    label: tr('Social'),
    action: 'soon',
    icon: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"
      d="M4 5a2 2 0 012-2h12a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V5z
         M8 8h8M8 12h8M8 16h5"/>`
  },
  chats: {
    label: tr('Chats'),
    route: '/',
    icon: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"
      d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8
         a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72
         C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/>`
  },
  taxi: {
    label: tr('Taxi'),
    route: '/taxi',     // 1ª vez: elegir Cliente o Conductor; después abre directamente esa parte
    taxi: true,         // colores típicos del taxi: fondo amarillo, icono negro
    icon: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"
      d="M5 13l1.5-4.5A2 2 0 018.4 7h7.2a2 2 0 011.9 1.5L19 13
         M5 13h14v4a1 1 0 01-1 1h-1a1 1 0 01-1-1v-1H8v1a1 1 0 01-1 1H6a1 1 0 01-1-1v-4z
         M10 4h4l.5 3h-5l.5-3z"/>
      <circle cx="8" cy="15" r="0.8" fill="currentColor" stroke-width="1"/>
      <circle cx="16" cy="15" r="0.8" fill="currentColor" stroke-width="1"/>`
  },
  poll: {
    label: tr('Poll'),
    route: '/poll',
    primary: true,
    icon: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"
      d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2z
         M9 19V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2
         m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/>`
  },
  groups: {
    label: tr('Grupos'),
    action: 'groups',
    icon: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"
      d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1z
         m0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"/>`
  },
  contacts: {
    label: tr('Contactos'),
    route: '/contacts',
    icon: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"
      d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2
         c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857
         M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0
         M15 7a3 3 0 11-6 0 3 3 0 016 0z"/>`
  },
  karaoke: {
    label: tr('Karaoke'),
    route: '/karaoke',
    icon: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"
      d="M12 3a3 3 0 00-3 3v5a3 3 0 006 0V6a3 3 0 00-3-3z
         M19 11a7 7 0 01-14 0M12 18v3M8 21h8"/>`
  },
  settings: {
    label: tr('Ajustes'),
    route: '/settings',
    icon: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"
      d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066
         c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572
         c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573
         c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065
         c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066
         c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572
         c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573
         c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"
      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>`
  },
  archived: {
    label: tr('Archivos'),
    action: 'soon',
    icon: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"
      d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8
         m-9 4h4"/>`
  },
};

// Emblemas propios (imagen en vez de icono SVG)
ITEMS.directo.image = '/emblema-directos.png';
ITEMS.taxi.image = '/emblema-taxi.png';
// Social: destellos; Contactos: agenda; Videollamada se muestra como "Video"
ITEMS.social.icon = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"
  d="M9.8 4.5l1.3 3.9a2 2 0 001.3 1.3l3.9 1.3-3.9 1.3a2 2 0 00-1.3 1.3l-1.3 3.9-1.3-3.9a2 2 0 00-1.3-1.3L3.3 11l3.9-1.3
     a2 2 0 001.3-1.3l1.3-3.9zM18 3v4M16 5h4M17.5 16v3M16 17.5h3"/>`;
ITEMS.contacts.icon = `<rect x="4" y="3" width="15" height="18" rx="2" stroke-width="1.8"/>
  <circle cx="11.5" cy="10" r="2.5" stroke-width="1.8"/>
  <path stroke-linecap="round" stroke-width="1.8" d="M7.5 17a4 4 0 018 0M21 7v2M21 13v2"/>`;
ITEMS.videocalls.label = tr('Video');

// Subtítulo de cada acción
const SUBTITLES = {
  directo: 'Emite en vivo', social: 'Tu feed', taxi: 'Pide viaje', poll: 'Encuestas',
  calls: 'Voz', videocalls: 'Con cámara', chats: 'Mensajes', groups: 'Tus grupos',
  contacts: 'Agenda', karaoke: 'Canta', settings: 'Tu cuenta', archived: 'Fotos y docs',
};

// Destacadas (tarjetas de color, 2 × 2) y sección "Comunicación" (2 columnas)
const FEATURED = ['directo', 'social', 'taxi', 'poll'];
const COMMUNICATION = ['calls', 'videocalls', 'chats', 'groups', 'contacts', 'karaoke', 'settings', 'archived'];

// Colores de cada tarjeta destacada: fondo suave, borde, cuadro del icono y flecha
const FEATURED_LOOK = {
  directo: { bg: '#fff1f2', border: '#fecdd3', tile: 'white', arrow: '#e11d48' },
  social:  { bg: '#fff7ed', border: '#fed7aa', tile: 'linear-gradient(135deg,#fb923c,#ea580c)', arrow: '#ea580c' },
  taxi:    { bg: '#fefce8', border: '#fde68a', tile: 'white', arrow: '#ca8a04' },
  poll:    { bg: '#f0fdf4', border: '#bbf7d0', tile: 'linear-gradient(135deg,#4ade80,#16a34a)', arrow: '#16a34a' },
};

// ─── Componente principal ───────────────────────────────────────────────────
export default function PopupMenu({ onClose, onGroups }) {
  const navigate = useNavigate();
  const [soonMsg, setSoonMsg] = useState('');
  const [query, setQuery] = useState('');
  const soonTimer = useRef(null);

  // Buscador: filtra por nombre o subtítulo (sin distinguir mayúsculas ni acentos)
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const q = norm(query.trim());
  const matches = (id) => !q || norm(ITEMS[id].label).includes(q) || norm(tr(SUBTITLES[id])).includes(q);
  const featured = FEATURED.filter(matches);
  const communication = COMMUNICATION.filter(matches);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; clearTimeout(soonTimer.current); };
  }, []);

  const handleItem = (item) => {
    // Próximamente: avisar sin cerrar el menú
    if (item.action === 'soon') {
      setSoonMsg(tr('{label}: próximamente', { label: item.label }));
      clearTimeout(soonTimer.current);
      soonTimer.current = setTimeout(() => setSoonMsg(''), 2000);
      return;
    }

    onClose();

    if (item.route) {
      navigate(item.route);
      return;
    }

    switch (item.action) {
      case 'groups':
        onGroups?.();
        break;
      default:
        break;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end">
      {/* Backdrop */}
      <div
        className="absolute inset-0 animate-fade-in"
        style={{ background: 'rgba(0,0,0,0.42)', backdropFilter: 'blur(4px)' }}
        onClick={onClose}
      />

      {/* Bottom sheet */}
      <div
        className="relative w-full rounded-t-3xl shadow-2xl animate-slide-up scroll-hide"
        style={{ background: 'white', minHeight: '80vh', maxHeight: '94vh', overflowY: 'auto' }}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-3">
          <div style={{ width: 40, height: 4, background: '#cbd5e1', borderRadius: 2 }} />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 pb-4">
          <div className="flex items-center gap-3">
            {/* Logo */}
            <div
              className="flex items-center justify-center overflow-hidden"
              style={{ width: 46, height: 46, borderRadius: 14, backgroundColor: 'white', border: '1px solid #e2e8f0',
                boxShadow: '0 2px 8px rgba(15,23,42,0.08)' }}
            >
              <img
                src="/logo-oldface.png"
                alt="OldFace"
                style={{ width: 40, height: 40, objectFit: 'contain' }}
                onError={e => { e.target.style.display = 'none'; }}
              />
            </div>
            <div>
              <p style={{ fontSize: 20, fontWeight: 800, color: '#0f172a', lineHeight: 1.15 }}>{tr('OldFace')}</p>
              <p style={{ fontSize: 13, fontWeight: 500, color: '#64748b' }}>{tr('Elige una acción')}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label={tr('Cerrar')}
            style={{
              width: 36, height: 36, borderRadius: '50%',
              background: '#f1f5f9', border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#0f172a', fontSize: 16, fontWeight: 700,
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ padding: '0 20px calc(var(--sab) + 24px)' }}>
          {/* Buscador */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#f1f5f9', borderRadius: 14,
            padding: '0 14px', height: 46, marginBottom: 16 }}>
            <svg width="18" height="18" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round" viewBox="0 0 24 24">
              <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" />
            </svg>
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={tr('Buscar acción…')}
              style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent',
                fontSize: 15, color: '#0f172a' }}
            />
            {query && (
              <button onClick={() => setQuery('')} aria-label={tr('Borrar')}
                style={{ border: 'none', background: 'transparent', color: '#94a3b8', fontSize: 15, cursor: 'pointer', padding: 4 }}>
                ✕
              </button>
            )}
          </div>

          {/* Destacadas: tarjetas de color 2 × 2 */}
          {featured.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 20 }}>
              {featured.map(id => (
                <MenuCard key={id} id={id} item={ITEMS[id]} look={FEATURED_LOOK[id]} onClick={() => handleItem(ITEMS[id])} />
              ))}
            </div>
          )}

          {/* Comunicación: 2 columnas */}
          {communication.length > 0 && (
            <>
              <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.8, color: '#64748b', margin: '0 0 10px 2px' }}>
                {tr('Comunicación').toUpperCase()}
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {communication.map(id => (
                  <MenuCard key={id} id={id} item={ITEMS[id]} onClick={() => handleItem(ITEMS[id])} />
                ))}
              </div>
            </>
          )}

          {!featured.length && !communication.length && (
            <p style={{ textAlign: 'center', color: '#94a3b8', fontSize: 14, padding: '24px 0' }}>{tr('Sin resultados')}</p>
          )}
        </div>

        {/* Aviso "próximamente" */}
        {soonMsg && (
          <div style={{
            position: 'absolute', left: '50%', bottom: 'calc(var(--sab) + 18px)', transform: 'translateX(-50%)',
            background: 'rgba(15,23,42,0.92)', color: 'white', padding: '9px 18px', borderRadius: 20,
            fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
          }}>
            {soonMsg}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Tarjeta de una acción (destacada con color o de la sección Comunicación) ─
function MenuCard({ id, item, look, onClick }) {
  const isSoon = item.action === 'soon';
  const gradientTile = look && look.tile !== 'white';

  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, minWidth: 0,
        padding: look ? '12px 10px 12px 12px' : '10px 10px 10px 10px', borderRadius: 16, textAlign: 'left',
        background: look ? look.bg : '#f8fafc',
        border: `1px solid ${look ? look.border : '#e2e8f0'}`,
        cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
        opacity: isSoon ? 0.75 : 1, transition: 'transform 0.15s',
      }}
      onMouseDown={e => e.currentTarget.style.transform = 'scale(0.96)'}
      onMouseUp={e => e.currentTarget.style.transform = 'scale(1)'}
      onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
      onTouchStart={e => e.currentTarget.style.transform = 'scale(0.96)'}
      onTouchEnd={e => e.currentTarget.style.transform = 'scale(1)'}
    >
      {/* Cuadro del icono */}
      <div style={{
        width: look ? 44 : 40, height: look ? 44 : 40, flexShrink: 0, borderRadius: 12,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: look ? look.tile : 'white',
        border: gradientTile ? 'none' : '1px solid #e2e8f0',
        boxShadow: gradientTile ? '0 3px 10px rgba(0,0,0,0.15)' : '0 1px 4px rgba(15,23,42,0.06)',
      }}>
        {item.image ? (
          <img src={item.image} alt="" style={{ width: '82%', height: '82%', objectFit: 'contain' }} />
        ) : (
          /* SVG con stroke explícito — no depende de Tailwind */
          <svg
            width="22" height="22"
            fill="none"
            stroke={gradientTile ? 'white' : '#0f172a'}
            strokeLinecap="round"
            strokeLinejoin="round"
            viewBox="0 0 24 24"
            dangerouslySetInnerHTML={{ __html: item.icon }}
          />
        )}
      </div>

      {/* Nombre y subtítulo */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', lineHeight: 1.2,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</p>
        <p style={{ fontSize: 11.5, color: '#64748b', lineHeight: 1.3, marginTop: 2,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tr(SUBTITLES[id])}</p>
      </div>

      {/* Flecha */}
      <svg width="16" height="16" fill="none" stroke={look ? look.arrow : '#94a3b8'} strokeWidth="2.2"
        strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
        <path d="M9 6l6 6-6 6" />
      </svg>
    </button>
  );
}
