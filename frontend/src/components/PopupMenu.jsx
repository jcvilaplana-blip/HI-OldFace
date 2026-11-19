/**
 * PopupMenu — Menú emergente OldFace
 * Mismo aspecto que la pantalla principal (fondo azul grisáceo, tarjetas blancas, iconos con aro de color): buscador,
 * 4 acciones destacadas (Directo, Social, Taxi, Poll) y la sección "Comunicación"
 * en 2 columnas. Las acciones marcadas como 'soon' (Archivos) se desarrollarán más adelante.
 */
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { tr } from '../i18n';
import { useThemeStore, DARK, LIGHT } from '../store/themeStore';
import { cardStyle, SectionLabel, BRAND } from './NeonAvatar.jsx';
import SearchBox from './SearchBox.jsx';

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
    route: '/social',
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

// Apps que el administrador puede ocultar desde /admin (GET /app/features). Hasta saberlo se usa lo último que dijo
// el servidor; la primera vez, ocultas (así no aparecen y desaparecen al abrir el menú).
const BACKEND = import.meta.env.VITE_BACKEND_URL;
const HIDEABLE = ['social', 'karaoke'];
const FEATURES_KEY = 'oldface-features';
function cachedFeatures() {
  try { return { social: false, karaoke: false, ...JSON.parse(localStorage.getItem(FEATURES_KEY) || '{}') }; }
  catch { return { social: false, karaoke: false }; }
}

// ─── Componente principal ───────────────────────────────────────────────────
export default function PopupMenu({ onClose, onGroups }) {
  const navigate = useNavigate();
  const { isDark } = useThemeStore();
  const T = isDark ? DARK : LIGHT;
  const [soonMsg, setSoonMsg] = useState('');
  const [query, setQuery] = useState('');
  const [features, setFeatures] = useState(cachedFeatures);
  const soonTimer = useRef(null);

  useEffect(() => {
    fetch(`${BACKEND}/app/features`)
      .then(r => (r.ok ? r.json() : null))
      .then(f => {
        if (!f) return;
        setFeatures(f);
        try { localStorage.setItem(FEATURES_KEY, JSON.stringify(f)); } catch { /* sin almacenamiento */ }
      })
      .catch(() => {});
  }, []);

  // Buscador: filtra por nombre o subtítulo (sin distinguir mayúsculas ni acentos); las apps ocultas no salen
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const q = norm(query.trim());
  const matches = (id) => (!HIDEABLE.includes(id) || features[id] === true)
    && (!q || norm(ITEMS[id].label).includes(q) || norm(tr(SUBTITLES[id])).includes(q));
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
      {/* Fondo */}
      <div
        className="absolute inset-0 animate-fade-in"
        style={{ background: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(4px)' }}
        onClick={onClose}
      />

      {/* Hoja con el mismo aspecto que la pantalla principal: fondo azul grisáceo, tarjetas blancas y aros de color */}
      <div
        className="relative w-full animate-slide-up scroll-hide"
        style={{ background: T.bgMain, borderRadius: '28px 28px 0 0', minHeight: '80vh', maxHeight: '94vh', overflowY: 'auto',
                 boxShadow: '0 -10px 40px rgba(15,23,42,0.25)' }}
      >
        {/* Asa */}
        <div className="flex justify-center pt-3 pb-2">
          <div style={{ width: 40, height: 4, background: isDark ? 'rgba(255,255,255,0.2)' : 'rgba(61,90,128,0.25)', borderRadius: 2 }} />
        </div>

        {/* Cabecera como la de la pantalla principal: logo con aro, título y botón redondo azul */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '4px 16px 14px' }}>
          <div className="of-ring" style={{ '--ring': BRAND, width: 56, height: 56, padding: 2, boxSizing: 'border-box', flexShrink: 0 }}>
            <div style={{ width: '100%', height: '100%', borderRadius: '50%', background: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
              <img src="/logo-oldface.png" alt="OldFace" style={{ width: '78%', height: '78%', objectFit: 'contain' }}
                onError={e => { e.target.style.display = 'none'; }} />
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 22, fontWeight: 800, color: T.textPrimary, lineHeight: 1.1, margin: 0 }}>{tr('OldFace')}</p>
            <p style={{ fontSize: 14, fontWeight: 600, color: T.textSecondary, margin: '3px 0 0' }}>{tr('Elige una acción')}</p>
          </div>
          <button onClick={onClose} aria-label={tr('Cerrar')}
            style={{ width: 44, height: 44, borderRadius: '50%', flexShrink: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                     background: isDark ? '#1B2230' : BRAND, border: isDark ? '1px solid rgba(127,163,209,0.35)' : 'none',
                     boxShadow: isDark ? '0 0 14px rgba(61,90,128,0.55)' : '0 6px 16px rgba(61,90,128,0.35)' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.6" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        <div style={{ padding: '0 12px calc(var(--sab) + 24px)' }}>
          {/* Buscador (el mismo de Chats y Contactos) */}
          <SearchBox value={query} onChange={setQuery} T={T} placeholder={tr('Buscar acción…')} style={{ margin: '0 0 6px' }} />

          {/* Destacadas: tarjetas grandes 2 × 2 */}
          {featured.length > 0 && (
            <>
              <SectionLabel T={T}>{tr('DESTACADAS')}</SectionLabel>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {featured.map((id, i) => (
                  <FeaturedCard key={id} id={id} item={ITEMS[id]} isDark={isDark} T={T} onClick={() => handleItem(ITEMS[id])}
                    wide={featured.length % 2 === 1 && i === featured.length - 1} />
                ))}
              </div>
            </>
          )}

          {/* Comunicación: tarjetas como las filas de la lista de chats */}
          {communication.length > 0 && (
            <>
              <SectionLabel T={T}>{tr('Comunicación').toUpperCase()}</SectionLabel>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {communication.map(id => (
                  <MenuCard key={id} id={id} item={ITEMS[id]} isDark={isDark} T={T} onClick={() => handleItem(ITEMS[id])} />
                ))}
              </div>
            </>
          )}

          {!featured.length && !communication.length && (
            <p style={{ textAlign: 'center', color: T.textMuted, fontSize: 14, padding: '24px 0' }}>{tr('Sin resultados')}</p>
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

// Color del aro de cada acción (como el aro de cada contacto en la pantalla principal)
const RING = {
  directo: '#EF4444', social: '#FF7A1A', taxi: '#EAB308', poll: '#22C55E',
  calls: '#22C55E', videocalls: '#0EA5E9', chats: '#4F7CC4', groups: '#818CF8',
  contacts: '#14B8A6', karaoke: '#EC4899', settings: '#64748B', archived: '#A855F7',
};

// ─── Icono redondo con aro de color (mismo estilo que NeonAvatar) ───────────
function RingIcon({ id, item, size = 48 }) {
  const ring = RING[id] || BRAND;
  return (
    <div className="of-ring" style={{ '--ring': ring, width: size, height: size, padding: 2, boxSizing: 'border-box', flexShrink: 0 }}>
      <div style={{ width: '100%', height: '100%', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
                    background: item.image ? 'white' : 'radial-gradient(circle at 35% 30%, #EEF5FC 0%, #D6E6F5 75%)' }}>
        {item.image ? (
          <img src={item.image} alt="" style={{ width: '80%', height: '80%', objectFit: 'contain' }} />
        ) : (
          <svg width={Math.round(size * 0.46)} height={Math.round(size * 0.46)} fill="none" stroke={ring} strokeLinecap="round" strokeLinejoin="round"
            viewBox="0 0 24 24" dangerouslySetInnerHTML={{ __html: item.icon }} />
        )}
      </div>
    </div>
  );
}

const pressFx = {
  onMouseDown: e => { e.currentTarget.style.transform = 'scale(0.97)'; },
  onMouseUp: e => { e.currentTarget.style.transform = 'scale(1)'; },
  onMouseLeave: e => { e.currentTarget.style.transform = 'scale(1)'; },
  onTouchStart: e => { e.currentTarget.style.transform = 'scale(0.97)'; },
  onTouchEnd: e => { e.currentTarget.style.transform = 'scale(1)'; },
};

// ─── Tarjeta destacada: icono grande con aro arriba, nombre y subtítulo ─────
function FeaturedCard({ id, item, isDark, T, onClick, wide = false }) {
  return (
    <button onClick={onClick} {...pressFx}
      style={{ ...cardStyle(T, isDark), gridColumn: wide ? '1 / -1' : undefined, display: 'flex', flexDirection: wide ? 'row' : 'column',
               alignItems: wide ? 'center' : 'flex-start', gap: wide ? 12 : 10, padding: '14px 14px 13px', textAlign: 'left', cursor: 'pointer',
               minWidth: 0, transition: 'transform 0.15s', WebkitTapHighlightColor: 'transparent' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: wide ? 'auto' : '100%' }}>
        <RingIcon id={id} item={item} size={54} />
        {!wide && (
          <svg width="18" height="18" fill="none" stroke={RING[id]} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
            <path d="M9 6l6 6-6 6" />
          </svg>
        )}
      </div>
      <div style={{ minWidth: 0, flex: wide ? 1 : undefined }}>
        <p style={{ fontSize: 16, fontWeight: 800, color: T.textPrimary, lineHeight: 1.2, margin: 0 }}>{item.label}</p>
        <p style={{ fontSize: 12.5, fontWeight: 600, color: T.textSecondary, margin: '2px 0 0' }}>{tr(SUBTITLES[id])}</p>
      </div>
    </button>
  );
}

// ─── Tarjeta de la sección Comunicación (como una fila de la lista de chats) ─
function MenuCard({ id, item, isDark, T, onClick }) {
  const isSoon = item.action === 'soon';
  return (
    <button onClick={onClick} {...pressFx}
      style={{ ...cardStyle(T, isDark), display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, padding: 10, textAlign: 'left',
               cursor: 'pointer', opacity: isSoon ? 0.7 : 1, transition: 'transform 0.15s', WebkitTapHighlightColor: 'transparent' }}>
      <RingIcon id={id} item={item} size={44} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 14.5, fontWeight: 700, color: T.textPrimary, lineHeight: 1.2, margin: 0,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</p>
        <p style={{ fontSize: 12, color: T.textSecondary, lineHeight: 1.3, margin: '2px 0 0',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tr(SUBTITLES[id])}</p>
      </div>
    </button>
  );
}
