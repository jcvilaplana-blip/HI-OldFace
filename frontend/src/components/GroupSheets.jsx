/**
 * GroupSheets — hojas de los grupos:
 *   GroupCreateSheet  → nombre, foto y participantes de un grupo nuevo
 *   AddMembersSheet   → añadir miembros a un grupo existente (si no se indica, primero se elige el grupo)
 *   GroupInfoSheet    → foto, nombre, miembros, añadir, quitar (administrador) y salir del grupo
 *
 * Los candidatos son los contactos del móvil que usan OldFace + las personas con las que ya hay chat
 * (así también funciona en el navegador, donde no hay agenda).
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useContacts } from '../hooks/useContacts';
import { useChatStore } from '../store/chatStore';
import NeonAvatar, { cardStyle, ringColorOf, BRAND } from './NeonAvatar.jsx';
import {
  createGroup, addMembers, fetchGroup, updateGroup, removeMember, compressGroupPhoto,
} from '../utils/groupsApi';
import { tr } from '../i18n';

// Misma lógica que el backend — userId desde cualquier formato de teléfono
function toUserId(phone) {
  const p = String(phone).trim().replace(/[\s-]/g, '');
  let digits;
  if (p.startsWith('+')) digits = p.slice(1).replace(/\D/g, '');
  else if (p.startsWith('0034')) digits = '34' + p.slice(4).replace(/\D/g, '');
  else {
    digits = p.replace(/\D/g, '');
    if (digits.length === 9) digits = '34' + digits;
  }
  return `user_${digits}`;
}

/** Personas que se pueden añadir: contactos con OldFace + chats 1 a 1 */
export function useCandidates(myId) {
  const { contacts, loading, loadContacts } = useContacts();
  const { chats } = useChatStore();
  useEffect(() => { loadContacts(); }, []); // eslint-disable-line
  const list = useMemo(() => {
    const map = new Map();
    for (const c of contacts) {
      if (!c.usesOldFace) continue;
      const id = toUserId(c.phone);
      if (id !== myId && !map.has(id)) map.set(id, { id, name: c.name, avatar: null });
    }
    for (const c of chats || []) {
      if (c.isGroup || String(c.id).startsWith('group_')) continue;
      const id = c.participants?.find(p => p !== myId);
      if (!id || id === myId) continue;
      const prev = map.get(id);
      map.set(id, { id, name: prev?.name || c.name || id, avatar: c.avatar || prev?.avatar || null });
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'));
  }, [contacts, chats, myId]);
  return { candidates: list, loading };
}

// ── Piezas comunes (mismo aspecto que la pantalla principal) ─────────────────
/** Fondo de las hojas: el de la pantalla principal (las tarjetas destacan encima) */
export const sheetBg = (T) => T.bgMain;

/** Asa superior de las hojas */
export function SheetHandle({ isDark }) {
  return <div style={{ width: 40, height: 4, borderRadius: 2, background: isDark ? 'rgba(255,255,255,0.2)' : '#cbd5e1', margin: '10px auto 10px', flexShrink: 0 }} />;
}

/** Botón redondo de cerrar (✕) */
export function CloseBtn({ T, isDark, onClick }) {
  return (
    <button onClick={onClick} aria-label={tr('Cerrar')}
      style={{ background: T.bgSurface, border: isDark ? '1px solid rgba(255,255,255,0.08)' : 'none', borderRadius: '50%', width: 40, height: 40, cursor: 'pointer', flexShrink: 0,
               display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: isDark ? 'none' : '0 2px 8px rgba(41,50,65,0.08)' }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={T.textPrimary} strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
    </button>
  );
}

export function Sheet({ T, isDark, title, subtitle, onClose, onBack, children, footer, z = 500 }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: z, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'flex-end' }}>
      <div onClick={e => e.stopPropagation()}
        style={{ width: '100%', maxHeight: '90vh', background: sheetBg(T, isDark), borderRadius: '24px 24px 0 0',
                 display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <SheetHandle isDark={isDark} />
        <div style={{ padding: '2px 16px 12px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          {onBack && (
            <button onClick={onBack} aria-label={tr('Atrás')}
              style={{ background: T.bgSurface, border: isDark ? '1px solid rgba(255,255,255,0.08)' : 'none', borderRadius: '50%', width: 40, height: 40, cursor: 'pointer', flexShrink: 0,
                       display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: isDark ? 'none' : '0 2px 8px rgba(41,50,65,0.08)' }}>
              <svg width="20" height="20" fill="none" stroke={T.textPrimary} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M15 19l-7-7 7-7"/></svg>
            </button>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 20, fontWeight: 700, color: T.textPrimary, margin: 0, lineHeight: 1.15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</p>
            {subtitle && <p style={{ fontSize: 13, color: T.textSecondary, margin: '3px 0 0', fontWeight: 600 }}>{subtitle}</p>}
          </div>
          <CloseBtn T={T} isDark={isDark} onClick={onClose} />
        </div>
        <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>{children}</div>
        {footer && (
          <div style={{ padding: '12px 16px', paddingBottom: 'calc(var(--sab, 0px) + 14px)', flexShrink: 0 }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export function PrimaryBtn({ children, disabled, onClick, danger }) {
  const glow = danger ? 'rgba(239,68,68,0.35)' : 'rgba(61,90,128,0.4)';
  return (
    <button onClick={onClick} disabled={disabled}
      style={{ width: '100%', padding: 15, borderRadius: 28, border: 'none', cursor: disabled ? 'default' : 'pointer',
               background: danger ? '#ef4444' : `linear-gradient(135deg, #34507A, ${BRAND}, #4A6B95)`, color: 'white', fontWeight: 800, fontSize: 15,
               opacity: disabled ? 0.5 : 1, boxShadow: disabled ? 'none' : `0 6px 16px ${glow}` }}>
      {children}
    </button>
  );
}

function Spinner({ T, text }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 110, gap: 10 }}>
      <div style={{ width: 26, height: 26, borderRadius: '50%', border: `3px solid ${T.border}`, borderTopColor: BRAND, animation: 'gsSpin 0.8s linear infinite' }} />
      <style>{'@keyframes gsSpin { to { transform: rotate(360deg) } }'}</style>
      <span style={{ fontSize: 13, color: T.textSecondary }}>{text}</span>
    </div>
  );
}

/** Lista con casillas para elegir personas */
export function PeoplePicker({ T, isDark, people, selected, onToggle, loading, emptyText }) {
  const [filter, setFilter] = useState('');
  if (loading && people.length === 0) return <Spinner T={T} text={tr('Cargando contactos...')} />;
  const shown = filter.trim() ? people.filter(p => p.name.toLowerCase().includes(filter.trim().toLowerCase())) : people;
  const check = isDark ? '#4F7CC4' : BRAND;
  return (
    <>
      {people.length > 6 && (
        <div style={{ padding: '4px 12px 10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: T.bgSurface, borderRadius: 22, padding: '10px 16px', border: `1px solid ${T.borderStrong}` }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={T.textMuted} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input value={filter} onChange={e => setFilter(e.target.value)} placeholder={tr('Buscar...')}
              style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none', fontSize: 14, color: T.textPrimary, fontWeight: 500, fontFamily: 'inherit' }} />
          </div>
        </div>
      )}
      {people.length === 0 ? (
        <p style={{ padding: '28px 24px', textAlign: 'center', fontSize: 14, color: T.textSecondary, margin: 0 }}>{emptyText}</p>
      ) : (
        <div style={{ padding: '0 12px 6px' }}>
          {shown.map(p => {
            const on = selected.has(p.id);
            return (
              <button key={p.id} onClick={() => onToggle(p.id)}
                style={{ ...cardStyle(T, isDark), width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '9px 12px', marginBottom: 8,
                         cursor: 'pointer', textAlign: 'left',
                         border: on ? `1.5px solid ${check}` : cardStyle(T, isDark).border,
                         background: on ? (isDark ? 'rgba(61,90,128,0.25)' : '#EDF3F8') : T.bgSurface }}>
                <NeonAvatar name={p.name} src={p.avatar} size={46} color={ringColorOf(p.id)} active={on} T={T} />
                <p style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 600, color: T.textPrimary, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</p>
                <div style={{ width: 26, height: 26, borderRadius: '50%', flexShrink: 0, border: `2px solid ${on ? check : T.borderStrong}`,
                              background: on ? check : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center',
                              boxShadow: on ? `0 0 10px ${isDark ? 'rgba(79,124,196,0.6)' : 'rgba(61,90,128,0.35)'}` : 'none' }}>
                  {on && <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

/** Foto redonda del grupo con botón de cámara para elegir otra */
function GroupPhotoPicker({ T, src, onPick, size = 76 }) {
  const ref = useRef(null);
  return (
    <button onClick={() => ref.current?.click()} aria-label={tr('Elegir foto del grupo')}
      className="of-ring" style={{ '--ring': '#4F7CC4', position: 'relative', width: size, height: size, borderRadius: '50%', border: 'none', padding: 2, cursor: 'pointer', flexShrink: 0,
               boxSizing: 'border-box', background: 'transparent' }}>
      {src
        ? <img src={src} alt="" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover', display: 'block' }} />
        : <span style={{ width: '100%', height: '100%', borderRadius: '50%', display: 'flex', background: 'radial-gradient(circle at 35% 30%, #EEF5FC 0%, #D6E6F5 75%)' }}>
            <GroupIcon size={size * 0.42} color={BRAND} />
          </span>}
      <span style={{ position: 'absolute', right: -2, bottom: -2, width: 28, height: 28, borderRadius: '50%', background: BRAND, border: `2px solid ${T.bgMain}`,
                     display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/>
        </svg>
      </span>
      <input ref={ref} type="file" accept="image/*" hidden
        onChange={async e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onPick(await compressGroupPhoto(f).catch(() => null)); }} />
    </button>
  );
}

export function GroupIcon({ size = 24, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ margin: 'auto', display: 'block' }}>
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>
    </svg>
  );
}

// ══ Crear grupo ══════════════════════════════════════════════════════════════
export function GroupCreateSheet({ user, T, isDark, onClose, onCreated }) {
  const { candidates, loading } = useCandidates(user?.id);
  const [name, setName]         = useState('');
  const [photo, setPhoto]       = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState('');

  const toggle = (id) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const create = async () => {
    if (!name.trim()) { setError(tr('Escribe un nombre para el grupo')); return; }
    if (selected.size === 0) { setError(tr('Elige al menos un participante')); return; }
    setBusy(true); setError('');
    try {
      const g = await createGroup(user.id, name.trim(), [...selected], photo);
      onCreated(g);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Sheet T={T} isDark={isDark} title={tr('Nuevo grupo')} onClose={onClose}
      subtitle={selected.size ? tr('{size} participante{p1} elegido{p2}', { size: selected.size, p1: selected.size === 1 ? '' : 's', p2: selected.size === 1 ? '' : 's' }) : tr('Elige foto, nombre y participantes')}
      footer={<>
        {error && <p style={{ fontSize: 12, color: '#ef4444', margin: '0 0 8px', fontWeight: 600 }}>{error}</p>}
        <PrimaryBtn onClick={create} disabled={busy || !name.trim() || selected.size === 0}>
          {busy ? tr('Creando grupo...') : tr('Crear grupo{p0}', { p0: selected.size ? ` (${selected.size + 1})` : '' })}
        </PrimaryBtn>
      </>}>
      <div style={{ ...cardStyle(T, isDark), display: 'flex', alignItems: 'center', gap: 14, padding: '14px', margin: '0 12px' }}>
        <GroupPhotoPicker T={T} src={photo} onPick={p => p && setPhoto(p)} />
        <input value={name} onChange={e => { setName(e.target.value); setError(''); }} placeholder={tr('Nombre del grupo')} maxLength={50}
          style={{ flex: 1, minWidth: 0, padding: '12px 16px', borderRadius: 22, border: `1px solid ${T.borderStrong}`, fontSize: 15, fontWeight: 600,
                   outline: 'none', background: isDark ? T.bgInput : '#F4F8FB', color: T.textPrimary, fontFamily: 'inherit' }} />
      </div>
      <p style={{ fontSize: 12, fontWeight: 800, color: T.textSecondary, letterSpacing: '0.6px', margin: '16px 18px 8px' }}>{tr('PARTICIPANTES')}</p>
      <PeoplePicker T={T} isDark={isDark} people={candidates} selected={selected} onToggle={toggle} loading={loading}
        emptyText={tr('No hay contactos en OldFace para añadir. Busca a alguien por teléfono en Contactos y escríbele primero.')} />
    </Sheet>
  );
}

// ══ Añadir miembros ══════════════════════════════════════════════════════════
/**
 * @param group   grupo al que añadir; si es null se muestra antes la lista `groups` para elegirlo
 */
export function AddMembersSheet({ user, T, isDark, group: initialGroup = null, groups = [], onClose, onDone, z }) {
  const { candidates, loading } = useCandidates(user?.id);
  const [group, setGroup]       = useState(initialGroup);
  const [selected, setSelected] = useState(new Set());
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState('');

  const available = group ? candidates.filter(c => !group.members?.includes(c.id)) : [];
  const toggle = (id) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const save = async () => {
    setBusy(true); setError('');
    try {
      const g = await addMembers(group.id, user.id, [...selected]);
      onDone?.(g);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  if (!group) {
    return (
      <Sheet T={T} isDark={isDark} title={tr('Añadir miembros')} subtitle={tr('¿A qué grupo?')} onClose={onClose} z={z}>
        {groups.length === 0 ? (
          <p style={{ padding: '28px 24px', textAlign: 'center', fontSize: 14, color: T.textSecondary, margin: 0 }}>{tr('Todavía no tienes grupos')}</p>
        ) : (
          <div style={{ padding: '0 12px 14px' }}>
            {groups.map(g => (
              <button key={g.id} onClick={() => setGroup(g)}
                style={{ ...cardStyle(T, isDark), width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', marginBottom: 8,
                         cursor: 'pointer', textAlign: 'left' }}>
                <NeonAvatar name={g.name} src={g.avatar} size={50} color={ringColorOf(g.id)} T={T} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: T.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.name}</p>
                  <p style={{ margin: '2px 0 0', fontSize: 12, fontWeight: 500, color: T.textSecondary }}>{tr('{n} miembros', { n: g.members.length })}</p>
                </div>
                <svg width="18" height="18" fill="none" stroke={T.textMuted} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>
              </button>
            ))}
          </div>
        )}
      </Sheet>
    );
  }

  return (
    <Sheet T={T} isDark={isDark} title={tr('Añadir a {name}', { name: group.name })} onClose={onClose} z={z}
      onBack={initialGroup ? null : () => { setGroup(null); setSelected(new Set()); }}
      subtitle={selected.size ? `${selected.size} elegido${selected.size === 1 ? '' : 's'}` : tr('Elige a quién añadir')}
      footer={<>
        {error && <p style={{ fontSize: 12, color: '#ef4444', margin: '0 0 8px', fontWeight: 600 }}>{error}</p>}
        <PrimaryBtn onClick={save} disabled={busy || selected.size === 0}>
          {busy ? tr('Añadiendo...') : tr('Añadir{p0}', { p0: selected.size ? ` (${selected.size})` : '' })}
        </PrimaryBtn>
      </>}>
      <PeoplePicker T={T} isDark={isDark} people={available} selected={selected} onToggle={toggle} loading={loading}
        emptyText={tr('Todos tus contactos de OldFace ya están en el grupo')} />
    </Sheet>
  );
}

// ══ Info del grupo ═══════════════════════════════════════════════════════════
export function GroupInfoSheet({ user, T, isDark, groupId, onClose, onChanged, onLeft }) {
  const [group, setGroup]       = useState(null);
  const [error, setError]       = useState('');
  const [editing, setEditing]   = useState(false);
  const [name, setName]         = useState('');
  const [adding, setAdding]     = useState(false);
  const [confirm, setConfirm]   = useState(null);   // { type: 'leave' } | { type: 'remove', id, name }
  const [busy, setBusy]         = useState(false);

  const load = () => fetchGroup(groupId, user.id)
    .then(g => { setGroup(g); setName(g.name); return g; })
    .catch(err => { setError(err.message); return null; });
  useEffect(() => { load(); }, [groupId]); // eslint-disable-line

  const changed = (g) => { setGroup(g); setName(g.name); onChanged?.(g); };

  const saveName = async () => {
    if (!name.trim() || name.trim() === group.name) { setEditing(false); return; }
    try { changed(await updateGroup(group.id, user.id, { name: name.trim() })); setEditing(false); }
    catch (err) { setError(err.message); }
  };

  const savePhoto = async (photo) => {
    if (!photo) { setError(tr('No se pudo usar esa imagen')); return; }
    try { changed(await updateGroup(group.id, user.id, { avatar: photo })); }
    catch (err) { setError(err.message); }
  };

  const doConfirm = async () => {
    setBusy(true); setError('');
    try {
      if (confirm.type === 'leave') {
        await removeMember(group.id, user.id, user.id);
        onLeft?.();
        return;
      }
      await removeMember(group.id, user.id, confirm.id);
      setConfirm(null);
      const g = await load();
      if (g) onChanged?.(g);
    } catch (err) { setError(err.message); }
    setBusy(false);
  };

  if (!group) {
    return (
      <Sheet T={T} isDark={isDark} title={tr('Info del grupo')} onClose={onClose}>
        {error ? <p style={{ padding: 24, color: '#ef4444', textAlign: 'center', margin: 0 }}>{error}</p> : <Spinner T={T} text={tr('Cargando...')} />}
      </Sheet>
    );
  }

  const isAdmin = group.adminId === user.id;
  const members = [...group.members].sort((a, b) => (a === user.id ? -1 : b === user.id ? 1
    : (group.memberNames[a] || '').localeCompare(group.memberNames[b] || '', 'es')));

  return (
    <>
      <Sheet T={T} isDark={isDark} title={tr('Info del grupo')} onClose={onClose}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '20px 18px 14px' }}>
          <GroupPhotoPicker T={T} src={group.avatar} onPick={savePhoto} size={96} />
          {editing ? (
            <div style={{ display: 'flex', gap: 8, width: '100%' }}>
              <input value={name} onChange={e => setName(e.target.value)} maxLength={50} autoFocus
                onKeyDown={e => e.key === 'Enter' && saveName()}
                style={{ flex: 1, minWidth: 0, padding: '10px 16px', borderRadius: 22, border: `1.5px solid ${BRAND}`, fontSize: 15, fontWeight: 700,
                         outline: 'none', background: T.bgInput, color: T.textPrimary, fontFamily: 'inherit' }} />
              <button onClick={saveName} style={{ background: BRAND, color: 'white', border: 'none', borderRadius: 14, padding: '0 16px', fontWeight: 800, cursor: 'pointer' }}>{tr('Guardar')}</button>
            </div>
          ) : (
            <button onClick={() => setEditing(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 20, fontWeight: 900, color: T.textPrimary }}>{group.name}</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={T.textMuted} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg>
            </button>
          )}
          <p style={{ margin: 0, fontSize: 13, color: T.textSecondary }}>{tr('Grupo ·')}{' '}{group.members.length}{' '}{tr('miembros')}</p>
        </div>

        {error && <p style={{ fontSize: 12, color: '#ef4444', margin: '0 18px 8px', fontWeight: 600 }}>{error}</p>}

        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '8px 18px 8px' }}>
          <p style={{ fontSize: 12, fontWeight: 800, color: T.textSecondary, letterSpacing: '0.6px', margin: 0 }}>{tr('MIEMBROS')}</p>
          <span style={{ fontSize: 12, fontWeight: 700, color: T.textMuted }}>{group.members.length}</span>
        </div>
        <div style={{ padding: '0 12px' }}>
          <button onClick={() => setAdding(true)}
            style={{ ...cardStyle(T, isDark), width: '100%', display: 'flex', alignItems: 'center', gap: 14, padding: '10px 12px', marginBottom: 8, cursor: 'pointer', textAlign: 'left' }}>
            <span style={{ width: 44, height: 44, borderRadius: '50%', background: BRAND, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                           boxShadow: isDark ? '0 0 14px rgba(61,90,128,0.8)' : '0 4px 12px rgba(61,90,128,0.35)' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>
            </span>
            <span style={{ fontSize: 15, fontWeight: 700, color: isDark ? '#9FC0E6' : BRAND }}>{tr('Añadir miembros')}</span>
          </button>
          {members.map(id => {
            const nm = id === user.id ? tr('Tú') : (group.memberNames[id] || id);
            return (
              <div key={id} style={{ ...cardStyle(T, isDark), display: 'flex', alignItems: 'center', gap: 12, padding: '9px 12px', marginBottom: 8 }}>
                <NeonAvatar name={group.memberNames[id] || id} size={44} color={ringColorOf(id)} T={T} />
                <p style={{ flex: 1, minWidth: 0, margin: 0, fontSize: 15, fontWeight: 600, color: T.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nm}</p>
                {group.adminId === id && (
                  <span style={{ fontSize: 11, fontWeight: 800, color: isDark ? '#9FC0E6' : BRAND, background: isDark ? 'rgba(61,90,128,0.25)' : '#E3EDF2', padding: '4px 10px', borderRadius: 12 }}>{tr('Admin')}</span>
                )}
                {isAdmin && id !== user.id && (
                  <button onClick={() => setConfirm({ type: 'remove', id, name: nm })}
                    style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.35)', borderRadius: 14, color: '#ef4444', fontSize: 12, fontWeight: 800, cursor: 'pointer', padding: '5px 12px' }}>{tr('Quitar')}</button>
                )}
              </div>
            );
          })}
        </div>

        <div style={{ padding: '18px 16px', paddingBottom: 'calc(var(--sab, 0px) + 18px)' }}>
          <PrimaryBtn danger onClick={() => setConfirm({ type: 'leave' })}>{tr('Salir del grupo')}</PrimaryBtn>
        </div>
      </Sheet>

      {adding && (
        <AddMembersSheet user={user} T={T} isDark={isDark} group={group} z={600}
          onClose={() => setAdding(false)}
          onDone={(g) => { setAdding(false); changed(g); }} />
      )}

      {confirm && (
        <div onClick={() => !busy && setConfirm(null)} style={{ position: 'fixed', inset: 0, zIndex: 700, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div onClick={e => e.stopPropagation()} style={{ ...cardStyle(T, isDark), borderRadius: 22, padding: '22px 20px 16px', width: '100%', maxWidth: 340 }}>
            <p style={{ margin: '0 0 8px', fontSize: 17, fontWeight: 900, color: T.textPrimary }}>
              {confirm.type === 'leave' ? tr('¿Salir de "{name}"?', { name: group.name }) : tr('¿Quitar a {name}?', { name: confirm.name })}
            </p>
            <p style={{ margin: '0 0 18px', fontSize: 13, color: T.textSecondary, lineHeight: 1.5 }}>
              {confirm.type === 'leave'
                ? tr('Dejarás de recibir sus mensajes y llamadas. Pueden volver a añadirte.')
                : tr('Dejará de recibir los mensajes y llamadas del grupo.')}
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setConfirm(null)} disabled={busy}
                style={{ flex: 1, padding: 12, borderRadius: 14, border: `1.5px solid ${T.borderStrong}`, background: 'transparent', color: T.textPrimary, fontWeight: 800, cursor: 'pointer' }}>{tr('Cancelar')}</button>
              <button onClick={doConfirm} disabled={busy}
                style={{ flex: 1, padding: 12, borderRadius: 14, border: 'none', background: '#ef4444', color: 'white', fontWeight: 800, cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>
                {confirm.type === 'leave' ? tr('Salir') : tr('Quitar')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
