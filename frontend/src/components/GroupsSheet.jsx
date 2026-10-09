/**
 * GroupsSheet — hoja que abre el botón "Grupos" de la barra inferior.
 *   · Sin grupos: abre directamente "Crear grupo".
 *   · Con grupos: lista de grupos (no leídos y llamada en curso) + "Crear grupo nuevo" y "Añadir miembros a un grupo".
 *   · Tocar un grupo abre su chat (desde allí: llamada, videollamada e info del grupo).
 */
import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Avatar from './Avatar.jsx';
import { GroupCreateSheet, AddMembersSheet } from './GroupSheets.jsx';
import { fetchGroups } from '../utils/groupsApi';
import { useChatStore } from '../store/chatStore';
import { tr } from '../i18n';

const BRAND = '#3D5A80';

export default function GroupsSheet({ user, T, isDark, onClose }) {
  const navigate = useNavigate();
  const { chats, fetchChats } = useChatStore();
  const [groups, setGroups] = useState(null);   // null = cargando
  const [sheet, setSheet]   = useState(null);   // 'create' | 'add'

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

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 480, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end' }}>
      <div onClick={e => e.stopPropagation()}
        style={{ width: '100%', maxHeight: '80dvh', display: 'flex', flexDirection: 'column',
                 background: isDark ? '#0a1929' : 'white', borderRadius: '22px 22px 0 0', padding: '10px 0',
                 paddingBottom: 'calc(var(--sab, 0px) + 14px)' }}>
        <div style={{ width: 40, height: 4, borderRadius: 2, background: T.border, margin: '0 auto 8px', flexShrink: 0 }} />
        <p style={{ margin: '0 20px 6px', fontSize: 11, fontWeight: 800, letterSpacing: '0.6px', color: BRAND, flexShrink: 0 }}>{tr('GRUPOS')}</p>

        <div style={{ overflowY: 'auto', flex: 1 }}>
          {groups.map(g => {
            const unread = unreadOf(g);
            return (
              <button key={g.id} onClick={() => openGroup(g)}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 14, padding: '9px 20px',
                         background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
                <div style={{ position: 'relative', flexShrink: 0 }}>
                  <div style={{ width: 46, height: 46, borderRadius: '50%', overflow: 'hidden', boxSizing: 'border-box',
                                border: `2px solid ${g.activeCall ? '#22c55e' : 'transparent'}`,
                                display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Avatar name={g.name} src={g.avatar || null} size="md" />
                  </div>
                  {g.activeCall && (
                    <span title={tr('Llamada en curso')}
                      style={{ position: 'absolute', right: -2, bottom: -2, width: 18, height: 18, borderRadius: '50%', background: '#22c55e',
                               border: `2px solid ${isDark ? '#0a1929' : 'white'}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="white"><path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/></svg>
                    </span>
                  )}
                </div>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 15, fontWeight: 800, color: T.textPrimary,
                                 overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.name}</span>
                  <span style={{ display: 'block', fontSize: 12, color: g.activeCall ? '#16a34a' : T.textSecondary }}>
                    {g.activeCall ? tr('Llamada en curso') : `${g.members?.length || 0} miembros`}
                  </span>
                </span>
                {unread > 0 && (
                  <span style={{ minWidth: 20, height: 20, borderRadius: 10, background: BRAND, color: 'white', fontSize: 11, fontWeight: 800,
                                 display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 6px', flexShrink: 0 }}>
                    {unread > 9 ? '9+' : unread}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div style={{ borderTop: `1px solid ${T.border}`, marginTop: 6, paddingTop: 4, flexShrink: 0 }}>
          <MenuItem T={T} title={tr('Crear grupo nuevo')} sub={tr('Elige nombre, foto y participantes')}
            onClick={() => setSheet('create')}
            icon={<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>} />
          <MenuItem T={T} title={tr('Añadir miembros a un grupo')} sub={tr('Elige el grupo y a quién añadir')}
            onClick={() => setSheet('add')}
            icon={<path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM19 8v6M22 11h-6"/>} />
        </div>
      </div>
    </div>
  );
}

function MenuItem({ T, title, sub, icon, onClick }) {
  return (
    <button onClick={onClick}
      style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 14, padding: '12px 20px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
      <span style={{ width: 42, height: 42, borderRadius: '50%', background: BRAND, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">{icon}</svg>
      </span>
      <span>
        <span style={{ display: 'block', fontSize: 15, fontWeight: 800, color: T.textPrimary }}>{title}</span>
        <span style={{ display: 'block', fontSize: 12, color: T.textSecondary }}>{sub}</span>
      </span>
    </button>
  );
}
