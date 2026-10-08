/**
 * GroupsBar — renglón "Grupos" de la página principal.
 *   · Los grupos del usuario (foto + nombre); con una llamada en curso llevan un distintivo verde.
 *   · Botón "+" al final: crear un grupo nuevo o añadir miembros a uno existente.
 *   · Tocar un grupo abre su chat (desde allí: llamada, videollamada e info del grupo).
 */
import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Avatar from './Avatar.jsx';
import { GroupCreateSheet, AddMembersSheet } from './GroupSheets.jsx';
import { fetchGroups } from '../utils/groupsApi';
import { useChatStore } from '../store/chatStore';

const BRAND = '#3D5A80';

export default function GroupsBar({ user, T, isDark }) {
  const navigate = useNavigate();
  const { fetchChats } = useChatStore();
  const [groups, setGroups] = useState([]);
  const [menu, setMenu]     = useState(false);
  const [sheet, setSheet]   = useState(null);   // 'create' | 'add'

  const load = useCallback(() => {
    if (!user?.id) return;
    fetchGroups(user.id).then(setGroups).catch(() => {});
  }, [user?.id]);

  useEffect(() => {
    load();
    const iv = setInterval(load, 15_000);
    return () => clearInterval(iv);
  }, [load]);

  const openGroup = (g) => {
    const chatId = g.chatId || `group_${g.id}`;
    navigate(`/chat/${chatId}`, { state: { chat: { id: chatId, name: g.name, avatar: g.avatar || null, isGroup: true, groupId: g.id } } });
  };

  const noGroups = groups.length === 0;

  return (
    <>
      <div style={{ background: T.bgSurface, borderBottom: `1px solid ${T.border}`, padding: '8px 0 10px' }}>
        <p style={{ margin: '0 14px 6px', fontSize: 11, fontWeight: 800, letterSpacing: '0.6px', color: BRAND }}>GRUPOS</p>
        <div className="scroll-hide" style={{ display: 'flex', gap: 14, overflowX: 'auto', padding: '0 14px' }}>
          {groups.map(g => (
            <button key={g.id} onClick={() => openGroup(g)}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flexShrink: 0, width: 62,
                       background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
              <div style={{ position: 'relative' }}>
                <div style={{ width: 54, height: 54, borderRadius: '50%', overflow: 'hidden', boxSizing: 'border-box',
                              border: `2px solid ${g.activeCall ? '#22c55e' : 'transparent'}`,
                              display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Avatar name={g.name} src={g.avatar || null} size="lg" />
                </div>
                {g.activeCall && (
                  <span title="Llamada en curso"
                    style={{ position: 'absolute', right: -2, bottom: -2, width: 20, height: 20, borderRadius: '50%', background: '#22c55e',
                             border: `2px solid ${T.bgSurface}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="white"><path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/></svg>
                  </span>
                )}
              </div>
              <span style={{ fontSize: 11, color: T.textSecondary, fontWeight: 600, width: '100%', textAlign: 'center',
                             overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {g.name}
              </span>
            </button>
          ))}

          {/* "+" al final del renglón */}
          <button onClick={() => (noGroups ? setSheet('create') : setMenu(true))} aria-label="Crear grupo o añadir miembros"
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flexShrink: 0, width: 62,
                     background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
            <div style={{ width: 54, height: 54, borderRadius: '50%', border: `2px dashed ${T.textMuted}`, boxSizing: 'border-box',
                          display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={BRAND} strokeWidth="2.8" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
            </div>
            <span style={{ fontSize: 11, color: T.textSecondary, fontWeight: 600, whiteSpace: 'nowrap' }}>{noGroups ? 'Crear grupo' : 'Añadir'}</span>
          </button>
        </div>
      </div>

      {/* Menú del "+": crear o añadir miembros */}
      {menu && (
        <div onClick={() => setMenu(false)} style={{ position: 'fixed', inset: 0, zIndex: 480, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ width: '100%', background: isDark ? '#0a1929' : 'white', borderRadius: '22px 22px 0 0', padding: '10px 0',
                     paddingBottom: 'calc(var(--sab, 0px) + 14px)' }}>
            <div style={{ width: 40, height: 4, borderRadius: 2, background: T.border, margin: '0 auto 10px' }} />
            <MenuItem T={T} title="Crear grupo nuevo" sub="Elige nombre, foto y participantes"
              onClick={() => { setMenu(false); setSheet('create'); }}
              icon={<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>} />
            <MenuItem T={T} title="Añadir miembros a un grupo" sub="Elige el grupo y a quién añadir"
              onClick={() => { setMenu(false); setSheet('add'); }}
              icon={<path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM19 8v6M22 11h-6"/>} />
          </div>
        </div>
      )}

      {sheet === 'create' && (
        <GroupCreateSheet user={user} T={T} isDark={isDark}
          onClose={() => setSheet(null)}
          onCreated={(g) => { setSheet(null); load(); fetchChats(user.id); openGroup(g); }} />
      )}
      {sheet === 'add' && (
        <AddMembersSheet user={user} T={T} isDark={isDark} groups={groups}
          onClose={() => setSheet(null)}
          onDone={() => { setSheet(null); load(); }} />
      )}
    </>
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
