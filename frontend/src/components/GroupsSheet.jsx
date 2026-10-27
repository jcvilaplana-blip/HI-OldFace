/**
 * GroupsSheet — hoja que abre el botón "Grupos" de la barra inferior.
 *   · Sin grupos: abre directamente "Crear grupo".
 *   · Con grupos: arriba "Crear grupo nuevo" y "Añadir miembros a un grupo"; debajo, cuántos grupos hay y la lista
 *     (no leídos y llamada en curso), que se desplaza.
 *   · Tocar un grupo abre su chat (desde allí: llamada, videollamada e info del grupo).
 * Mismo aspecto que la pantalla principal: tarjetas y aros de color (NeonAvatar).
 */
import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import NeonAvatar, { cardStyle, ringColorOf, BRAND } from './NeonAvatar.jsx';
import { GroupCreateSheet, AddMembersSheet, SheetHandle, CloseBtn, sheetBg } from './GroupSheets.jsx';
import { fetchGroups } from '../utils/groupsApi';
import { useChatStore } from '../store/chatStore';
import { tr } from '../i18n';
import { useBackClose } from '../utils/backHandler';

export default function GroupsSheet({ user, T, isDark, onClose }) {
  const navigate = useNavigate();
  const { chats, fetchChats } = useChatStore();
  const [groups, setGroups] = useState(null);   // null = cargando
  const [sheet, setSheet]   = useState(null);   // 'create' | 'add'
  const [lit, setLit]       = useState(null);   // grupo con el aro encendido al pulsarlo

  const load = useCallback(() => {
    if (!user?.id) return Promise.resolve([]);
    return fetchGroups(user.id).then(gs => { setGroups(gs); return gs; }).catch(() => { setGroups([]); return []; });
  }, [user?.id]);

  useEffect(() => {
    load().then(gs => { if (gs.length === 0) setSheet('create'); });
  }, [load]);

  const openGroup = (g) => {
    const chatId = g.chatId || `group_${g.id}`;
    onClose();
    navigate(`/chat/${chatId}`, { state: { chat: { id: chatId, name: g.name, avatar: g.avatar || null, isGroup: true, groupId: g.id } } });
  };
  const pressGroup = (g) => { setLit(g.id); setTimeout(() => openGroup(g), 180); };

  // Atrás dentro de Crear / Añadir miembros vuelve a la lista (o cierra si no hay grupos)
  useBackClose(sheet !== null, () => (sheet === 'create' && !groups?.length ? onClose() : setSheet(null)));

  const unreadOf = (g) => chats.find(c => c.id === (g.chatId || `group_${g.id}`))?.unread || 0;

  // Sin grupos solo se muestra la hoja de crear; al cerrarla se cierra todo
  if (sheet === 'create') {
    return (
      <GroupCreateSheet user={user} T={T} isDark={isDark}
        onClose={() => (groups?.length ? setSheet(null) : onClose())}
        onCreated={(g) => { fetchChats(user.id); openGroup(g); }} />
    );
  }
  if (sheet === 'add') {
    return (
      <AddMembersSheet user={user} T={T} isDark={isDark} groups={groups || []}
        onClose={() => setSheet(null)}
        onDone={() => { setSheet(null); load(); }} />
    );
  }
  if (groups === null) return null;

  const count = groups.length;

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 480, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end' }}>
      <div onClick={e => e.stopPropagation()}
        style={{ width: '100%', maxHeight: '88dvh', display: 'flex', flexDirection: 'column',
                 background: sheetBg(T, isDark), borderRadius: '24px 24px 0 0', overflow: 'hidden' }}>
        <SheetHandle isDark={isDark} />

        {/* Cabecera: título, número de grupos y cerrar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '4px 16px 12px', flexShrink: 0 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 20, fontWeight: 700, color: T.textPrimary, margin: 0, lineHeight: 1.15 }}>{tr('Grupos')}</p>
            <p style={{ fontSize: 13, fontWeight: 600, color: T.textSecondary, margin: '3px 0 0' }}>
              {count === 1 ? tr('1 grupo') : tr('{n} grupos', { n: count })}
            </p>
          </div>
          <CloseBtn T={T} isDark={isDark} onClick={onClose} />
        </div>

        {/* Acciones arriba */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '0 12px 4px', flexShrink: 0 }}>
          <ActionCard T={T} isDark={isDark} title={tr('Crear grupo nuevo')} sub={tr('Elige nombre, foto y participantes')}
            onClick={() => setSheet('create')}
            icon={<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>} />
          <ActionCard T={T} isDark={isDark} title={tr('Añadir miembros a un grupo')} sub={tr('Elige el grupo y a quién añadir')}
            onClick={() => setSheet('add')}
            icon={<path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM19 8v6M22 11h-6"/>} />
        </div>

        {/* Mis grupos (se desplaza) */}
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '14px 18px 8px', flexShrink: 0 }}>
          <p style={{ margin: 0, fontSize: 12, fontWeight: 800, letterSpacing: '0.6px', color: T.textSecondary }}>{tr('MIS GRUPOS')}</p>
          <span style={{ fontSize: 12, fontWeight: 700, color: T.textMuted }}>{count}</span>
        </div>
        <div style={{ overflowY: 'auto', flex: 1, padding: '0 12px', paddingBottom: 'calc(var(--sab, 0px) + 14px)' }}>
          {groups.map(g => {
            const unread = unreadOf(g);
            return (
              <button key={g.id} onClick={() => pressGroup(g)} onTouchStart={() => setLit(g.id)} onTouchMove={() => setLit(null)}
                style={{ ...cardStyle(T, isDark), width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
                         marginBottom: 8, cursor: 'pointer', textAlign: 'left' }}>
                <div style={{ position: 'relative', flexShrink: 0 }}>
                  <NeonAvatar name={g.name} src={g.avatar || null} size={50} T={T}
                    color={g.activeCall ? '#22C55E' : ringColorOf(g.id)} active={lit === g.id || !!g.activeCall} />
                  {g.activeCall && (
                    <span title={tr('Llamada en curso')}
                      style={{ position: 'absolute', right: -2, bottom: -2, width: 18, height: 18, borderRadius: '50%', background: '#22c55e',
                               border: `2px solid ${T.bgSurface}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="white"><path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/></svg>
                    </span>
                  )}
                </div>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 15, fontWeight: 600, color: T.textPrimary,
                                 overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.name}</span>
                  <span style={{ display: 'block', fontSize: 12, fontWeight: 500, marginTop: 2,
                                 color: g.activeCall ? '#16a34a' : T.textSecondary }}>
                    {g.activeCall ? tr('Llamada en curso') : tr('{n} miembros', { n: g.members?.length || 0 })}
                  </span>
                </span>
                {unread > 0 ? (
                  <span style={{ minWidth: 22, height: 22, borderRadius: 11, background: isDark ? '#4F7CC4' : BRAND, color: 'white', fontSize: 11, fontWeight: 800,
                                 display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 6px', flexShrink: 0,
                                 boxShadow: `0 0 10px ${isDark ? 'rgba(79,124,196,0.6)' : 'rgba(61,90,128,0.35)'}` }}>
                    {unread > 99 ? '99+' : unread}
                  </span>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={T.textMuted} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M9 6l6 6-6 6"/></svg>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Tarjeta de acción: círculo azul de marca con icono, título, explicación y flecha */
function ActionCard({ T, isDark, title, sub, icon, onClick }) {
  return (
    <button onClick={onClick}
      style={{ ...cardStyle(T, isDark), width: '100%', display: 'flex', alignItems: 'center', gap: 14, padding: '12px 14px', cursor: 'pointer', textAlign: 'left' }}>
      <span style={{ width: 46, height: 46, borderRadius: '50%', background: BRAND, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                     boxShadow: isDark ? '0 0 14px rgba(61,90,128,0.8)' : '0 4px 12px rgba(61,90,128,0.35)' }}>
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">{icon}</svg>
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 15, fontWeight: 700, color: T.textPrimary }}>{title}</span>
        <span style={{ display: 'block', fontSize: 12, color: T.textSecondary, marginTop: 2 }}>{sub}</span>
      </span>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={T.textMuted} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M9 6l6 6-6 6"/></svg>
    </button>
  );
}
