/**
 * ChatOptionsSheet — ventana emergente con las opciones de un chat. Se abre con pulsación larga en la lista de chats
 * y desde "⋮" dentro del chat.
 *
 * Opciones: archivos del chat (fotos, vídeos, documentos y enlaces) · silenciar · guardar fotos (siempre/nunca, en
 * este móvil) · compartir contacto · vaciar chat (solo para mí) · bloquear/desbloquear · eliminar chat (solo en la
 * lista). En grupos no hay bloquear ni compartir contacto; en el chat "Tú" tampoco.
 *
 * Props: chat { id, name, avatar, isGroup, self } · onClose() · onChanged(kind) · extra [[label, fn, icon]] (opciones
 * propias de la pantalla del chat, van arriba) · showDelete (lista de chats)
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useThemeStore, DARK, LIGHT } from '../store/themeStore';
import { useChatStore } from '../store/chatStore';
import { useAuthStore } from '../store/authStore';
import NeonAvatar, { BRAND, ringColorOf } from './NeonAvatar.jsx';
import { tr } from '../i18n';
import { useBackClose } from '../utils/backHandler';
import { getMutes, isMutedNow, setMute } from '../utils/mutesReminders';
import {
  getBlocks, isBlockedNow, setBlocked, clearChat, peerOf, isSelfChatId, getAutoSave, setAutoSave, shareContact,
} from '../utils/chatOptions';

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
const absUrl = (u) => (u && !/^(https?|data|blob):/.test(u) ? new URL(u, BACKEND).href : u);
const LINK_RE = /\bhttps?:\/\/[^\s<>"']+/gi;

const ICONS = {
  files:  <><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/></>,
  mute:   <><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M23 9l-6 6M17 9l6 6"/></>,
  unmute: <><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 010 7M19 5a10 10 0 010 14"/></>,
  save:   <><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><path d="M7 10l5 5 5-5M12 15V3"/></>,
  share:  <><circle cx="9" cy="8" r="4"/><path d="M2 21v-1a6 6 0 0112 0v1"/><path d="M16 11h6M19 8l3 3-3 3"/></>,
  clear:  <><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/><path d="M10 11l4 4M14 11l-4 4"/></>,
  block:  <><circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/></>,
  delete: <><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/></>,
  star:   <path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>,
  image:  <><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 16l5-5 4 4 3-3 6 6"/></>,
  info:   <><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></>,
  back:  <path d="M15 18l-6-6 6-6"/>,
  doc:    <><path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9z"/><path d="M14 3v6h6"/></>,
  link:   <><path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/></>,
  play:   <path d="M8 5v14l11-7z"/>,
};
const Ico = ({ name, color, size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={name === 'play' ? color : 'none'} stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {ICONS[name]}
  </svg>
);

export default function ChatOptionsSheet({ chat, onClose, onChanged, extra = [], showDelete = false }) {
  const { isDark } = useThemeStore();
  const T = isDark ? DARK : LIGHT;
  const myId = useAuthStore(s => s.user?.id);
  const deleteChat = useChatStore(s => s.deleteChat);
  const [view, setView] = useState('main');        // main | files | mute | save | share | clear | block | delete
  const [muteUntil, setMuteUntil] = useState(null);
  const [blocked, setBlockedState] = useState(false);
  const [autoSave, setAutoSaveState] = useState(() => getAutoSave(chat.id));
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const openedAt = useRef(Date.now());

  const isSelf = chat.self || isSelfChatId(chat.id, myId);
  const isGroup = !!chat.isGroup || chat.id.startsWith('group_');
  const peerId = isGroup || isSelf ? null : peerOf(chat.id, myId);
  const muted = isMutedNow({ [chat.id]: muteUntil }, chat.id);

  useBackClose(true, () => (view === 'main' ? onClose() : setView('main')));

  useEffect(() => {
    getMutes().then(m => setMuteUntil(isMutedNow(m, chat.id) ? m[chat.id] : null)).catch(() => {});
    if (peerId) getBlocks().then(b => setBlockedState(isBlockedNow(b, peerId))).catch(() => {});
  }, [chat.id, peerId]);

  const flash = (msg, close = true) => { setToast(msg); setTimeout(() => { setToast(null); if (close) onClose(); }, 1300); };
  const run = async (fn, okMsg, kind) => {
    setBusy(true);
    try { await fn(); onChanged?.(kind); flash(okMsg); } catch (e) { flash(e.message || tr('No se pudo conectar con el servidor'), false); }
    setBusy(false);
  };

  const sheet = { width: '100%', maxWidth: 520, maxHeight: '88vh', overflowY: 'auto', background: T.bgSurface, borderRadius: '22px 22px 0 0',
                  padding: '10px 14px calc(var(--sab, 0px) + 18px)', boxShadow: '0 -6px 32px rgba(0,0,0,0.25)', boxSizing: 'border-box' };
  const accent = isDark ? '#9FC0E6' : BRAND;

  const Row = ({ icon, label, sub, onClick, color, right }) => (
    <button onClick={onClick} disabled={busy}
      style={{ display: 'flex', alignItems: 'center', gap: 14, width: '100%', background: 'none', border: 'none', padding: '12px 6px', borderRadius: 12,
               cursor: 'pointer', textAlign: 'left', color: color || T.textPrimary }}>
      <span style={{ width: 38, height: 38, borderRadius: 12, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                     background: color ? `${color}1A` : (isDark ? 'rgba(159,192,230,0.12)' : 'rgba(61,90,128,0.08)') }}>
        <Ico name={icon} color={color || accent} />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 15, fontWeight: 700 }}>{label}</span>
        {sub && <span style={{ display: 'block', fontSize: 12, color: T.textMuted, marginTop: 1 }}>{sub}</span>}
      </span>
      {right}
    </button>
  );

  const Header = ({ title }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '2px 0 8px' }}>
      <button onClick={() => setView('main')} aria-label={tr('Atrás')}
        style={{ width: 36, height: 36, borderRadius: '50%', border: 'none', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Ico name="back" color={T.textPrimary} size={22} />
      </button>
      <p style={{ margin: 0, fontSize: 17, fontWeight: 800, color: T.textPrimary }}>{title}</p>
    </div>
  );

  const Confirm = ({ title, text, label, onYes }) => (
    <>
      <p style={{ margin: '8px 4px 6px', fontSize: 17, fontWeight: 800, color: T.textPrimary }}>{title}</p>
      <p style={{ margin: '0 4px 16px', fontSize: 14, color: T.textSecondary, lineHeight: 1.45 }}>{text}</p>
      <button onClick={onYes} disabled={busy}
        style={{ width: '100%', padding: '14px 0', background: '#ef4444', color: 'white', border: 'none', borderRadius: 14, fontSize: 15, fontWeight: 800, cursor: 'pointer', marginBottom: 8, opacity: busy ? 0.6 : 1 }}>
        {busy ? tr('Un momento…') : label}
      </button>
      <button onClick={() => setView('main')}
        style={{ width: '100%', padding: '13px 0', background: 'none', color: T.textSecondary, border: `1.5px solid ${T.border}`, borderRadius: 14, fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>
        {tr('Cancelar')}
      </button>
    </>
  );

  let body;
  if (view === 'files') body = <><Header title={tr('Archivos del chat')} /><ChatFiles chatId={chat.id} T={T} isDark={isDark} accent={accent} /></>;
  else if (view === 'mute') body = (
    <>
      <Header title={tr('Silenciar avisos')} />
      <p style={{ margin: '0 6px 8px', fontSize: 13, color: T.textSecondary }}>{tr('Los mensajes seguirán llegando, pero sin notificación.')}</p>
      {[[tr('8 horas'), Date.now() + 8 * 3600000], [tr('1 semana'), Date.now() + 7 * 86400000], [tr('Siempre'), 0]].map(([label, until]) => (
        <Row key={label} icon="mute" label={label}
          onClick={() => run(async () => { const r = await setMute(chat.id, until); setMuteUntil(r.until); }, tr('Avisos silenciados'), 'muted')} />
      ))}
    </>
  );
  else if (view === 'save') body = (
    <>
      <Header title={tr('Guardar fotos y vídeos')} />
      <p style={{ margin: '0 6px 8px', fontSize: 13, color: T.textSecondary, lineHeight: 1.4 }}>
        {tr('Las fotos y vídeos que te manden en este chat se guardarán en la galería del móvil (carpeta OldFace) al abrir el chat.')}
      </p>
      {[['always', tr('Siempre')], ['never', tr('Nunca')]].map(([mode, label]) => (
        <Row key={mode} icon="save" label={label}
          right={<span style={{ width: 22, height: 22, borderRadius: '50%', border: `2px solid ${autoSave === mode ? accent : T.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {autoSave === mode && <span style={{ width: 11, height: 11, borderRadius: '50%', background: accent }} />}
          </span>}
          onClick={() => { setAutoSave(chat.id, mode); setAutoSaveState(mode); onChanged?.('autosave'); flash(mode === 'always' ? tr('Se guardarán siempre') : tr('No se guardarán')); }} />
      ))}
    </>
  );
  else if (view === 'share') body = (
    <>
      <Header title={tr('Compartir contacto')} />
      <SharePicker T={T} isDark={isDark} accent={accent} excludeId={chat.id} myId={myId} contactName={chat.name}
        onPick={(to) => run(() => shareContact(to.id, { userId: peerId, name: chat.name }), tr('Contacto enviado a {name}', { name: to.name }), 'shared')} />
    </>
  );
  else if (view === 'clear') body = (
    <Confirm title={tr('¿Vaciar este chat?')} label={tr('Vaciar chat')}
      text={isSelf || isGroup ? tr('Se borrarán todos los mensajes de este chat solo para ti.')
                              : tr('Se borrarán todos los mensajes solo para ti. {name} los seguirá viendo.', { name: chat.name })}
      onYes={() => run(() => clearChat(chat.id), tr('Chat vaciado'), 'cleared')} />
  );
  else if (view === 'block') body = blocked ? (
    <Confirm title={tr('¿Desbloquear a {name}?', { name: chat.name })} label={tr('Desbloquear')}
      text={tr('Podréis volver a escribiros y llamaros.')}
      onYes={() => run(async () => { await setBlocked(peerId, false); setBlockedState(false); }, tr('{name} desbloqueado', { name: chat.name }), 'unblocked')} />
  ) : (
    <Confirm title={tr('¿Bloquear a {name}?', { name: chat.name })} label={tr('Bloquear')}
      text={tr('No podrás escribirle ni llamarle, y no te llegarán sus mensajes ni sus llamadas. No se le avisará.')}
      onYes={() => run(async () => { await setBlocked(peerId, true); setBlockedState(true); }, tr('{name} bloqueado', { name: chat.name }), 'blocked')} />
  );
  else if (view === 'delete') body = (
    <Confirm title={tr('¿Eliminar este chat?')} label={tr('Eliminar chat')}
      text={tr('Se eliminará el chat con todos sus mensajes.')}
      onYes={() => run(() => deleteChat(chat.id), tr('Chat eliminado'), 'deleted')} />
  );
  else body = (
    <>
      <div style={{ width: 40, height: 4, borderRadius: 2, background: T.border, margin: '2px auto 12px' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '0 4px 10px' }}>
        <NeonAvatar name={chat.name} src={chat.avatar || null} size={46} color={ringColorOf(chat.id)} T={T} />
        <div style={{ minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 16, fontWeight: 800, color: T.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {isSelf ? tr('Tú (mensajes para ti)') : chat.name}
          </p>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: blocked ? '#ef4444' : T.textMuted }}>
            {blocked ? tr('Bloqueado') : isGroup ? tr('Grupo') : isSelf ? tr('Notas, archivos y recordatorios') : tr('Chat')}
          </p>
        </div>
      </div>
      {extra.map(([label, fn, icon]) => <Row key={label} icon={icon || 'info'} label={label} onClick={() => { onClose(); fn(); }} />)}
      <Row icon="files" label={tr('Archivos del chat')} sub={tr('Fotos, vídeos, documentos y enlaces')} onClick={() => setView('files')} />
      {!isSelf && (muted
        ? <Row icon="unmute" label={tr('Activar avisos')} onClick={() => run(async () => { await setMute(chat.id, null); setMuteUntil(null); }, tr('Avisos activados'), 'unmuted')} />
        : <Row icon="mute" label={tr('Silenciar avisos')} onClick={() => setView('mute')} />)}
      {!isSelf && <Row icon="save" label={tr('Guardar fotos en el móvil')} sub={autoSave === 'always' ? tr('Siempre') : tr('Nunca')} onClick={() => setView('save')} />}
      {peerId && <Row icon="share" label={tr('Compartir contacto')} sub={tr('Enviar el contacto de {name} a otro chat', { name: chat.name })} onClick={() => setView('share')} />}
      <Row icon="clear" label={tr('Vaciar chat')} color="#ef4444" onClick={() => setView('clear')} />
      {peerId && <Row icon="block" label={blocked ? tr('Desbloquear') : tr('Bloquear')} color="#ef4444" onClick={() => setView('block')} />}
      {showDelete && <Row icon="delete" label={tr('Eliminar chat')} color="#ef4444" onClick={() => setView('delete')} />}
    </>
  );

  return (
    // El toque que termina la pulsación larga no debe cerrar la ventana nada más abrirse
    <div onClick={() => { if (Date.now() - openedAt.current > 450) onClose(); }} style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={sheet}>{body}</div>
      {toast && (
        <div style={{ position: 'fixed', left: '50%', bottom: 'calc(var(--sab, 0px) + 40px)', transform: 'translateX(-50%)', zIndex: 1200, background: 'rgba(17,24,39,0.92)',
                      color: 'white', padding: '10px 18px', borderRadius: 20, fontSize: 14, fontWeight: 700, maxWidth: '86vw', textAlign: 'center' }}>{toast}</div>
      )}
    </div>
  );
}

/** Archivos del chat: pestañas Fotos · Vídeos · Documentos · Enlaces (sin "ver una vez" ni mensajes ocultos) */
function ChatFiles({ chatId, T, isDark, accent }) {
  const myId = useAuthStore(s => s.user?.id);
  const [msgs, setMsgs] = useState(null);
  const [tab, setTab] = useState('image');
  const [open, setOpen] = useState(null);   // { type, src }
  useBackClose(!!open, () => setOpen(null));

  useEffect(() => {
    let alive = true;
    fetch(`${BACKEND}/messages/${encodeURIComponent(chatId)}?userId=${encodeURIComponent(myId)}`)
      .then(r => r.json()).then(d => { if (alive) setMsgs(d.messages || []); }).catch(() => alive && setMsgs([]));
    return () => { alive = false; };
  }, [chatId, myId]);

  const groups = useMemo(() => {
    const list = [...(msgs || [])].filter(m => !m.viewOnce && !m.deleted).reverse();
    return {
      image: list.filter(m => m.type === 'image' && m.url),
      video: list.filter(m => m.type === 'video' && m.url),
      document: list.filter(m => m.type === 'document' && m.url),
      link: list.flatMap(m => (m.type === 'text' || !m.type) ? (String(m.text || '').match(LINK_RE) || []).map((url, i) => ({ id: `${m.id}_${i}`, url, at: m.createdAt })) : []),
    };
  }, [msgs]);

  const tabs = [['image', tr('Fotos')], ['video', tr('Vídeos')], ['document', tr('Documentos')], ['link', tr('Enlaces')]];
  const items = groups[tab];
  const fmtDate = (ms) => (ms ? new Date(ms).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '');

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, overflowX: 'auto', scrollbarWidth: 'none' }}>
        {tabs.map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            style={{ flexShrink: 0, padding: '8px 14px', borderRadius: 20, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 800,
                     background: tab === k ? accent : (isDark ? 'rgba(255,255,255,0.08)' : '#EEF2F7'), color: tab === k ? (isDark ? '#0f1f3a' : 'white') : T.textSecondary }}>
            {label}{msgs ? ` · ${groups[k].length}` : ''}
          </button>
        ))}
      </div>

      {!msgs ? <p style={{ textAlign: 'center', color: T.textMuted, padding: 30 }}>{tr('Cargando…')}</p>
        : !items.length ? <p style={{ textAlign: 'center', color: T.textMuted, padding: '30px 10px', fontSize: 14 }}>{tr('No hay nada aquí todavía')}</p>
        : (tab === 'image' || tab === 'video') ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 4 }}>
            {items.map(m => (
              <button key={m.id} onClick={() => setOpen({ type: tab, src: absUrl(m.url) })}
                style={{ position: 'relative', aspectRatio: '1 / 1', border: 'none', padding: 0, borderRadius: 8, overflow: 'hidden', background: '#000', cursor: 'pointer' }}>
                {tab === 'image'
                  ? <img src={absUrl(m.url)} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <>
                      <video src={`${absUrl(m.url)}#t=0.1`} preload="metadata" muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Ico name="play" color="white" size={26} /></span>
                    </>}
              </button>
            ))}
          </div>
        ) : (
          <div>
            {items.map(m => (
              <a key={m.id} href={tab === 'link' ? m.url : absUrl(m.url)} target="_blank" rel="noreferrer"
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 6px', borderBottom: `1px solid ${T.border}`, textDecoration: 'none' }}>
                <span style={{ width: 36, height: 36, borderRadius: 10, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: isDark ? 'rgba(159,192,230,0.12)' : 'rgba(61,90,128,0.08)' }}>
                  <Ico name={tab === 'link' ? 'link' : 'doc'} color={accent} />
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 14, fontWeight: 700, color: T.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {tab === 'link' ? m.url.replace(/^https?:\/\//, '') : (m.fileName || tr('Documento'))}
                  </span>
                  <span style={{ display: 'block', fontSize: 12, color: T.textMuted }}>{fmtDate(m.createdAt || m.at)}</span>
                </span>
              </a>
            ))}
          </div>
        )}

      {open && (
        <div onClick={() => setOpen(null)} style={{ position: 'fixed', inset: 0, zIndex: 1300, background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {open.type === 'video'
            ? <video src={open.src} controls autoPlay playsInline onClick={e => e.stopPropagation()} style={{ maxWidth: '100%', maxHeight: '100%' }} />
            : <img src={open.src} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />}
          <button onClick={() => setOpen(null)} aria-label={tr('Cerrar')}
            style={{ position: 'absolute', top: 'calc(var(--sat, 0px) + 16px)', right: 16, width: 40, height: 40, borderRadius: '50%', background: 'rgba(0,0,0,0.5)', border: '1.5px solid rgba(255,255,255,0.3)', color: 'white', fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>
      )}
    </div>
  );
}

/** Elegir a qué chat se envía el contacto */
function SharePicker({ T, isDark, accent, excludeId, myId, contactName, onPick }) {
  const chats = useChatStore(s => s.chats);
  const [q, setQ] = useState('');
  const list = (chats || []).filter(c => c.id !== excludeId && !c.self && !isSelfChatId(c.id, myId)
    && (!q.trim() || String(c.name || '').toLowerCase().includes(q.trim().toLowerCase())));
  return (
    <div>
      <p style={{ margin: '0 6px 10px', fontSize: 13, color: T.textSecondary }}>{tr('¿A quién quieres enviar el contacto de {name}?', { name: contactName })}</p>
      <input value={q} onChange={e => setQ(e.target.value)} placeholder={tr('Buscar chat…')}
        style={{ width: '100%', boxSizing: 'border-box', padding: '11px 14px', borderRadius: 14, border: `1.5px solid ${T.border}`, background: isDark ? 'rgba(255,255,255,0.05)' : '#F6F8FB',
                 color: T.textPrimary, fontSize: 15, outline: 'none', marginBottom: 8 }} />
      {!list.length && <p style={{ textAlign: 'center', color: T.textMuted, padding: 20, fontSize: 14 }}>{tr('No hay chats')}</p>}
      {list.slice(0, 60).map(c => (
        <button key={c.id} onClick={() => onPick(c)}
          style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', background: 'none', border: 'none', padding: '9px 6px', cursor: 'pointer', textAlign: 'left' }}>
          <NeonAvatar name={c.name} src={c.avatar || null} size={40} color={ringColorOf(c.id)} T={T} />
          <span style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 700, color: T.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
          <span style={{ fontSize: 13, fontWeight: 800, color: accent }}>{tr('Enviar')}</span>
        </button>
      ))}
    </div>
  );
}
