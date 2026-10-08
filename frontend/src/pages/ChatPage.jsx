/**
 * ChatPage - Chat 1 a 1 (servidor propio: el backend guarda el mensaje y lo entrega
 * al instante por el servidor RTC; si el destinatario no está conectado, llega por push)
 *
 * DISEÑO DE IDs:
 *  - routeChatId (URL param) puede ser:
 *      a) 'user_XXX'               → viene de ContactsPage / tab Contactos
 *      b) 'chat_user_A_user_B'     → viene del tab CHATS (ChatList)
 *  - participantId: el ID del destinatario ('user_XXX')
 *  - msgChatId: clave compuesta usada en backend y store ('chat_user_A_user_B')
 *    Ambos usuarios calculan la misma clave porque [A,B].sort() es determinista.
 */
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore }  from '../store/authStore';
import { useChatStore }  from '../store/chatStore';
import { useCallStore }  from '../store/callStore';
import { useThemeStore, DARK, LIGHT } from '../store/themeStore';
import { useGeolocation } from '../hooks/useGeolocation';
import Avatar from '../components/Avatar.jsx';
import { GroupInfoSheet } from '../components/GroupSheets.jsx';
import { groupIdFromChatId, fetchGroupCall } from '../utils/groupsApi';
import { renderMapSnapshot, createChatMap, messageLatLng } from '../utils/chatMap';
import { startLiveShare, stopLiveShare, isSharingLive, onLiveSharesChange } from '../utils/liveLocation';

const CHAT_BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
const nowTime = () => new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });

/** Sube una foto/vídeo/audio del chat en binario (sin el límite de ~10 MB del base64) → URL permanente o null */
async function uploadChatFile(blob, userId) {
  try {
    const res = await fetch(`${CHAT_BACKEND}/chat/upload?userId=${encodeURIComponent(userId)}`, {
      method: 'POST', headers: { 'Content-Type': (blob.type || 'application/octet-stream').split(';')[0] }, body: blob,
    });
    if (!res.ok) return null;
    const { url } = await res.json();
    return url.startsWith('http') ? url : `${CHAT_BACKEND}${url}`;
  } catch { return null; }
}

/** Abrir un punto en la app de mapas del móvil (Google Maps, Waze…) */
function openInMapsApp(lat, lng) {
  const isNative = !!window.Capacitor?.isNativePlatform?.();
  if (isNative) window.location.href = `geo:${lat},${lng}?q=${lat},${lng}`;
  else window.open(`https://maps.google.com/?q=${lat},${lng}`, '_blank');
}

// Muestra hora exacta de la última conexión
function formatPresenceTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const diff = Date.now() - ts;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const that = new Date(ts); that.setHours(0, 0, 0, 0);
  const days = Math.round((today - that) / 86_400_000);
  const timeStr = d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  if (diff < 60_000) return 'ahora';
  if (days === 0) return `hoy a las ${timeStr}`;
  if (days === 1) return `ayer a las ${timeStr}`;
  return `${d.toLocaleDateString('es', { day: '2-digit', month: '2-digit' })} a las ${timeStr}`;
}

// Emojis frecuentes
const EMOJI_LIST = [
  '😀','😂','🥰','😍','🤩','😎','🥳','🤗','😮','😢','😡','🤔','🙄','😴','🤒','👋',
  '👍','👎','👏','🙏','❤️','🧡','💛','💚','💙','💜','🖤','💔','💯','🔥','✨','🎉',
  '🎊','🎁','🎂','🍕','🍔','🍦','☕','🍺','🥂','🚀','✈️','🏖️','🌙','⭐','🌈','🐶',
  '🐱','🐻','🦁','🐼','🦊','🐸','🐧','🌸','🌺','🍀','🌍','👀','💪','🤝','✌️','🫶',
];

export default function ChatPage() {
  const { chatId: routeChatId } = useParams();
  const { state } = useLocation();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { messages, addMessage, loadMessages, persistMessage, createOrGetChat, markAsRead, updateMessageStatus, deleteMessage, deleteMessages, deleteMessagesScoped, editMessage, setMessageFlags } = useChatStore();
  const { getCurrentPosition, formatLocationMessage } = useGeolocation();

  const { sendVideoCall, sendVoiceCall, startGroupCall } = useCallStore();
  const { isDark } = useThemeStore();
  const T = isDark ? DARK : LIGHT;

  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [replyTo, setReplyTo] = useState(null);
  const [presenceInfo, setPresenceInfo] = useState({ online: false, lastSeen: null });
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [expandedPhoto, setExpandedPhoto] = useState(null);
  const [memberNames, setMemberNames] = useState(state?.chat?.memberNames || {});
  const messagesEndRef = useRef(null);
  const scrollContainerRef = useRef(null);
  const isNearBottomRef = useRef(true);
  const prevMsgCountRef = useRef(0);
  const inputRef = useRef(null);
  const cameraPhotoRef = useRef(null);
  const cameraVideoRef = useRef(null);
  const galleryInputRef = useRef(null);
  const docInputRef = useRef(null);
  const [viewingDoc, setViewingDoc] = useState(null); // { httpUrl|blobUrl, fileName }
  const [showCameraMenu, setShowCameraMenu] = useState(false);   // botón cámara: Foto / Vídeo
  const [showLiveMenu, setShowLiveMenu] = useState(false);       // ubicación en tiempo real: elegir duración
  const [mapViewId, setMapViewId] = useState(null);              // id del mensaje de ubicación abierto en el mapa
  const [selectedIds, setSelectedIds] = useState(null);          // selección múltiple (Set) o null
  const [showForward, setShowForward] = useState(false);
  const [scrollBtns, setScrollBtns] = useState({ top: false, bottom: false });
  const [actionMsg, setActionMsg] = useState(null);         // menú de un mensaje (pulsación larga)
  const [deleteTarget, setDeleteTarget] = useState(null);   // mensajes a eliminar → "para mí" / "para todos"
  const [editingMsg, setEditingMsg] = useState(null);       // mensaje propio que se está editando
  const [flashId, setFlashId] = useState(null);             // mensaje resaltado un momento (al saltar a él)
  const [pinIdx, setPinIdx] = useState(0);
  const [showChatMenu, setShowChatMenu] = useState(false);  // ⋮ de la cabecera
  const [showGroupInfo, setShowGroupInfo] = useState(false);
  const [groupMeta, setGroupMeta] = useState(null);         // { name, avatar } tras cambiarlos en "Info del grupo"
  const [groupCall, setGroupCall] = useState(null);         // llamada de grupo en curso (para "Unirse")
  const [showStarred, setShowStarred] = useState(false);
  const [showBgSheet, setShowBgSheet] = useState(false);
  const [chatBg, setChatBg] = useState(() => readChatBg(routeChatId));
  const [emojiTab, setEmojiTab] = useState('emoji');        // 'emoji' | 'stickers'
  const [stickers, setStickers] = useState(null);
  const [stickerSrc, setStickerSrc] = useState(null);       // foto elegida para crear un sticker
  const stickerInputRef = useRef(null);
  const [docDownloading, setDocDownloading] = useState(false);

  // ── Audio recording ───────────────────────────────────────────────────────
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const recordingTimerRef = useRef(null);
  const cancellingRef = useRef(false);
  const recordingTimeRef = useRef(0); // para leer el tiempo en el closure de onstop

  const MAX_RECORDING_SECS = 600; // 10 minutos

  const chat = state?.chat || { id: routeChatId, name: routeChatId };

  // ── Calcular participantId y msgChatId de forma consistente ───────────────
  const isGroup     = routeChatId.startsWith('group_') || state?.chat?.isGroup === true;
  const isComposite = routeChatId.startsWith('chat_') || isGroup;

  const participantId = useMemo(() => {
    if (!user?.id) return routeChatId;
    if (isGroup) return null;
    if (!isComposite) return routeChatId;
    const withoutChat = routeChatId.replace(/^chat_/, '');
    const parts = withoutChat.split(/_(?=user_)/);
    return parts.find(p => p !== user.id) || parts[1] || parts[0];
  }, [routeChatId, user?.id, isComposite, isGroup]);

  const msgChatId = useMemo(() => {
    if (!user?.id) return routeChatId;
    if (isComposite) return routeChatId;
    return `chat_${[user.id, routeChatId].sort().join('_')}`;
  }, [routeChatId, user?.id, isComposite]);

  const chatMessages = messages[msgChatId] || [];
  const groupId = isGroup ? (state?.chat?.groupId || groupIdFromChatId(msgChatId)) : null;
  const headerName   = groupMeta?.name || chat.name;
  const headerAvatar = groupMeta ? groupMeta.avatar : chat.avatar;

  // Grupo: ¿hay una llamada en curso? → barra "Unirse"
  useEffect(() => {
    if (!groupId || !user?.id) return;
    const check = () => fetchGroupCall(groupId, user.id).then(setGroupCall).catch(() => {});
    check();
    const iv = setInterval(check, 10_000);
    return () => clearInterval(iv);
  }, [groupId, user?.id]);

  // ── Cargar historial + memberNames de grupos ──────────────────────────────
  useEffect(() => {
    if (!user?.id) return;
    loadMessages(msgChatId, user.id, participantId);
    if (!isGroup) createOrGetChat(user.id, participantId, chat.name);
    markAsRead(msgChatId, user.id);

    // Para grupos: cargar memberNames actualizados desde el backend
    if (isGroup) {
      fetch(`${CHAT_BACKEND}/chats?userId=${encodeURIComponent(user.id)}`)
        .then(r => r.ok ? r.json() : { chats: [] })
        .then(d => {
          const groupChat = (d.chats || []).find(c => c.id === msgChatId);
          if (groupChat?.memberNames && Object.keys(groupChat.memberNames).length > 0) {
            setMemberNames(groupChat.memberNames);
          }
        })
        .catch(() => {});
    }
  }, [msgChatId, user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    const interval = setInterval(() => {
      loadMessages(msgChatId, user.id, participantId);
      markAsRead(msgChatId, user.id);
    }, 5000);
    return () => clearInterval(interval);
  }, [msgChatId, user?.id]);

  // ── Presencia ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!user?.id || !participantId || isGroup) return;
    const fetchPresence = () => {
      fetch(`${CHAT_BACKEND}/presence/${encodeURIComponent(participantId)}`)
        .then(r => r.ok ? r.json() : { online: false, lastSeen: null })
        .then(d => setPresenceInfo({ online: d.online, lastSeen: d.lastSeen }))
        .catch(() => {});
    };
    fetchPresence();
    const interval = setInterval(fetchPresence, 15_000);
    return () => clearInterval(interval);
  }, [user?.id, participantId]);

  // Scroll inteligente
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    isNearBottomRef.current = scrollHeight - scrollTop - clientHeight < 120;
    const top = scrollTop > 400, bottom = scrollHeight - scrollTop - clientHeight > 400;
    setScrollBtns(b => (b.top === top && b.bottom === bottom ? b : { top, bottom }));
    // Los botones ↑ ↓ solo se ven mientras se desplaza el chat (y un momento después): así no tapan mensajes
    setScrollBtnsVisible(true);
    clearTimeout(scrollBtnsTimer.current);
    scrollBtnsTimer.current = setTimeout(() => setScrollBtnsVisible(false), 2500);
  }, []);
  const [scrollBtnsVisible, setScrollBtnsVisible] = useState(false);
  const scrollBtnsTimer = useRef(null);
  useEffect(() => () => clearTimeout(scrollBtnsTimer.current), []);
  const scrollToTop = () => scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  // Las fotos cambian de alto al cargar: si se estaba abajo del todo, seguir abajo (antes el último quedaba tapado)
  const onMediaLoad = useCallback(() => {
    if (isNearBottomRef.current) messagesEndRef.current?.scrollIntoView({ block: 'end' });
  }, []);
  // Al abrirse el teclado la pantalla se acorta: si se estaba viendo el final, seguir viendo el último mensaje
  useEffect(() => {
    const onResize = () => { if (isNearBottomRef.current) messagesEndRef.current?.scrollIntoView({ block: 'end' }); };
    const vv = window.visualViewport;
    (vv || window).addEventListener('resize', onResize);
    return () => (vv || window).removeEventListener('resize', onResize);
  }, []);
  /** Ir a un mensaje (fijado, destacado) y resaltarlo un momento */
  const jumpTo = (id) => {
    document.getElementById(`msg-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setFlashId(id);
    setTimeout(() => setFlashId(f => (f === id ? null : f)), 1600);
  };
  const pinned = chatMessages.filter(m => m.pinned && !m.deleted).sort((a, b) => (b.pinnedAt || 0) - (a.pinnedAt || 0));
  const starredMsgs = chatMessages.filter(m => m.starred && !m.deleted);
  // url solo para la miniatura de fotos/vídeos/stickers (las data: grandes no, para no inflar el mensaje)
  const makeReply = (m) => {
    const t = m.type || 'text';
    const url = !m.viewOnce && ['image', 'video', 'sticker'].includes(t) && m.url && (!m.url.startsWith('data:') || m.url.length < 150000) ? m.url : null;
    return { id: m.id, text: m.text, type: t, isMine: m.isMine, url, fileName: m.fileName || null, viewOnce: !!m.viewOnce,
             senderName: m.isMine ? 'Tú' : (memberNames[m.sender] || chat.name || participantId) };
  };
  const canEdit = (m) => m.isMine && (m.type || 'text') === 'text' && !m.deleted && m.status !== 'sending'
                         && (!m.createdAt || Date.now() - m.createdAt < 15 * 60 * 1000);
  const scrollToBottom = () => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });

  // ── Selección múltiple ────────────────────────────────────────────────────
  const toggleSelect = (id) => setSelectedIds(prev => {
    const next = new Set(prev || []);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next.size ? next : null;
  });
  const selectedMsgs = selectedIds ? chatMessages.filter(m => selectedIds.has(m.id)) : [];
  const deleteSelected = () => { if (selectedMsgs.length) setDeleteTarget(selectedMsgs); };
  /** 10. Eliminar para mí (solo desaparece en mi móvil) o para todos (solo los míos: "Se eliminó este mensaje") */
  const doDelete = async (scope) => {
    const msgs = deleteTarget || [];
    setDeleteTarget(null);
    setSelectedIds(null);
    for (const m of msgs) if (m.type === 'live_location' && isSharingLive(m.id)) stopLiveShare(m.id);
    const localOnly = msgs.filter(m => m.status === 'sending' || m.status === 'error');
    if (localOnly.length) deleteMessages(msgChatId, localOnly.map(m => m.id));
    const ids = msgs.filter(m => !localOnly.includes(m)).map(m => m.id);
    if (ids.length) await deleteMessagesScoped(msgChatId, ids, scope, user.id);
  };

  /** Cambiar un mensaje que aún solo está en el móvil (p. ej. la ubicación mientras se obtiene) */
  const patchLocal = (id, patch) => useChatStore.setState(st => ({
    messages: { ...st.messages, [msgChatId]: (st.messages[msgChatId] || []).map(m => (m.id === id ? { ...m, ...patch } : m)) },
  }));
  const removeLocal = (id) => useChatStore.setState(st => ({
    messages: { ...st.messages, [msgChatId]: (st.messages[msgChatId] || []).filter(m => m.id !== id) },
  }));

  useEffect(() => {
    const isInitialLoad = prevMsgCountRef.current === 0;
    const hasNew = chatMessages.length > prevMsgCountRef.current;
    prevMsgCountRef.current = chatMessages.length;
    if (!hasNew) return;
    const lastMsg = chatMessages[chatMessages.length - 1];
    // Mensaje nuevo de la otra persona con el chat abierto → leído ya (doble check azul al instante)
    if (!isInitialLoad && lastMsg && !lastMsg.isMine && user?.id) markAsRead(msgChatId, user.id);
    if (isNearBottomRef.current || lastMsg?.isMine) {
      messagesEndRef.current?.scrollIntoView({ behavior: isInitialLoad ? 'auto' : 'smooth' });
    }
  }, [chatMessages]);

  // Cleanup al desmontar
  useEffect(() => {
    return () => {
      clearInterval(recordingTimerRef.current);
      if (mediaRecorderRef.current?.state === 'recording') {
        cancellingRef.current = true;
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

  // ── Enviar mensaje de texto ───────────────────────────────────────────────
  const sendMessage = useCallback(async () => {
    if (!text.trim() || sending) return;
    if (editingMsg) {
      const m = editingMsg, newText = text.trim();
      setEditingMsg(null);
      setText('');
      if (inputRef.current) inputRef.current.style.height = 'auto';
      if (newText !== m.text) { const err = await editMessage(msgChatId, m.id, user.id, newText); if (err) alert(err); }
      return;
    }
    const currentReply = replyTo;
    const msg = {
      id: `msg_${Date.now()}`,
      text: text.trim(),
      sender: user.id,
      time: new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }),
      status: 'sending',
      isMine: true,
      replyTo: currentReply || null,
    };
    addMessage(msgChatId, msg);
    const sentText = text.trim();
    setText('');
    if (inputRef.current) inputRef.current.style.height = 'auto';
    setReplyTo(null);
    setShowEmojiPicker(false);
    setSending(true);
    try {
      await persistMessage(msgChatId, user.id, sentText, 'text', null, currentReply);
    } catch (err) {
      console.log('Error al enviar:', err.message);
    } finally {
      setSending(false);
    }
  }, [text, sending, replyTo, msgChatId, user, addMessage, persistMessage, editingMsg, editMessage]);

  // ── 11. Stickers ──────────────────────────────────────────────────────────
  const loadStickers = useCallback(() => {
    fetch(`${CHAT_BACKEND}/stickers/${encodeURIComponent(user.id)}`).then(r => r.json())
      .then(d => setStickers(d.stickers || [])).catch(() => setStickers([]));
  }, [user?.id]);
  const sendSticker = async (url) => {
    setShowEmojiPicker(false);
    const id = `stk_${Date.now()}`;
    addMessage(msgChatId, { id, type: 'sticker', text: '[Sticker]', url, sender: user.id, time: nowTime(), status: 'sending', isMine: true });
    const saved = await persistMessage(msgChatId, user.id, '[Sticker]', 'sticker', url);
    if (saved) patchLocal(id, { status: 'sent' });
  };
  const saveSticker = async (blob, andSend) => {
    setStickerSrc(null);
    const url = await uploadChatFile(blob, user.id);
    if (!url) { alert('No se pudo guardar el sticker. Inténtalo de nuevo.'); return; }
    try {
      const r = await fetch(`${CHAT_BACKEND}/stickers`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: user.id, url }) });
      const d = await r.json();
      if (d.stickers) setStickers(d.stickers);
    } catch { /* se ve igual en este envío */ }
    if (andSend) sendSticker(url);
  };
  /** Sticker recibido (o propio) → a mi colección (se ve en todos mis móviles, va en la cuenta) */
  const addToMyStickers = async (url) => {
    try {
      const r = await fetch(`${CHAT_BACKEND}/stickers`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: user.id, url }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setStickers(d.stickers);
      showToast('Sticker añadido a tus stickers');
    } catch { showToast('No se pudo añadir el sticker'); }
  };
  /**
   * Foto, vídeo o sticker → galería del móvil (Imágenes/OldFace o Películas/OldFace).
   * Android 10+: nativo (window.OldFaceMedia, sin permisos). Si no: hoja "Compartir/Guardar en…" o descarga del navegador.
   */
  const saveMediaToPhone = async (msg) => {
    const kind = msg.type === 'video' ? 'video' : msg.type === 'sticker' ? 'sticker' : 'image';
    const what = kind === 'video' ? 'el vídeo' : kind === 'sticker' ? 'el sticker' : 'la foto';
    const url = msg.url && !/^(https?|data|blob):/.test(msg.url) ? new URL(msg.url, CHAT_BACKEND).href : msg.url;
    if (!url) return;
    const dataMime = url.match(/^data:([^;,]+)/)?.[1];
    const ext = (dataMime || '').split('/')[1]?.replace('jpeg', 'jpg').replace('quicktime', 'mov')
             || url.split('?')[0].match(/\.(\w{2,4})$/)?.[1]?.toLowerCase()
             || (kind === 'video' ? 'mp4' : kind === 'sticker' ? 'png' : 'jpg');
    const mime = dataMime || (kind === 'video' ? `video/${ext === 'mov' ? 'quicktime' : ext}` : `image/${ext === 'jpg' ? 'jpeg' : ext}`);
    const fileName = `OldFace_${kind === 'video' ? 'VID' : kind === 'sticker' ? 'STK' : 'IMG'}_${Date.now()}.${ext}`;
    const native = window.OldFaceMedia;
    try {
      if (native && /^https?:/.test(url) && native.download(url, fileName, mime)) {
        showToast(`Descargando ${what}… la verás en la galería (carpeta OldFace)`);
        return;
      }
      const blob = await fetch(url).then(r => { if (!r.ok) throw new Error(); return r.blob(); });
      if (!window.Capacitor?.isNativePlatform?.()) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = fileName; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        return;
      }
      const base64 = await new Promise((resolve, reject) => {
        const rd = new FileReader();
        rd.onload = () => resolve(rd.result.split(',')[1]); rd.onerror = reject; rd.readAsDataURL(blob);
      });
      if (native?.saveBase64(base64, fileName, mime)) { showToast(`Guardado en la galería (carpeta OldFace)`); return; }
      const { Filesystem, Directory } = await import('@capacitor/filesystem');
      const { Share } = await import('@capacitor/share');
      await Filesystem.writeFile({ path: fileName, data: base64, directory: Directory.Cache, recursive: true });
      const { uri } = await Filesystem.getUri({ path: fileName, directory: Directory.Cache });
      await Share.share({ files: [uri], title: fileName, dialogTitle: `Guardar ${what} en el móvil` });
    } catch { showToast(`No se pudo guardar ${what}`); }
  };
  const [toast, setToast] = useState(null);
  const showToast = (t) => { setToast(t); setTimeout(() => setToast(x => (x === t ? null : x)), 2200); };

  const removeSticker = async (url) => {
    if (!window.confirm('¿Quitar este sticker de tu colección?')) return;
    setStickers(list => (list || []).filter(u => u !== url));
    fetch(`${CHAT_BACKEND}/stickers/${encodeURIComponent(user.id)}?url=${encodeURIComponent(url)}`, { method: 'DELETE' }).catch(() => {});
  };

  // ── 11. Fondo del chat ────────────────────────────────────────────────────
  const applyBg = (bg, allChats) => {
    const err = saveChatBg(allChats ? '*' : routeChatId, bg, allChats ? routeChatId : null);
    if (err) { alert(err); return; }
    setChatBg(readChatBg(routeChatId));
    setShowBgSheet(false);
  };

  // ── Enviar ubicación ──────────────────────────────────────────────────────
  const sendLocation = async () => {
    setShowAttachMenu(false);
    const localId = `loc_${Date.now()}`;
    addMessage(msgChatId, { id: localId, type: 'location', text: '📍 Ubicación', url: null, locating: true,
                            sender: user.id, time: nowTime(), status: 'sending', isMine: true });
    try {
      const pos = await getCurrentPosition();
      if (!pos) throw new Error('sin posición');
      const locMsg = formatLocationMessage(pos);
      patchLocal(localId, { text: locMsg.text, url: locMsg.url, locating: false });
      const saved = await persistMessage(msgChatId, user.id, locMsg.text, 'location', locMsg.url);
      if (saved) patchLocal(localId, { status: 'sent' });
    } catch {
      removeLocal(localId);
      alert('No se pudo obtener la ubicación. Comprueba que la ubicación del móvil está activada y que OldFace tiene permiso.');
    }
  };

  // ── Ubicación en tiempo real (15 min · 1 h · 8 h) ─────────────────────────
  const sendLiveLocation = async (minutes) => {
    setShowLiveMenu(false);
    const localId = `live_${Date.now()}`;
    const until = Date.now() + minutes * 60000;
    addMessage(msgChatId, { id: localId, type: 'live_location', text: '📍 Ubicación en tiempo real', url: null, locating: true,
                            sender: user.id, time: nowTime(), status: 'sending', isMine: true });
    try {
      const pos = await getCurrentPosition();
      if (!pos) throw new Error('sin posición');
      const live = { lat: pos.lat, lng: pos.lng, until };
      patchLocal(localId, { locating: false, live: { ...live, updatedAt: Date.now() } });
      const saved = await persistMessage(msgChatId, user.id, '📍 Ubicación en tiempo real', 'live_location',
                                         `https://maps.google.com/?q=${pos.lat},${pos.lng}`, null, null, { live });
      if (!saved?.id) throw new Error('no guardado');
      startLiveShare({ chatId: msgChatId, msgId: saved.id, senderId: user.id, until: saved.live?.until || until });
      loadMessages(msgChatId, user.id, participantId);
    } catch {
      removeLocal(localId);
      alert('No se pudo compartir la ubicación. Comprueba que la ubicación del móvil está activada y que OldFace tiene permiso.');
    }
  };

  const sendContact = async () => {
    setShowAttachMenu(false);
    try {
      const { Contacts } = await import('@capacitor-community/contacts');
      const result = await Contacts.pickContact({ projection: { name: true, phones: true } });
      if (!result?.contact) return;
      const c = result.contact;
      const name  = c.name?.display || c.name?.given || '—';
      const phone = c.phones?.[0]?.number || '—';
      const payload = JSON.stringify({ name, phone });
      addMessage(msgChatId, {
        id: `contact_${Date.now()}`,
        type: 'contact',
        text: `[Contacto: ${name}]`,
        url: payload,
        sender: user.id,
        time: new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }),
        status: 'sent',
        isMine: true,
      });
      persistMessage(msgChatId, user.id, `[Contacto: ${name}]`, 'contact', payload);
    } catch (e) {
      const msg = e?.message || '';
      if (!msg.includes('cancel') && !msg.includes('dismiss')) alert('No se pudo acceder a los contactos');
    }
  };

  // ── Vista previa antes de enviar una foto o un vídeo (con la opción "ver una vez") ──
  const [pendingMedia, setPendingMedia] = useState(null);   // { file, src, isVideo }
  const pickMedia = (file) => {
    if (!file) return;
    setShowAttachMenu(false); setShowCameraMenu(false);
    setPendingMedia({ file, src: URL.createObjectURL(file), isVideo: file.type.startsWith('video/') });
  };
  const closePendingMedia = () => { if (pendingMedia) URL.revokeObjectURL(pendingMedia.src); setPendingMedia(null); };

  // Mientras se ve algo de "ver una vez", el móvil no deja hacer capturas ni grabar la pantalla (Android)
  useEffect(() => {
    if (!expandedPhoto?.viewOnce) return;
    try { window.OldFaceMedia?.setSecure?.(true); } catch { /* APK antiguo */ }
    return () => { try { window.OldFaceMedia?.setSecure?.(false); } catch { /* APK antiguo */ } };
  }, [expandedPhoto]);

  /** Ver una vez (lo recibido): pide la foto/vídeo al servidor (solo la primera vez) y la abre a pantalla completa */
  const openViewOnce = async (m) => {
    if (m.isMine || m.opened) return;
    try {
      const res = await fetch(`${CHAT_BACKEND}/messages/${encodeURIComponent(msgChatId)}/${encodeURIComponent(m.id)}/open`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: user.id }),
      });
      const d = await res.json().catch(() => ({}));
      patchLocal(m.id, { opened: true });
      if (!res.ok) { showToast(d.error || 'No se pudo abrir'); return; }
      const src = /^https?:/.test(d.url) ? d.url : new URL(d.url, CHAT_BACKEND).href;
      setExpandedPhoto({ type: d.type === 'video' ? 'video' : 'image', src, viewOnce: true });
    } catch { showToast('Sin conexión: inténtalo de nuevo'); }
  };

  // ── Enviar imagen o video ─────────────────────────────────────────────────
  const sendMediaFile = async (file, { viewOnce = false } = {}) => {
    if (!file) return;
    setShowAttachMenu(false);
    const isVideo = file.type.startsWith('video/');
    const currentReply = replyTo;

    // Comprimir imagen si es grande
    const processFile = () => new Promise((resolve) => {
      if (isVideo) {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result);
        reader.readAsDataURL(file);
        return;
      }
      // Imagen: redimensionar si >1200px
      const reader = new FileReader();
      reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => {
          const MAX = 1200;
          let w = img.width, h = img.height;
          if (w > MAX || h > MAX) {
            const ratio = Math.min(MAX / w, MAX / h);
            w = Math.round(w * ratio);
            h = Math.round(h * ratio);
          }
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', 0.82));
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
    });

    if (viewOnce) {
      // Ver una vez: siempre se sube al servidor (así se puede borrar cuando se haya visto); quien lo envía no lo ve
      const localId = `media_${Date.now()}`;
      const type = isVideo ? 'video' : 'image', text = isVideo ? '[Video]' : '[Imagen]';
      addMessage(msgChatId, { id: localId, type, text, url: null, viewOnce: true, opened: false, sender: user.id,
                              time: nowTime(), createdAt: Date.now(), status: 'sending', isMine: true, replyTo: currentReply || null });
      setReplyTo(null);
      const blob = isVideo ? file : await fetch(await processFile()).then(r => r.blob());
      const url = await uploadChatFile(blob, user.id);
      if (!url) { updateMessageStatus(msgChatId, localId, 'error'); alert(`No se pudo enviar ${isVideo ? 'el vídeo' : 'la foto'}. Inténtalo de nuevo.`); return; }
      await persistMessage(msgChatId, user.id, text, type, url, currentReply, null, { viewOnce: true });
      return;
    }

    if (isVideo) {
      // Vídeo: se ve al instante desde el móvil y se sube en binario (sin pasar a base64)
      const localId = `media_${Date.now()}`;
      addMessage(msgChatId, { id: localId, type: 'video', text: '[Video]', url: URL.createObjectURL(file), sender: user.id,
                              time: nowTime(), status: 'sending', isMine: true, replyTo: currentReply || null });
      setReplyTo(null);
      const url = await uploadChatFile(file, user.id);
      if (!url) { updateMessageStatus(msgChatId, localId, 'error'); alert('No se pudo enviar el vídeo. Inténtalo de nuevo.'); return; }
      patchLocal(localId, { url });
      await persistMessage(msgChatId, user.id, '[Video]', 'video', url, currentReply);
      return;
    }

    const dataUrl = await processFile();
    const msg = {
      id: `media_${Date.now()}`,
      type: 'image',
      text: '[Imagen]',
      url: dataUrl,
      sender: user.id,
      time: nowTime(),
      status: 'sending',
      isMine: true,
      replyTo: currentReply || null,
    };
    addMessage(msgChatId, msg);
    setReplyTo(null);
    try {
      await persistMessage(msgChatId, user.id, msg.text, msg.type, dataUrl, currentReply);
    } catch { /* ya está en store local */ }
  };

  // ── Grabación de audio ────────────────────────────────────────────────────
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
      const mr = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mr;
      audioChunksRef.current = [];
      cancellingRef.current = false;

      mr.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mr.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        if (!cancellingRef.current) {
          const blob = new Blob(audioChunksRef.current, { type: mimeType });
          sendAudioNote(blob, mimeType);
        }
        cancellingRef.current = false;
      };

      mr.start(100);
      setIsRecording(true);
      setRecordingTime(0);
      recordingTimeRef.current = 0;

      recordingTimerRef.current = setInterval(() => {
        recordingTimeRef.current += 1;
        setRecordingTime(recordingTimeRef.current);
        if (recordingTimeRef.current >= MAX_RECORDING_SECS) {
          stopRecording();
        }
      }, 1000);
    } catch {
      alert('No se puede acceder al micrófono. Verifica los permisos.');
    }
  };

  const stopRecording = () => {
    clearInterval(recordingTimerRef.current);
    setIsRecording(false);
    setRecordingTime(0);
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
  };

  // Cancela sin enviar
  const cancelRecording = () => {
    cancellingRef.current = true;
    clearInterval(recordingTimerRef.current);
    setIsRecording(false);
    setRecordingTime(0);
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
  };

  const sendAudioNote = (blob, mimeType) => {
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result;
      const duration = recordingTimeRef.current || 1;
      const msg = {
        id: `audio_${Date.now()}`,
        type: 'audio',
        text: '[Nota de voz]',
        url: dataUrl,
        duration,
        sender: user.id,
        time: new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }),
        status: 'sending',
        isMine: true,
      };
      addMessage(msgChatId, msg);
      try {
        await persistMessage(msgChatId, user.id, '[Nota de voz]', 'audio', dataUrl, null, null, { duration });
      } catch { }
    };
    reader.readAsDataURL(blob);
  };

  // En el móvil Enter = nueva línea (se envía con el botón); con teclado físico Enter envía y Mayús+Enter salta de línea
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !IS_TOUCH) {
      e.preventDefault();
      sendMessage();
    }
  };
  // Enviar sin que el campo pierda el foco → el teclado no se baja
  const keepKeyboard = (e) => e.preventDefault();
  const sendKeepingKeyboard = (e) => { e.preventDefault(); sendMessage(); inputRef.current?.focus(); };

  const fmtTime = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  const BRAND = '#3D5A80';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', background: T.bgMain, overflow: 'hidden' }}
      onClick={() => { if (showAttachMenu) setShowAttachMenu(false); if (showCameraMenu) setShowCameraMenu(false); if (showChatMenu) setShowChatMenu(false); }}>

      {/* Cabecera del modo selección (varios mensajes) */}
      {selectedIds && (
        <div style={{
          backgroundColor: BRAND, color: 'white', padding: '0 10px 10px', paddingTop: 'var(--sat)',
          display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, minHeight: 56,
        }}>
          <button onClick={() => setSelectedIds(null)} aria-label="Cancelar selección"
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 8, color: 'white', fontSize: 22, lineHeight: 1 }}>✕</button>
          <span style={{ flex: 1, fontWeight: 800, fontSize: 17 }}>{selectedIds.size} {selectedIds.size === 1 ? 'seleccionado' : 'seleccionados'}</span>
          <button onClick={() => setShowForward(true)} aria-label="Reenviar"
            style={{ background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: 20, cursor: 'pointer', padding: '8px 12px', color: 'white', fontWeight: 800, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M15 17l5-5-5-5"/><path d="M4 18v-2a4 4 0 014-4h12"/></svg>
            Reenviar
          </button>
          <button onClick={deleteSelected} aria-label="Eliminar"
            style={{ background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: 20, cursor: 'pointer', padding: '8px 12px', color: 'white', fontWeight: 800, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
            Eliminar
          </button>
        </div>
      )}

      {/* Header */}
      {!selectedIds && <div style={{
        backgroundColor: T.bgSurface,
        borderBottom: `1px solid ${T.border}`,
        padding: '0 14px 10px',
        paddingTop: 'var(--sat)',
        display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
      }}>
        <button onClick={() => navigate(-1)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, marginLeft: -4 }}>
          <svg width="24" height="24" fill="none" stroke={T.textPrimary} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
            <path d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        {/* Avatar con click para ver foto */}
        <div style={{ position: 'relative', cursor: 'pointer' }}
          onClick={() => (isGroup ? setShowGroupInfo(true) : chat.avatar && setExpandedPhoto(chat.avatar))}>
          <Avatar name={headerName} src={headerAvatar || null} size="md" />
          {chat.online && (
            <span style={{ position: 'absolute', bottom: 0, right: 0, width: 12, height: 12, background: '#4ade80', borderRadius: '50%', border: `2px solid ${T.bgSurface}` }} />
          )}
        </div>

        <div style={{ flex: 1, minWidth: 0, cursor: isGroup ? 'pointer' : 'default' }} onClick={() => isGroup && setShowGroupInfo(true)}>
          <p style={{ fontWeight: 700, fontSize: 15, color: T.textPrimary, margin: 0, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{headerName}</p>
          <p style={{ fontSize: 11, color: isGroup ? T.textMuted : (presenceInfo.online ? BRAND : T.textMuted), margin: 0 }}>
            {isGroup
              ? (Object.keys(memberNames).length ? `Grupo · ${Object.keys(memberNames).length} miembros` : 'Grupo')
              : presenceInfo.online
                ? '● en línea'
                : presenceInfo.lastSeen
                  ? `últ. vez ${formatPresenceTime(presenceInfo.lastSeen)}`
                  : 'OldFace'}
          </p>
        </div>

        {isGroup && groupId && <>
          <button onClick={() => startGroupCall(groupId, headerName, 'video')} aria-label="Videollamada de grupo"
            style={{ width: 36, height: 36, borderRadius: '50%', background: T.bgHover, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="18" height="18" fill="none" stroke={T.textSecondary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
              <path d="M15 10l4.553-2.069A1 1 0 0121 8.868v6.264a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </button>
          <button onClick={() => startGroupCall(groupId, headerName, 'voice')} aria-label="Llamada de grupo"
            style={{ width: 36, height: 36, borderRadius: '50%', background: T.bgHover, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="18" height="18" fill="none" stroke={T.textSecondary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
              <path d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 7V5z" />
            </svg>
          </button>
        </>}
        {!isGroup && <>
          <button onClick={() => sendVideoCall(participantId, chat.name)}
            style={{ width: 36, height: 36, borderRadius: '50%', background: T.bgHover, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="18" height="18" fill="none" stroke={T.textSecondary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
              <path d="M15 10l4.553-2.069A1 1 0 0121 8.868v6.264a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </button>
          <button onClick={() => sendVoiceCall(participantId, chat.name)}
            style={{ width: 36, height: 36, borderRadius: '50%', background: T.bgHover, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="18" height="18" fill="none" stroke={T.textSecondary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
              <path d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 7V5z" />
            </svg>
          </button>
        </>}
        <div style={{ position: 'relative' }}>
          <button onClick={(e) => { e.stopPropagation(); setShowChatMenu(v => !v); }} aria-label="Más opciones"
            style={{ width: 36, height: 36, borderRadius: '50%', background: T.bgHover, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill={T.textSecondary}><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
          </button>
          {showChatMenu && (
            <div onClick={e => e.stopPropagation()} style={{ position: 'absolute', right: 0, top: 42, zIndex: 60, background: T.bgSurface, border: `1px solid ${T.border}`,
                                                          borderRadius: 14, boxShadow: '0 6px 24px rgba(0,0,0,0.2)', padding: 6, minWidth: 210 }}>
              {[...(isGroup && groupId ? [['Info del grupo', () => setShowGroupInfo(true)]] : []),
                [`Mensajes destacados${starredMsgs.length ? ` (${starredMsgs.length})` : ''}`, () => setShowStarred(true)],
                ['Fondo del chat', () => setShowBgSheet(true)]].map(([label, fn]) => (
                <button key={label} onClick={() => { setShowChatMenu(false); fn(); }}
                  style={{ display: 'block', width: '100%', background: 'none', border: 'none', padding: '11px 14px', borderRadius: 10, cursor: 'pointer', color: T.textPrimary, fontSize: 14, fontWeight: 600, textAlign: 'left' }}>
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>}

      {/* Grupo: llamada en curso → unirse */}
      {!selectedIds && groupId && groupCall && (
        <button onClick={() => startGroupCall(groupId, headerName, groupCall.callType)}
          style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', background: '#16a34a', border: 'none', padding: '9px 14px',
                   cursor: 'pointer', textAlign: 'left', flexShrink: 0 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/></svg>
          <span style={{ flex: 1, minWidth: 0, color: 'white', fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {groupCall.callType === 'video' ? 'Videollamada' : 'Llamada'} en curso{groupCall.peers?.length ? ` · ${groupCall.peers.length} dentro` : ''}
          </span>
          <span style={{ background: 'white', color: '#16a34a', fontWeight: 900, fontSize: 12, borderRadius: 14, padding: '5px 12px' }}>Unirse</span>
        </button>
      )}

      {/* 12. Mensajes fijados (arriba, para todos). Tocar → ir al mensaje; con varios, va pasando de uno a otro */}
      {!selectedIds && pinned.length > 0 && (() => {
        const m = pinned[pinIdx % pinned.length];
        return (
          <button onClick={() => { jumpTo(m.id); setPinIdx(i => i + 1); }}
            style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', background: T.bgSurface, border: 'none', borderBottom: `1px solid ${T.border}`,
                     padding: '8px 14px', cursor: 'pointer', textAlign: 'left', flexShrink: 0 }}>
            <span style={{ width: 3, alignSelf: 'stretch', background: BRAND, borderRadius: 3 }} />
            <span style={{ fontSize: 16 }}>📌</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 11, fontWeight: 800, color: BRAND }}>
                Mensaje fijado{pinned.length > 1 ? ` · ${(pinIdx % pinned.length) + 1} de ${pinned.length}` : ''}
              </span>
              <span style={{ display: 'block', fontSize: 13, color: T.textSecondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {msgPreview(m)}
              </span>
            </span>
          </button>
        );
      })()}

      {/* Messages */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="scroll-hide"
        style={{ flex: 1, overflowY: 'auto', padding: '12px 12px 22px', display: 'flex', flexDirection: 'column', gap: 6,
                 ...(chatBg ? { background: chatBg.css } : {}) }}
        onClick={() => { setShowEmojiPicker(false); setShowAttachMenu(false); }}
      >
        {chatMessages.map((msg) => (
          <MessageBubble
            key={msg.id}
            msg={msg}
            isDark={isDark}
            T={T}
            isGroup={isGroup}
            memberNames={memberNames}
            onDelete={(m) => { if (m.type === 'live_location' && isSharingLive(m.id)) stopLiveShare(m.id); deleteMessage(msgChatId, m.id); }}
            selectionMode={!!selectedIds}
            selected={!!selectedIds?.has(msg.id)}
            onToggleSelect={() => toggleSelect(msg.id)}
            onOpenMap={(m) => setMapViewId(m.id)}
            onLongPress={(m) => setActionMsg(m)}
            onMediaLoad={onMediaLoad}
            flash={flashId === msg.id}
            onJumpReply={jumpTo}
            onOpenViewOnce={openViewOnce}
            onExpandPhoto={(src) => setExpandedPhoto(src)}
            onViewDoc={(docMsg) => {
              const docName = docMsg.fileName
                || docMsg.text?.match(/^\[Archivo: (.+)\]$/)?.[1]
                || 'Archivo';
              const rawUrl = docMsg.url || '';
              // Documentos nuevos: URL HTTP real → visor directo
              if (rawUrl.startsWith('http') || rawUrl.startsWith('/files/')) {
                const httpUrl = rawUrl.startsWith('http')
                  ? rawUrl
                  : `${CHAT_BACKEND}${rawUrl}`;
                setViewingDoc({ httpUrl, fileName: docName });
                return;
              }
              // Legado: base64 → convertir a blobUrl para el visor
              let blobUrl = rawUrl;
              try {
                const arr  = rawUrl.split(',');
                const mime = arr[0].match(/:(.*?);/)[1];
                const bstr = atob(arr[1]);
                let n = bstr.length;
                const u8 = new Uint8Array(n);
                while (n--) u8[n] = bstr.charCodeAt(n);
                blobUrl = URL.createObjectURL(new Blob([u8], { type: mime }));
              } catch {}
              setViewingDoc({ blobUrl, dataUrl: rawUrl, fileName: docName });
            }}
          />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Ir al principio / al último mensaje */}
      {(scrollBtns.top || scrollBtns.bottom) && (
        <div style={{ position: 'relative', height: 0, zIndex: 20 }}>
          <div style={{ position: 'absolute', right: 10, bottom: 24, display: 'flex', flexDirection: 'column', gap: 8,
                        opacity: scrollBtnsVisible ? 0.92 : 0, transform: scrollBtnsVisible ? 'none' : 'translateX(12px)',
                        transition: 'opacity 0.3s, transform 0.3s', pointerEvents: scrollBtnsVisible ? 'auto' : 'none' }}>
            {scrollBtns.top && (
              <button onClick={scrollToTop} aria-label="Ir al principio del chat" title="Ir al principio del chat"
                style={{ width: 36, height: 36, borderRadius: '50%', background: T.bgSurface, border: `1px solid ${T.border}`, boxShadow: '0 2px 10px rgba(0,0,0,0.2)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={BRAND} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 4h14"/><path d="M12 20V9"/><path d="M6 14l6-6 6 6"/></svg>
              </button>
            )}
            {scrollBtns.bottom && (
              <button onClick={scrollToBottom} aria-label="Ir al último mensaje" title="Ir al último mensaje"
                style={{ width: 36, height: 36, borderRadius: '50%', background: T.bgSurface, border: `1px solid ${T.border}`, boxShadow: '0 2px 10px rgba(0,0,0,0.2)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={BRAND} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 20h14"/><path d="M12 4v11"/><path d="M6 10l6 6 6-6"/></svg>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Barra de edición */}
      {editingMsg && (
        <div style={{ background: isDark ? '#0a1628' : '#f0f4ff', borderTop: `2px solid ${BRAND}`, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <span style={{ fontSize: 18 }}>✏️</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 11, fontWeight: 800, color: BRAND, margin: '0 0 2px' }}>Editando mensaje</p>
            <p style={{ fontSize: 12, color: T.textSecondary, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{editingMsg.text}</p>
          </div>
          <button onClick={() => { setEditingMsg(null); setText(''); }} aria-label="Cancelar edición" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={T.textMuted} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
      )}

      {/* Barra de respuesta */}
      {replyTo && (
        <div style={{
          background: T.bgSurface, borderTop: `1px solid ${T.border}`, flexShrink: 0,
          padding: '8px 10px 2px', boxShadow: '0 -4px 14px rgba(0,0,0,0.06)',
        }}>
          <p style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '0 4px 6px', fontSize: 12, fontWeight: 700, color: T.textMuted }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-2"/></svg>
            Respondiendo a {replyTo.isMine ? 'tu mensaje' : replyTo.senderName}
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <ReplyQuote reply={replyTo} where="bar" isDark={isDark} onClick={replyTo.id ? () => jumpTo(replyTo.id) : undefined} />
            <button onClick={() => setReplyTo(null)} aria-label="Cancelar respuesta"
              style={{ width: 32, height: 32, borderRadius: '50%', background: T.bgHover, border: 'none', cursor: 'pointer', flexShrink: 0,
                       display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={T.textSecondary} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6L6 18M6 6l12 12"/>
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Emoji picker */}
      {showEmojiPicker && (
        <div style={{ background: T.bgSurface, borderTop: `1px solid ${T.border}`, display: 'flex', gap: 4, padding: '6px 10px 0', flexShrink: 0 }}>
          {[['emoji', '😊 Emojis'], ['stickers', '🌟 Stickers']].map(([k, label]) => (
            <button key={k} onClick={() => { setEmojiTab(k); if (k === 'stickers' && !stickers) loadStickers(); }}
              style={{ background: emojiTab === k ? BRAND : T.bgHover, color: emojiTab === k ? 'white' : T.textPrimary, border: 'none', borderRadius: 14, padding: '6px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
              {label}
            </button>
          ))}
        </div>
      )}
      {showEmojiPicker && emojiTab === 'stickers' && (
        <div style={{ background: T.bgSurface, padding: '10px 12px 8px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))', gap: 8, maxHeight: 230, overflowY: 'auto', flexShrink: 0 }}>
          <button onClick={() => stickerInputRef.current?.click()}
            style={{ aspectRatio: '1', borderRadius: 16, border: `2px dashed ${BRAND}`, background: 'none', color: BRAND, fontWeight: 800, fontSize: 12, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
            <span style={{ fontSize: 24, lineHeight: 1 }}>＋</span>Crear
          </button>
          {stickers === null && <span style={{ color: T.textMuted, fontSize: 12, alignSelf: 'center' }}>Cargando…</span>}
          {(stickers || []).map(url => (
            <button key={url} onClick={() => sendSticker(url)} onContextMenu={(e) => { e.preventDefault(); removeSticker(url); }}
              title="Toca para enviar · mantén pulsado para quitar"
              style={{ aspectRatio: '1', borderRadius: 12, border: 'none', background: 'none', padding: 0, cursor: 'pointer' }}>
              <img src={url} alt="Sticker" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
            </button>
          ))}
          <input ref={stickerInputRef} type="file" accept="image/*" style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (!f) return; const rd = new FileReader(); rd.onload = () => setStickerSrc(rd.result); rd.readAsDataURL(f); }} />
        </div>
      )}
      {showEmojiPicker && emojiTab === 'emoji' && (
        <div style={{
          background: T.bgSurface,
          padding: '10px 12px 6px',
          display: 'flex', flexWrap: 'wrap', gap: 2,
          maxHeight: 200, overflowY: 'auto',
          flexShrink: 0,
        }}>
          {EMOJI_LIST.map((em) => (
            <button key={em} onClick={() => setText(t => t + em)}
              style={{ fontSize: 22, background: 'none', border: 'none', cursor: 'pointer', padding: '3px 4px', borderRadius: 6, lineHeight: 1 }}>
              {em}
            </button>
          ))}
        </div>
      )}

      {/* Input bar */}
      <div style={{
        background: T.bgSurface,
        borderTop: `1px solid ${T.border}`,
        padding: '10px 12px',
        paddingBottom: 'max(10px, env(safe-area-inset-bottom, 10px))',
        display: 'flex', alignItems: 'flex-end', gap: 6, flexShrink: 0,
        position: 'relative',
      }}>

        {/* Menú adjuntos */}
        {showAttachMenu && (
          <div style={{
            position: 'absolute', bottom: '100%', left: 12, marginBottom: 8,
            background: T.bgSurface,
            border: `1px solid ${T.border}`,
            borderRadius: 16, padding: '8px 4px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.18)',
            display: 'flex', flexDirection: 'column', gap: 2,
            zIndex: 50, minWidth: 180,
          }} onClick={e => e.stopPropagation()}>
            {/* Foto con cámara */}
            <button onClick={() => { cameraPhotoRef.current?.click(); setShowAttachMenu(false); }}
              style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'none', border: 'none', cursor: 'pointer', padding: '10px 14px', borderRadius: 12, color: T.textPrimary, fontSize: 14, fontWeight: 600, textAlign: 'left' }}>
              <span style={{ width: 36, height: 36, borderRadius: '50%', background: '#f59e0b', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/>
                  <circle cx="12" cy="13" r="4"/>
                </svg>
              </span>
              Foto
            </button>
            {/* Video con cámara */}
            <button onClick={() => { cameraVideoRef.current?.click(); setShowAttachMenu(false); }}
              style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'none', border: 'none', cursor: 'pointer', padding: '10px 14px', borderRadius: 12, color: T.textPrimary, fontSize: 14, fontWeight: 600, textAlign: 'left' }}>
              <span style={{ width: 36, height: 36, borderRadius: '50%', background: '#dc2626', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 10l4.553-2.069A1 1 0 0121 8.868v6.264a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/>
                </svg>
              </span>
              Video
            </button>
            {/* Galería */}
            <button onClick={() => { galleryInputRef.current?.click(); setShowAttachMenu(false); }}
              style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'none', border: 'none', cursor: 'pointer', padding: '10px 14px', borderRadius: 12, color: T.textPrimary, fontSize: 14, fontWeight: 600, textAlign: 'left' }}>
              <span style={{ width: 36, height: 36, borderRadius: '50%', background: '#8b5cf6', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>
                </svg>
              </span>
              Galería
            </button>
            {/* Documento */}
            <button onClick={() => { docInputRef.current?.click(); setShowAttachMenu(false); }}
              style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'none', border: 'none', cursor: 'pointer', padding: '10px 14px', borderRadius: 12, color: T.textPrimary, fontSize: 14, fontWeight: 600, textAlign: 'left' }}>
              <span style={{ width: 36, height: 36, borderRadius: '50%', background: '#0284c7', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>
                </svg>
              </span>
              Documento
            </button>
            {/* Ubicación */}
            <button onClick={sendLocation}
              style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'none', border: 'none', cursor: 'pointer', padding: '10px 14px', borderRadius: 12, color: T.textPrimary, fontSize: 14, fontWeight: 600, textAlign: 'left' }}>
              <span style={{ width: 36, height: 36, borderRadius: '50%', background: '#16a34a', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg width="18" height="18" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                  <path d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </span>
              Ubicación
            </button>
            {/* Ubicación en tiempo real */}
            <button onClick={() => { setShowAttachMenu(false); setShowLiveMenu(true); }}
              style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'none', border: 'none', cursor: 'pointer', padding: '10px 14px', borderRadius: 12, color: T.textPrimary, fontSize: 14, fontWeight: 600, textAlign: 'left' }}>
              <span style={{ width: 36, height: 36, borderRadius: '50%', background: '#0d9488', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg width="18" height="18" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                  <circle cx="12" cy="11" r="3"/><path d="M6.3 16.7a8 8 0 1111.4 0"/><path d="M3.5 19.5a12 12 0 1117 0"/>
                </svg>
              </span>
              Ubicación en tiempo real
            </button>
            {/* Contacto */}
            <button onClick={sendContact}
              style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'none', border: 'none', cursor: 'pointer', padding: '10px 14px', borderRadius: 12, color: T.textPrimary, fontSize: 14, fontWeight: 600, textAlign: 'left' }}>
              <span style={{ width: 36, height: 36, borderRadius: '50%', background: '#e11d48', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg width="18" height="18" fill="white" viewBox="0 0 24 24">
                  <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/>
                </svg>
              </span>
              Contacto
            </button>
          </div>
        )}

        {/* Inputs ocultos */}
        <input ref={cameraPhotoRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
          onChange={e => { pickMedia(e.target.files?.[0]); e.target.value = ''; }} />
        <input ref={cameraVideoRef} type="file" accept="video/*" capture="environment" style={{ display: 'none' }}
          onChange={e => { pickMedia(e.target.files?.[0]); e.target.value = ''; }} />
        <input ref={galleryInputRef} type="file" accept="image/*,video/*" style={{ display: 'none' }}
          onChange={e => { pickMedia(e.target.files?.[0]); e.target.value = ''; }} />
        <input ref={docInputRef} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.zip,.rar" style={{ display: 'none' }}
          onChange={e => {
            const file = e.target.files?.[0];
            if (file) {
              const reader = new FileReader();
              reader.onload = async () => {
                const dataUrl    = reader.result;
                const currentReply = replyTo;
                const docText    = `[Archivo: ${file.name}]`;
                const localId    = `doc_${Date.now()}`;
                const msg = {
                  id:       localId,
                  type:     'document',
                  text:     docText,
                  url:      dataUrl,   // base64 local para mostrar inmediatamente
                  fileName: file.name,
                  sender:   user.id,
                  time:     new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }),
                  status:   'sending',
                  isMine:   true,
                  replyTo:  currentReply || null,
                };
                addMessage(msgChatId, msg);
                setReplyTo(null);
                setShowAttachMenu(false);
                try {
                  // 1. Subir el archivo al servidor → obtener URL HTTP permanente
                  let fileUrl = dataUrl; // fallback si el upload falla
                  try {
                    const upRes = await fetch(`${CHAT_BACKEND}/upload-file`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ data: dataUrl, fileName: file.name }),
                    });
                    if (upRes.ok) {
                      const upData = await upRes.json();
                      fileUrl = upData.url.startsWith('http')
                        ? upData.url
                        : `${CHAT_BACKEND}${upData.url}`;
                    }
                  } catch (upErr) {
                    console.warn('[Doc] upload error:', upErr?.message);
                  }
                  // 2. Persistir en backend con URL HTTP (no base64)
                  // (el backend lo entrega al destinatario en tiempo real)
                  await persistMessage(msgChatId, user.id, docText, 'document', fileUrl, currentReply, file.name);
                  // 3. Marcar como enviado
                  updateMessageStatus(msgChatId, localId, 'sent');
                } catch (err) {
                  console.warn('[Doc] send error:', err?.message);
                  updateMessageStatus(msgChatId, localId, 'error');
                }
              };
              reader.readAsDataURL(file);
            }
            e.target.value = '';
          }} />

        {/* Botón adjuntos (izquierda, solo cuando no graba) */}
        {!isRecording && (
          <button onClick={(e) => { e.stopPropagation(); setShowAttachMenu(v => !v); setShowEmojiPicker(false); }}
            style={{ width: 40, height: 40, borderRadius: '50%', background: showAttachMenu ? BRAND : T.bgHover, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={showAttachMenu ? 'white' : T.textSecondary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/>
            </svg>
          </button>
        )}

        {/* Botón cámara — elegir hacer una foto o grabar un vídeo */}
        {showCameraMenu && (
          <div style={{
            position: 'absolute', bottom: '100%', left: 58, marginBottom: 8, zIndex: 50,
            background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: 16, padding: 6,
            boxShadow: '0 4px 20px rgba(0,0,0,0.18)', display: 'flex', gap: 6,
          }} onClick={e => e.stopPropagation()}>
            {[['Foto', '#f59e0b', cameraPhotoRef, 'M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z'],
              ['Vídeo', '#dc2626', cameraVideoRef, 'M15 10l4.553-2.069A1 1 0 0121 8.868v6.264a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z']]
              .map(([label, color, ref, d]) => (
              <button key={label} onClick={() => { setShowCameraMenu(false); ref.current?.click(); }}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, background: 'none', border: 'none', cursor: 'pointer', padding: '8px 14px', borderRadius: 12, color: T.textPrimary, fontSize: 13, fontWeight: 700 }}>
                <span style={{ width: 40, height: 40, borderRadius: '50%', background: color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d}/>{label === 'Foto' && <circle cx="12" cy="13" r="4"/>}</svg>
                </span>
                {label}
              </button>
            ))}
          </div>
        )}
        {!isRecording && (
          <button onClick={(e) => { e.stopPropagation(); setShowCameraMenu(v => !v); setShowAttachMenu(false); setShowEmojiPicker(false); }}
            aria-label="Cámara: foto o vídeo"
            style={{ width: 40, height: 40, borderRadius: '50%', background: T.bgHover, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={T.textSecondary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/>
              <circle cx="12" cy="13" r="4"/>
            </svg>
          </button>
        )}

        {/* Centro: input texto o grabando */}
        {isRecording ? (
          <div style={{
            flex: 1, background: T.bgInput, borderRadius: 22, padding: '10px 16px',
            height: 42, display: 'flex', alignItems: 'center', gap: 10,
            border: `1.5px solid #ef4444`,
          }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#ef4444', animation: 'recBlink 1s ease infinite', flexShrink: 0 }} />
            <span style={{ fontSize: 14, color: '#ef4444', fontWeight: 700, flex: 1 }}>
              Grabando {fmtTime(recordingTime)}
            </span>
            <span style={{ fontSize: 11, color: T.textMuted }}>{fmtTime(MAX_RECORDING_SECS - recordingTime)}</span>
            <style>{`@keyframes recBlink { 0%,100%{opacity:1} 50%{opacity:0.2} }`}</style>
          </div>
        ) : (
          <div style={{ flex: 1, background: T.bgInput, borderRadius: 22, padding: '6px 12px 6px 14px', minHeight: 42, display: 'flex', alignItems: 'flex-end', gap: 6, border: `1px solid ${T.border}` }}>
            {/* Icono emoji — toggle picker / teclado */}
            <button onClick={(e) => { e.stopPropagation(); setShowEmojiPicker(v => !v); setShowAttachMenu(false); }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 20, lineHeight: 1, flexShrink: 0, opacity: 0.7, marginBottom: 2 }}>
              {showEmojiPicker ? '⌨️' : '😊'}
            </button>
            <textarea
              ref={inputRef}
              value={text}
              onChange={e => {
                setText(e.target.value);
                const ta = e.target;
                ta.style.height = 'auto';
                ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
              }}
              onKeyDown={handleKeyDown}
              onFocus={() => setShowEmojiPicker(false)}
              placeholder="Mensaje..."
              enterKeyHint={IS_TOUCH ? 'enter' : 'send'}
              rows={1}
              style={{ width: '100%', resize: 'none', outline: 'none', fontSize: 14, fontWeight: 500, color: T.textPrimary, background: 'transparent', lineHeight: 1.5, overflowY: 'auto', overflowX: 'hidden', padding: '3px 0' }}
            />
          </div>
        )}

        {/* Botón derecho: cancelar / enviar / mic / stop */}
        {isRecording ? (
          <>
            {/* Cancelar grabación (papelera) */}
            <button onClick={cancelRecording}
              style={{ width: 40, height: 40, borderRadius: '50%', background: isDark ? 'rgba(239,68,68,0.15)' : '#fee2e2', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>
              </svg>
            </button>
            {/* Enviar nota de voz */}
            <button onClick={stopRecording}
              style={{ width: 40, height: 40, borderRadius: '50%', background: '#ef4444', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width="16" height="16" fill="white" viewBox="0 0 24 24">
                <rect x="5" y="5" width="14" height="14" rx="2" />
              </svg>
            </button>
          </>
        ) : text.trim() ? (
          <button onMouseDown={keepKeyboard} onTouchEnd={sendKeepingKeyboard} onClick={sendKeepingKeyboard} disabled={sending} aria-label="Enviar"
            style={{ width: 40, height: 40, borderRadius: '50%', background: BRAND, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, opacity: sending ? 0.7 : 1 }}>
            <svg width="18" height="18" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" style={{ transform: 'translateX(1px)' }}>
              <path d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        ) : (
          <button onClick={startRecording}
            style={{ width: 40, height: 40, borderRadius: '50%', background: BRAND, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="18" height="18" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
              <path d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
          </button>
        )}
      </div>

      {/* Menú de un mensaje (pulsación larga) */}
      {actionMsg && (
        <MessageActions T={T} msg={actionMsg} canEdit={canEdit(actionMsg)} onClose={() => setActionMsg(null)}
          onReply={() => setReplyTo(makeReply(actionMsg))}
          onCopy={() => { try { navigator.clipboard.writeText(actionMsg.text || ''); } catch { /* sin portapapeles */ } }}
          onEdit={() => { setEditingMsg(actionMsg); setReplyTo(null); setText(actionMsg.text || ''); setTimeout(() => inputRef.current?.focus(), 50); }}
          onPin={() => setMessageFlags(msgChatId, actionMsg.id, user.id, { pinned: !actionMsg.pinned })}
          onStar={() => setMessageFlags(msgChatId, actionMsg.id, user.id, { starred: !actionMsg.starred })}
          onForward={() => { setSelectedIds(new Set([actionMsg.id])); setShowForward(true); }}
          onSelect={() => toggleSelect(actionMsg.id)}
          onDelete={() => setDeleteTarget([actionMsg])}
          onAddSticker={() => addToMyStickers(actionMsg.url)}
          onSaveMedia={() => saveMediaToPhone(actionMsg)} />
      )}

      {toast && (
        <div style={{ position: 'fixed', left: '50%', bottom: 'calc(90px + env(safe-area-inset-bottom, 0px))', transform: 'translateX(-50%)', zIndex: 1100,
                      background: '#293241', color: 'white', padding: '10px 18px', borderRadius: 20, fontSize: 14, fontWeight: 600,
                      boxShadow: '0 4px 16px rgba(0,0,0,0.25)', maxWidth: '86vw', textAlign: 'center' }}>{toast}</div>
      )}

      {/* Eliminar: para mí / para todos */}
      {deleteTarget && (
        <DeleteDialog T={T} msgs={deleteTarget} onCancel={() => setDeleteTarget(null)} onDelete={doDelete} />
      )}

      {/* Mensajes destacados */}
      {showStarred && (
        <StarredSheet T={T} msgs={starredMsgs} onClose={() => setShowStarred(false)}
          onPick={(m) => { setShowStarred(false); setTimeout(() => jumpTo(m.id), 50); }}
          onUnstar={(m) => setMessageFlags(msgChatId, m.id, user.id, { starred: false })} />
      )}

      {/* Fondo del chat */}
      {showBgSheet && <BackgroundSheet T={T} current={chatBg} onClose={() => setShowBgSheet(false)} onApply={applyBg} />}
      {showGroupInfo && groupId && (
        <GroupInfoSheet user={user} T={T} isDark={isDark} groupId={groupId}
          onClose={() => setShowGroupInfo(false)}
          onChanged={(g) => { setGroupMeta({ name: g.name, avatar: g.avatar || null }); setMemberNames(g.memberNames || {}); }}
          onLeft={() => { setShowGroupInfo(false); navigate('/', { replace: true }); }} />
      )}

      {/* Crear sticker a partir de una foto */}
      {stickerSrc && <StickerEditor T={T} src={stickerSrc} onCancel={() => setStickerSrc(null)} onSave={saveSticker} />}

      {/* Ubicación en tiempo real: ¿durante cuánto tiempo? */}
      {showLiveMenu && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 900, background: 'rgba(10,13,37,0.55)', display: 'flex', alignItems: 'flex-end' }}
          onClick={() => setShowLiveMenu(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: T.bgSurface, width: '100%', borderRadius: '22px 22px 0 0', padding: '20px 18px', paddingBottom: 'max(18px, env(safe-area-inset-bottom, 18px))' }}>
            <p style={{ fontWeight: 900, fontSize: 18, color: T.textPrimary, margin: 0 }}>📍 Compartir ubicación en tiempo real</p>
            <p style={{ fontSize: 13, color: T.textMuted, margin: '4px 0 16px' }}>
              {isGroup ? 'El grupo verá' : `${chat.name || 'Esta persona'} verá`} cómo te mueves en el mapa. Puedes dejar de compartirla cuando quieras.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              {[[15, '15 min'], [60, '1 hora'], [480, '8 horas']].map(([min, label]) => (
                <button key={min} onClick={() => sendLiveLocation(min)}
                  style={{ flex: 1, background: BRAND, color: 'white', border: 'none', borderRadius: 14, padding: '14px 0', fontWeight: 800, fontSize: 15, cursor: 'pointer' }}>
                  {label}
                </button>
              ))}
            </div>
            <button onClick={() => setShowLiveMenu(false)}
              style={{ width: '100%', marginTop: 10, background: 'none', border: 'none', color: T.textMuted, fontWeight: 700, fontSize: 14, padding: 10, cursor: 'pointer' }}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Mapa a pantalla completa de una ubicación (fija o en tiempo real) */}
      {mapViewId && (() => {
        const m = chatMessages.find(x => x.id === mapViewId);
        if (!m) return null;
        return <ChatMapView msg={m} onClose={() => setMapViewId(null)} />;
      })()}

      {/* Reenviar mensajes seleccionados a uno o varios chats */}
      {showForward && selectedMsgs.length > 0 && (
        <ForwardSheet T={T} user={user} currentChatId={msgChatId} msgs={selectedMsgs}
          onClose={() => setShowForward(false)} onDone={() => { setShowForward(false); setSelectedIds(null); }} />
      )}

      {/* Visor fullscreen: documento */}
      {viewingDoc && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: '#111', display: 'flex', flexDirection: 'column' }}>
          {/* Cabecera */}
          <div style={{
            background: '#3D5A80', padding: '0 14px 12px',
            paddingTop: 'max(12px, env(safe-area-inset-top, 12px))',
            display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
          }}>
            <button
              onClick={() => {
                if (!viewingDoc.httpUrl && viewingDoc.blobUrl?.startsWith('blob:')) {
                  URL.revokeObjectURL(viewingDoc.blobUrl);
                }
                setViewingDoc(null);
              }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, flexShrink: 0 }}>
              <svg width="24" height="24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                <path d="M15 19l-7-7 7-7"/>
              </svg>
            </button>
            <span style={{ flex: 1, color: 'white', fontWeight: 700, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {viewingDoc.fileName}
            </span>
          </div>

          {/* Cuerpo — icono + nombre + botones Abrir y Guardar */}
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 24, padding: 32,
          }}>
            {/* Icono grande del archivo */}
            <div style={{
              width: 96, height: 96, borderRadius: 24,
              background: 'rgba(255,255,255,0.1)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
              </svg>
            </div>

            {/* Nombre del archivo */}
            <p style={{ color: 'white', fontWeight: 700, fontSize: 16, textAlign: 'center', margin: 0, wordBreak: 'break-word' }}>
              {viewingDoc.fileName}
            </p>

            {/* Botón: Descargar — guarda en Descargas o muestra selector de ubicación */}
            <button
              disabled={docDownloading}
              onClick={async () => {
                const { httpUrl, blobUrl, dataUrl, fileName } = viewingDoc;
                setDocDownloading(true);
                try {
                  // ── 1. Obtener blob ─────────────────────────────────────────
                  let blob;
                  if (httpUrl) {
                    const res = await fetch(httpUrl);
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    blob = await res.blob();
                  } else if (blobUrl?.startsWith('blob:')) {
                    blob = await fetch(blobUrl).then(r => r.blob());
                  } else if (dataUrl) {
                    const arr  = dataUrl.split(',');
                    const mime = arr[0].match(/:(.*?);/)[1];
                    const bstr = atob(arr[1]);
                    const u8   = new Uint8Array(bstr.length);
                    for (let i = 0; i < bstr.length; i++) u8[i] = bstr.charCodeAt(i);
                    blob = new Blob([u8], { type: mime });
                  }
                  if (!blob) throw new Error('Sin datos');

                  // ── 2. Blob → base64 ────────────────────────────────────────
                  const base64 = await new Promise((resolve, reject) => {
                    const rd = new FileReader();
                    rd.onload  = () => resolve(rd.result.split(',')[1]);
                    rd.onerror = reject;
                    rd.readAsDataURL(blob);
                  });

                  const { Filesystem, Directory } = await import('@capacitor/filesystem');
                  const { Share }                 = await import('@capacitor/share');

                  // ── 3a. Intentar guardar directamente en carpeta Descargas ──
                  //   ExternalStorage = /sdcard/  →  path "Download/nombre.pdf"
                  //   Funciona en Android ≤ 10 (+ requestLegacyExternalStorage)
                  let savedOk = false;
                  try {
                    await Filesystem.requestPermissions();
                    await Filesystem.writeFile({
                      path:      `Download/${fileName}`,
                      data:      base64,
                      directory: Directory.ExternalStorage,
                      recursive: true,
                    });
                    savedOk = true;
                  } catch { /* Android 11+ no permite escritura directa → usar share */ }

                  if (savedOk) {
                    // Archivo guardado → abrir con la app asociada (PDF viewer, etc.)
                    const { uri } = await Filesystem.getUri({
                      path:      `Download/${fileName}`,
                      directory: Directory.ExternalStorage,
                    });
                    // Pequeño alert nativo de confirmación
                    await Share.share({
                      files:       [uri],
                      title:       `${fileName} guardado`,
                      dialogTitle: `Abrir ${fileName}`,
                    });
                    return;
                  }

                  // ── 3b. Fallback Android 11+: guardar en caché + share sheet ─
                  //   files: [uri] → muestra "Mis Archivos", "Descargas", Drive…
                  //   El usuario elige dónde guardarlo en el dispositivo.
                  await Filesystem.writeFile({
                    path:      fileName,
                    data:      base64,
                    directory: Directory.Cache,
                    recursive: true,
                  });
                  const { uri } = await Filesystem.getUri({
                    path:      fileName,
                    directory: Directory.Cache,
                  });
                  await Share.share({
                    files:       [uri],           // ← files[], no url — muestra apps de archivo
                    title:       fileName,
                    dialogTitle: 'Guardar en el dispositivo',
                  });

                } catch (err) {
                  console.warn('[Doc] download error:', err?.message);
                  if (httpUrl) window.open(httpUrl, '_blank');
                } finally {
                  setDocDownloading(false);
                }
              }}
              style={{
                width: '100%', maxWidth: 320,
                background: docDownloading ? '#6D8AA8' : '#3D5A80',
                color: 'white', border: 'none',
                borderRadius: 16, padding: '16px 0',
                fontSize: 16, fontWeight: 800,
                cursor: docDownloading ? 'default' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                opacity: docDownloading ? 0.7 : 1,
              }}
            >
              {docDownloading ? (
                <>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'spin 1s linear infinite' }}>
                    <path d="M21 12a9 9 0 11-6.219-8.56"/>
                  </svg>
                  Descargando...
                </>
              ) : (
                <>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                    <polyline points="7 10 12 15 17 10"/>
                    <line x1="12" y1="15" x2="12" y2="3"/>
                  </svg>
                  Descargar
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Visor fullscreen: imagen o video */}
      {expandedPhoto && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 1000, background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setExpandedPhoto(null)}
        >
          {expandedPhoto?.type === 'video' ? (
            <FullVideo src={expandedPhoto.src} viewOnce={!!expandedPhoto.viewOnce} />
          ) : (
            <img
              src={typeof expandedPhoto === 'string' ? expandedPhoto : expandedPhoto.src}
              onContextMenu={expandedPhoto?.viewOnce ? (e) => e.preventDefault() : undefined}
              style={{ width: '100vw', maxHeight: '100vh', objectFit: 'contain', ...(expandedPhoto?.viewOnce ? { userSelect: 'none', WebkitTouchCallout: 'none', pointerEvents: 'none' } : {}) }}
            />
          )}
          {expandedPhoto?.viewOnce && (
            <span style={{ position: 'absolute', bottom: 'calc(24px + env(safe-area-inset-bottom, 0px))', left: '50%', transform: 'translateX(-50%)', color: 'white',
                           background: 'rgba(0,0,0,0.55)', padding: '8px 16px', borderRadius: 18, fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', pointerEvents: 'none' }}>
              Ver una vez · al cerrar ya no se podrá volver a ver
            </span>
          )}
          {!expandedPhoto?.viewOnce && <button aria-label="Descargar" title="Descargar"
            onClick={(e) => { e.stopPropagation(); const isVid = expandedPhoto?.type === 'video';
                              saveMediaToPhone({ type: isVid ? 'video' : 'image', url: typeof expandedPhoto === 'string' ? expandedPhoto : expandedPhoto.src }); }}
            style={{ position: 'absolute', top: 20, right: 72, width: 40, height: 40, borderRadius: '50%', background: 'rgba(0,0,0,0.5)', border: '1.5px solid rgba(255,255,255,0.3)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>
            </svg>
          </button>}
          <button
            onClick={() => setExpandedPhoto(null)}
            style={{ position: 'absolute', top: 20, right: 20, width: 40, height: 40, borderRadius: '50%', background: 'rgba(0,0,0,0.5)', border: '1.5px solid rgba(255,255,255,0.3)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>
      )}

      {/* Vista previa antes de enviar una foto o un vídeo */}
      {pendingMedia && (
        <MediaPreview media={pendingMedia} onCancel={closePendingMedia}
          onSend={(viewOnce) => { const f = pendingMedia.file; closePendingMedia(); sendMediaFile(f, { viewOnce }); }} />
      )}
    </div>
  );
}

// ── Burbuja de una foto/vídeo "ver una vez" ─────────────────────────────────
function ViewOnceChip({ msg, isDark, onOpen }) {
  const video = msg.type === 'video';
  const what = video ? 'Vídeo' : 'Foto';
  const canOpen = !msg.isMine && !msg.opened && msg.status !== 'sending';
  const fg = isDark ? '#E0FBFC' : '#293241';
  const label = msg.status === 'sending' ? 'Enviando…'
              : msg.isMine ? (msg.opened ? `${what} · Abierta` : what)
              : msg.opened ? 'Abierta' : what;
  return (
    <button onClick={canOpen ? (e) => { e.stopPropagation(); onOpen(); } : undefined} disabled={!canOpen}
      style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'none', border: 'none', padding: '2px 0', cursor: canOpen ? 'pointer' : 'default',
               color: fg, opacity: canOpen || msg.isMine ? 1 : 0.6, minWidth: 130 }}>
      <span style={{ width: 30, height: 30, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 900,
                     background: msg.opened ? 'transparent' : '#3D5A80', color: msg.opened ? fg : 'white',
                     border: msg.opened ? `2px dashed ${isDark ? 'rgba(224,251,252,0.6)' : 'rgba(41,50,65,0.45)'}` : 'none' }}>1</span>
      <span style={{ textAlign: 'left' }}>
        <span style={{ display: 'block', fontSize: 15, fontWeight: 700 }}>{label}</span>
        {canOpen && <span style={{ display: 'block', fontSize: 11, opacity: 0.7 }}>Toca para verla · solo una vez</span>}
      </span>
    </button>
  );
}

// ── Vista previa de la foto o vídeo a enviar, con "ver una vez" ────────────
function MediaPreview({ media, onCancel, onSend }) {
  const [once, setOnce] = useState(false);
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: '#0A0D25', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', padding: 'calc(env(safe-area-inset-top, 0px) + 12px) 14px 8px' }}>
        <button onClick={onCancel} aria-label="Cancelar"
          style={{ width: 40, height: 40, borderRadius: '50%', background: 'rgba(255,255,255,0.12)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 8px' }}>
        {media.isVideo
          ? <video src={media.src} controls playsInline style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 12 }} />
          : <img src={media.src} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 12 }} />}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', paddingBottom: 'max(16px, env(safe-area-inset-bottom, 16px))' }}>
        <button onClick={() => setOnce(v => !v)} aria-pressed={once}
          style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, background: once ? 'rgba(152,193,217,0.22)' : 'rgba(255,255,255,0.08)',
                   border: `1.5px solid ${once ? '#98C1D9' : 'rgba(255,255,255,0.18)'}`, borderRadius: 24, padding: '8px 14px', cursor: 'pointer', color: 'white', textAlign: 'left' }}>
          <span style={{ width: 28, height: 28, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 900,
                         background: once ? '#98C1D9' : 'transparent', color: once ? '#0A0D25' : 'white', border: once ? 'none' : '2px dashed rgba(255,255,255,0.7)' }}>1</span>
          <span style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.25 }}>
            {once ? 'Ver una vez: activado' : 'Ver una vez'}
            <span style={{ display: 'block', fontSize: 11, fontWeight: 500, opacity: 0.75 }}>
              {once ? 'Solo podrá abrirse una vez y no se podrá guardar' : 'Toca para que solo se pueda ver una vez'}
            </span>
          </span>
        </button>
        <button onClick={() => onSend(once)} aria-label="Enviar"
          style={{ width: 54, height: 54, borderRadius: '50%', background: '#3D5A80', border: 'none', cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="22" height="22" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" style={{ transform: 'translateX(1px)' }}>
            <path d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// ── Vídeo a pantalla completa con velocidad 1× / 1,5× / 2× ─────────────────
function FullVideo({ src, viewOnce }) {
  const ref = useRef(null);
  const [speed, setSpeed] = useState(1);
  const cycle = (e) => {
    e.stopPropagation();
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    setSpeed(next);
    if (ref.current) ref.current.playbackRate = next;
  };
  return (
    <>
      <video ref={ref} src={src} controls autoPlay playsInline
        {...(viewOnce ? { controlsList: 'nodownload noplaybackrate', disablePictureInPicture: true, onContextMenu: (e) => e.preventDefault() } : {})}
        onLoadedMetadata={e => { e.target.playbackRate = speed; }}
        onClick={e => e.stopPropagation()}
        style={{ maxWidth: '96vw', maxHeight: '96vh', borderRadius: 12, outline: 'none' }} />
      <button onClick={cycle} aria-label={`Velocidad ${speedLabel(speed)}`}
        style={{ position: 'absolute', top: 20, left: 20, minWidth: 54, height: 40, borderRadius: 20, padding: '0 12px', cursor: 'pointer',
                 background: speed !== 1 ? 'white' : 'rgba(0,0,0,0.5)', color: speed !== 1 ? '#293241' : 'white',
                 border: '1.5px solid rgba(255,255,255,0.3)', fontSize: 15, fontWeight: 800 }}>
        {speedLabel(speed)}
      </button>
    </>
  );
}

// ── Reproductor de audio ────────────────────────────────────────────────────
// Solo suena una nota de voz a la vez: al dar a otra, la anterior se para.
let playingAudio = null;

function AudioPlayer({ src, isMine, isDark, knownDuration }) {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(Number(knownDuration) || 0);
  const audioRef = useRef(null);

  // Las notas grabadas en el móvil (webm) no traen su duración: se calcula saltando al final
  const onMeta = (e) => {
    const a = e.target;
    if (isFinite(a.duration) && a.duration > 0) { setDuration(a.duration); return; }
    if (knownDuration) return;
    const fix = () => {
      a.removeEventListener('timeupdate', fix);
      if (isFinite(a.duration)) setDuration(a.duration);
      a.currentTime = 0;
    };
    a.addEventListener('timeupdate', fix);
    try { a.currentTime = 1e7; } catch { /* nada */ }
  };
  useEffect(() => () => { if (playingAudio === audioRef.current) playingAudio = null; }, []);

  const fmtTime = (s) => {
    if (!s || !isFinite(s)) return '0:00';
    return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  };

  const [speed, setSpeed] = useState(1);
  const cycleSpeed = () => {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    setSpeed(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  };

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) { audio.pause(); setPlaying(false); return; }
    if (playingAudio && playingAudio !== audio) playingAudio.pause();   // para la que estaba sonando
    playingAudio = audio;
    audio.playbackRate = speed;
    audio.play().then(() => setPlaying(true)).catch(() => {});
  };

  // Dark mode + enviado  → fondo azul oscuro → iconos blancos
  // Light mode + enviado → fondo azul claro (#D5E6F0) → iconos azul oscuro
  // Recibido (ambos modos) → iconos azul oscuro
  const sentDark = isMine && isDark;
  const playBg    = sentDark ? 'rgba(255,255,255,0.22)' : '#3D5A80';
  const iconColor = sentDark ? 'white' : 'white';
  const trackBg   = sentDark ? 'rgba(255,255,255,0.3)' : (isMine ? 'rgba(61,90,128,0.2)' : 'rgba(61,90,128,0.15)');
  const trackFill = sentDark ? 'rgba(255,255,255,0.9)' : '#3D5A80';
  const timeColor = sentDark ? 'rgba(255,255,255,0.85)' : '#293241';
  const micColor  = sentDark ? 'rgba(255,255,255,0.7)' : '#3D5A80';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 180, maxWidth: 240 }}>
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onTimeUpdate={e => { if (e.target.currentTime < 1e6) setProgress(e.target.currentTime); }}
        onLoadedMetadata={onMeta}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setProgress(0); if (playingAudio === audioRef.current) playingAudio = null; }}
        style={{ display: 'none' }}
      />
      <button onClick={toggle} style={{
        width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
        background: playBg, border: 'none', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {playing ? (
          <svg width="14" height="14" fill={iconColor} viewBox="0 0 24 24">
            <rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>
          </svg>
        ) : (
          <svg width="14" height="14" fill={iconColor} viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z"/>
          </svg>
        )}
      </button>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <div
          style={{ height: 4, borderRadius: 4, background: trackBg, cursor: 'pointer', position: 'relative' }}
          onClick={e => {
            const rect = e.currentTarget.getBoundingClientRect();
            const pct = (e.clientX - rect.left) / rect.width;
            if (audioRef.current && duration) {
              audioRef.current.currentTime = pct * duration;
              setProgress(pct * duration);
            }
          }}
        >
          <div style={{
            height: '100%', borderRadius: 4, background: trackFill,
            width: duration ? `${(progress / duration) * 100}%` : '0%',
            transition: 'width 0.1s linear',
          }} />
        </div>
        <span style={{ fontSize: 11, color: timeColor, fontWeight: 600 }}>
          {playing || progress ? `${fmtTime(progress || 0)} / ${fmtTime(duration)}` : fmtTime(duration)}
        </span>
      </div>

      {/* Velocidad: 1× → 1,5× → 2× */}
      <button onClick={(e) => { e.stopPropagation(); cycleSpeed(); }} aria-label={`Velocidad ${speedLabel(speed)}`}
        style={{ flexShrink: 0, minWidth: 38, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer', padding: '0 7px',
                 background: speed !== 1 ? micColor : (sentDark ? 'rgba(255,255,255,0.18)' : 'rgba(61,90,128,0.14)'),
                 color: speed !== 1 ? (sentDark ? '#293241' : 'white') : micColor, fontSize: 12, fontWeight: 800 }}>
        {speedLabel(speed)}
      </button>
    </div>
  );
}

const SPEEDS = [1, 1.5, 2];
const speedLabel = (s) => `${String(s).replace('.', ',')}×`;

function VideoThumb({ src, onClick }) {
  const [thumb, setThumb] = useState(null);

  useEffect(() => {
    if (!src) return;
    let cancelled = false;
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      video.currentTime = 0.5;
    };
    video.onseeked = () => {
      if (cancelled) return;
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 320;
      canvas.height = video.videoHeight || 240;
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
      setThumb(canvas.toDataURL('image/jpeg', 0.8));
    };
    video.onerror = () => { /* keep fallback dark placeholder */ };
    video.src = src;
    return () => { cancelled = true; video.src = ''; };
  }, [src]);

  return (
    <div
      style={{ position: 'relative', cursor: 'pointer', borderRadius: 12, overflow: 'hidden', maxWidth: '100%', minHeight: 140, background: '#111' }}
      onClick={onClick}
    >
      {thumb ? (
        <img src={thumb} style={{ display: 'block', maxWidth: '100%', maxHeight: 420, objectFit: 'cover', borderRadius: 12, width: '100%' }} alt="" />
      ) : (
        <div style={{ width: '100%', height: 220, background: '#1a1a2e', borderRadius: 12 }} />
      )}
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.28)', borderRadius: 12 }}>
        <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(255,255,255,0.88)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="18" height="18" fill="#3D5A80" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ msg, isDark, T, onReply, onDelete, isGroup, memberNames = {}, onExpandPhoto, onViewDoc,
                         selectionMode, selected, onToggleSelect, onOpenMap, onLongPress, onMediaLoad, flash, onJumpReply, onOpenViewOnce }) {
  const isLocation = msg.type === 'location' || msg.type === 'live_location';
  const isAudio    = msg.type === 'audio';
  const isImage    = msg.type === 'image';
  const isVideo    = msg.type === 'video';
  const isDocument = msg.type === 'document';
  const isContact  = msg.type === 'contact';
  const isDeleted  = msg.deleted || msg.type === 'deleted';
  const isSticker  = msg.type === 'sticker' && !isDeleted;
  const longPressRef = useRef(null);

  const sentBg   = isDark ? 'linear-gradient(135deg, #293241, #3D5A80)' : '#D5E6F0';
  const recvBg   = isDark ? '#2F3A4D' : 'white';
  const sentText  = isDark ? '#ffffff' : '#293241';
  const recvText  = isDark ? '#E0FBFC' : '#1f2937';
  const timeColor = isDark ? '#93b8e0' : '#6b7280';
  const recvTime  = isDark ? '#3d5578' : '#9ca3af';

  // Pulsación larga: el menú solo se abre si se mantiene el dedo quieto 0,6 s (un toque o desplazar el chat no lo abre)
  const pressStart = useRef(null);
  const startPress = (e) => {
    if (selectionMode || (e.pointerType === 'mouse' && e.button !== 0)) return;
    pressStart.current = { x: e.clientX, y: e.clientY };
    clearTimeout(longPressRef.current);
    longPressRef.current = setTimeout(() => {
      pressStart.current = null;
      try { navigator.vibrate?.(30); } catch { /* sin vibración */ }
      onLongPress?.(msg);
    }, 600);
  };
  const movePress = (e) => {
    const s = pressStart.current;
    if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 16) endPress();   // el dedo siempre tiembla un poco
  };
  const isOnce = !!msg.viewOnce && (isImage || isVideo);
  const isWide = (isImage || isVideo || isLocation) && !isOnce;
  const endPress   = () => { clearTimeout(longPressRef.current); pressStart.current = null; };

  return (
    <div
      id={`msg-${msg.id}`}
      className="of-msg"
      onContextMenu={(e) => { e.preventDefault(); if (!selectionMode && !IS_TOUCH) onLongPress?.(msg); }}
      style={{ display: 'flex', justifyContent: msg.isMine ? 'flex-end' : 'flex-start', alignItems: 'flex-end', gap: 4, position: 'relative',
               background: selected ? 'rgba(61,90,128,0.22)' : flash ? 'rgba(255,200,0,0.28)' : 'transparent', transition: 'background 0.4s', borderRadius: 10, margin: selectionMode ? '0 -6px' : 0, padding: selectionMode ? '2px 6px' : 0 }}
      onClickCapture={selectionMode ? (e) => { e.stopPropagation(); e.preventDefault(); onToggleSelect?.(); } : undefined}
      onPointerDown={startPress} onPointerMove={movePress} onPointerUp={endPress} onPointerCancel={endPress} onPointerLeave={endPress}
    >
      <div style={{
        maxWidth: isWide ? 'min(82vw, 380px)' : isAudio ? 280 : '78%',
        width: isWide ? 'min(82vw, 380px)' : undefined,
        padding: isSticker ? 0 : isWide ? '4px 4px 8px' : '9px 14px',
        borderRadius: msg.isMine ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
        background: isSticker ? 'transparent' : msg.isMine ? sentBg : recvBg,
        boxShadow: isSticker ? 'none' : isDark ? '0 1px 4px rgba(0,0,0,0.4)' : '0 1px 3px rgba(0,0,0,0.08)',
        overflow: 'hidden',
      }}>
        {/* Nombre remitente en grupos */}
        {isGroup && !msg.isMine && (
          <p style={{ fontSize: 12, fontWeight: 800, color: '#3D5A80', margin: '0 0 4px', letterSpacing: '0.2px', paddingLeft: (isImage || isVideo) ? 8 : 0 }}>
            {memberNames[msg.sender] || msg.sender?.replace(/^user_/, '') || '?'}
          </p>
        )}

        {/* Cita del mensaje al que se responde */}
        {msg.replyTo && !isDeleted && (
          <div style={{ margin: isWide ? '0 0 6px' : '-3px -8px 7px', minWidth: 170 }}>
            <ReplyQuote reply={msg.replyTo} where={msg.isMine ? 'sent' : 'recv'} isDark={isDark}
              onClick={msg.replyTo.id ? (e) => { e.stopPropagation(); onJumpReply?.(msg.replyTo.id); } : undefined} />
          </div>
        )}

        {/* Contenido del mensaje */}
        {isDeleted ? (
          <p style={{ fontSize: 14, fontStyle: 'italic', color: msg.isMine ? timeColor : recvTime, margin: 0 }}>🚫 Se eliminó este mensaje</p>
        ) : isOnce ? (
          <ViewOnceChip msg={msg} isDark={isDark} onOpen={() => onOpenViewOnce?.(msg)} />
        ) : isSticker ? (
          <img src={msg.url} alt="Sticker" onLoad={onMediaLoad} style={{ display: 'block', width: 150, height: 150, objectFit: 'contain' }} />
        ) : isImage ? (
          <img
            src={msg.url}
            onLoad={onMediaLoad}
            onClick={() => onExpandPhoto?.(msg.url)}
            style={{ display: 'block', width: '100%', borderRadius: 12, maxHeight: 460, minHeight: 120, objectFit: 'cover', cursor: 'pointer', background: 'rgba(0,0,0,0.08)' }}
          />
        ) : isVideo ? (
          <VideoThumb src={msg.url} onClick={() => onExpandPhoto?.({ type: 'video', src: msg.url })} />
        ) : isDocument ? (() => {
          // Extraer nombre de fichero (con fallback para mensajes antiguos sin fileName)
          const docName = msg.fileName
            || msg.text?.match(/^\[Archivo: (.+)\]$/)?.[1]
            || 'Archivo';
          // Extensión para mostrar badge de tipo
          const ext = docName.split('.').pop()?.toUpperCase().slice(0, 4) || 'DOC';
          return (
          <button
            onClick={() => onViewDoc?.(msg)}
            style={{
              display: 'flex', alignItems: 'center', gap: 12,
              background: 'none', border: 'none', cursor: 'pointer',
              padding: '4px 0', textAlign: 'left', width: '100%',
            }}>
            {/* Icono con badge de extensión — siempre azul oscuro sobre blanco */}
            <span style={{
              width: 44, height: 44, borderRadius: 12, flexShrink: 0,
              background: '#3D5A80',
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 1,
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>
              </svg>
              <span style={{ fontSize: 7, color: 'white', fontWeight: 900, lineHeight: 1, letterSpacing: '0.3px' }}>{ext}</span>
            </span>
            <div style={{ minWidth: 0 }}>
              <div style={{
                fontSize: 13, fontWeight: 700,
                color: msg.isMine ? (isDark ? '#D5E6F0' : '#293241') : (isDark ? '#E0FBFC' : '#293241'),
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180,
              }}>{docName}</div>
              <div style={{ fontSize: 11, color: msg.isMine ? (isDark ? '#93c5fd' : '#3b82f6') : (isDark ? '#93b8e0' : '#6b7280'), marginTop: 2 }}>
                Toca para descargar
              </div>
            </div>
          </button>
          );
        })()
        : isContact ? (() => {
          let cName = '—', cPhone = '—';
          try { const d = JSON.parse(msg.url || '{}'); cName = d.name || '—'; cPhone = d.phone || '—'; } catch {}
          return (
            <a href={`tel:${cPhone}`} style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', padding: '4px 2px' }}>
              <span style={{ width: 40, height: 40, borderRadius: '50%', background: '#e11d48', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg width="20" height="20" fill="white" viewBox="0 0 24 24">
                  <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/>
                </svg>
              </span>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: msg.isMine ? sentText : recvText }}>{cName}</div>
                <div style={{ fontSize: 12, color: msg.isMine ? timeColor : recvTime }}>{cPhone}</div>
              </div>
            </a>
          );
        })() : isLocation ? (
          <LocationCard msg={msg} textColor={msg.isMine ? sentText : recvText} mutedColor={msg.isMine ? timeColor : recvTime}
                        onOpen={() => onOpenMap?.(msg)} />
        ) : isAudio ? (
          <AudioPlayer src={msg.url} isMine={msg.isMine} isDark={isDark} knownDuration={msg.duration} />
        ) : (
          <p style={{ fontSize: 15, color: msg.isMine ? sentText : recvText, fontWeight: 500, lineHeight: 1.5, margin: 0, whiteSpace: 'pre-wrap', padding: (isImage || isVideo) ? '0 8px' : 0 }}>
            {msg.text}
          </p>
        )}

        {/* Hora y estado */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4,
          marginTop: isWide ? 2 : 4,
          padding: isWide ? '0 8px' : 0,
        }}>
          {msg.pinned && !isDeleted && <span style={{ fontSize: 11 }} title="Fijado">📌</span>}
          {msg.starred && !isDeleted && <span style={{ fontSize: 11 }} title="Destacado">⭐</span>}
          {msg.editedAt && !isDeleted && <span style={{ fontSize: 11, fontStyle: 'italic', color: msg.isMine ? timeColor : recvTime }}>editado</span>}
          <span style={{ fontSize: 12, color: msg.isMine ? timeColor : recvTime }}>{msg.time}</span>
          {msg.isMine && (
            <span style={{ fontSize: 12, color: msg.status === 'read' ? '#60a5fa' : timeColor }}>
              {msg.status === 'sending' ? '○' : msg.status === 'error' ? '⚠️' : msg.status === 'sent' ? '✓' : '✓✓'}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Ubicación (fija o en tiempo real) con la vista previa del mapa, como en WhatsApp ──
const fmtHour = (ts) => new Date(ts).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
function agoText(ts) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return 'hace un momento';
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  return `a las ${fmtHour(ts)}`;
}
const liveActive = (live) => !!live && !live.stopped && live.until > Date.now();

function LocationCard({ msg, textColor, mutedColor, onOpen }) {
  const pos = msg.locating ? null : messageLatLng(msg);
  const [snap, setSnap] = useState(null);
  const [visible, setVisible] = useState(false);
  const [, tick] = useState(0);
  const [sharing, setSharing] = useState(() => isSharingLive(msg.id));
  const boxRef = useRef(null);
  const isLive = msg.type === 'live_location';
  const live = msg.live;

  // Solo se dibuja el mapa cuando la burbuja está a la vista
  useEffect(() => {
    const el = boxRef.current;
    if (!el || visible) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVisible(true); io.disconnect(); } }, { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  const key = pos ? `${pos.lat.toFixed(5)},${pos.lng.toFixed(5)}` : '';
  useEffect(() => {
    if (!visible || !pos) return;
    let alive = true;
    renderMapSnapshot(pos.lat, pos.lng).then(url => { if (alive && url) setSnap(url); });
    return () => { alive = false; };
  }, [visible, key]); // eslint-disable-line

  // Tiempo real: refrescar "actualizada hace…" y saber si este móvil la sigue compartiendo
  useEffect(() => {
    if (!isLive) return;
    const t = setInterval(() => tick(n => n + 1), 30000);
    const off = onLiveSharesChange(() => setSharing(isSharingLive(msg.id)));
    return () => { clearInterval(t); off(); };
  }, [isLive, msg.id]);

  const active = isLive && liveActive(live);
  return (
    <div ref={boxRef}>
      <button onClick={pos ? onOpen : undefined} aria-label="Ver la ubicación en el mapa"
        style={{ display: 'block', width: '100%', padding: 0, border: 'none', background: '#dfe7ee', borderRadius: 12, overflow: 'hidden',
                 cursor: pos ? 'pointer' : 'default', position: 'relative', aspectRatio: '320 / 170' }}>
        {snap
          ? <img src={snap} alt="" style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }} />
          : <span style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, color: '#3D5A80', fontSize: 13, fontWeight: 700 }}>
              <svg width="30" height="30" viewBox="0 0 24 24" fill="#3D5A80" style={{ animation: msg.locating ? 'locPulse 1.2s ease-in-out infinite' : 'none' }}>
                <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
              </svg>
              {msg.locating ? 'Obteniendo tu ubicación…' : 'Cargando mapa…'}
              <style>{'@keyframes locPulse{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}'}</style>
            </span>}
        {active && (
          <span style={{ position: 'absolute', top: 8, left: 8, background: '#dc2626', color: 'white', fontSize: 11, fontWeight: 800, borderRadius: 10, padding: '3px 8px' }}>
            ● EN DIRECTO
          </span>
        )}
      </button>
      <div style={{ padding: '8px 8px 0' }}>
        <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: textColor }}>
          {isLive ? 'Ubicación en tiempo real' : '📍 Ubicación'}
        </p>
        {isLive && live && (
          <p style={{ margin: '2px 0 0', fontSize: 12, color: mutedColor }}>
            {active ? `Hasta las ${fmtHour(live.until)} · actualizada ${agoText(live.updatedAt || Date.now())}` : 'Ya no se comparte'}
          </p>
        )}
        {msg.isMine && active && sharing && (
          <button onClick={(e) => { e.stopPropagation(); if (window.confirm('¿Dejar de compartir tu ubicación?')) stopLiveShare(msg.id); }}
            style={{ marginTop: 8, width: '100%', background: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: 10, padding: '8px 0', fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>
            Dejar de compartir
          </button>
        )}
      </div>
    </div>
  );
}

/** Mapa a pantalla completa: sigue la posición si es en tiempo real */
function ChatMapView({ msg, onClose }) {
  const boxRef = useRef(null);
  const mapRef = useRef(null);
  const pos = messageLatLng(msg);
  const isLive = msg.type === 'live_location';
  const active = isLive && liveActive(msg.live);

  useEffect(() => {
    if (!pos) return;
    let alive = true;
    createChatMap(boxRef.current, pos.lat, pos.lng).then(m => { if (alive) mapRef.current = m; else m.remove(); }).catch(() => {});
    return () => { alive = false; mapRef.current?.remove(); mapRef.current = null; };
  }, []); // eslint-disable-line

  useEffect(() => { if (pos) mapRef.current?.setPosition(pos.lat, pos.lng); }, [pos?.lat, pos?.lng]); // eslint-disable-line

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: '#dfe7ee', display: 'flex', flexDirection: 'column' }}>
      <div style={{ background: '#3D5A80', color: 'white', padding: '0 12px 12px', paddingTop: 'max(12px, env(safe-area-inset-top, 12px))',
                    display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <button onClick={onClose} aria-label="Volver" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
          <svg width="24" height="24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M15 19l-7-7 7-7"/></svg>
        </button>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontWeight: 800, fontSize: 16 }}>{isLive ? 'Ubicación en tiempo real' : 'Ubicación'}</span>
          {isLive && msg.live && (
            <span style={{ display: 'block', fontSize: 12, opacity: 0.85 }}>
              {active ? `Hasta las ${fmtHour(msg.live.until)} · actualizada ${agoText(msg.live.updatedAt || Date.now())}` : 'Ya no se comparte'}
            </span>
          )}
        </span>
        {pos && (
          <button onClick={() => openInMapsApp(pos.lat, pos.lng)}
            style={{ background: 'white', color: '#3D5A80', border: 'none', borderRadius: 18, padding: '8px 12px', fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>
            Cómo llegar
          </button>
        )}
      </div>
      <div ref={boxRef} style={{ flex: 1, position: 'relative' }} />
    </div>
  );
}

/** Reenviar los mensajes seleccionados a uno o varios chats */
function ForwardSheet({ T, user, currentChatId, msgs, onClose, onDone }) {
  const chats = useChatStore(s => s.chats);
  const fetchChats = useChatStore(s => s.fetchChats);
  const persistMessage = useChatStore(s => s.persistMessage);
  const [picked, setPicked] = useState(() => new Set());
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (user?.id) fetchChats(user.id); }, [user?.id]); // eslint-disable-line

  const list = chats.filter(c => !query || String(c.name || '').toLowerCase().includes(query.toLowerCase()));
  const toggle = (id) => setPicked(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const send = async () => {
    if (!picked.size) return;
    setBusy(true);
    const toSend = msgs.filter(m => !m.locating && m.status !== 'error' && !m.deleted && !m.viewOnce);
    for (const chatId of picked) {
      for (const m of toSend) {
        // La ubicación en tiempo real se reenvía como ubicación fija (el último punto)
        const type = m.type === 'live_location' ? 'location' : (m.type || 'text');
        const p = m.type === 'live_location' ? messageLatLng(m) : null;
        const text = p ? `📍 Ubicación\n${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}` : m.text;
        const url = p ? `https://maps.google.com/?q=${p.lat},${p.lng}` : m.url;
        await persistMessage(chatId, user.id, text, type, url, null, m.fileName || null, m.duration ? { duration: m.duration } : {});
      }
    }
    setBusy(false);
    if (picked.has(currentChatId)) useChatStore.getState().loadMessages(currentChatId, user.id);
    onDone();
    alert(picked.size === 1 ? 'Reenviado' : `Reenviado a ${picked.size} chats`);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 950, background: 'rgba(10,13,37,0.55)', display: 'flex', alignItems: 'flex-end' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: T.bgSurface, width: '100%', maxHeight: '85dvh', borderRadius: '22px 22px 0 0',
                                                      display: 'flex', flexDirection: 'column', paddingBottom: 'max(14px, env(safe-area-inset-bottom, 14px))' }}>
        <div style={{ padding: '18px 18px 10px' }}>
          <p style={{ margin: 0, fontWeight: 900, fontSize: 18, color: T.textPrimary }}>
            Reenviar {msgs.length === 1 ? 'mensaje' : `${msgs.length} mensajes`}
          </p>
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar chat…"
            style={{ marginTop: 10, width: '100%', boxSizing: 'border-box', padding: '10px 14px', borderRadius: 12, border: `1px solid ${T.border}`, background: T.bgInput, color: T.textPrimary, fontSize: 14, outline: 'none' }} />
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 10px' }}>
          {list.length === 0 && <p style={{ textAlign: 'center', color: T.textMuted, fontSize: 13, padding: 20 }}>No hay chats</p>}
          {list.map(c => {
            const on = picked.has(c.id);
            return (
              <button key={c.id} onClick={() => toggle(c.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', background: on ? 'rgba(61,90,128,0.12)' : 'none', border: 'none', borderRadius: 12, padding: '8px 8px', cursor: 'pointer', textAlign: 'left' }}>
                <Avatar name={c.name} src={c.avatar || null} size="md" />
                <span style={{ flex: 1, minWidth: 0, color: T.textPrimary, fontWeight: 700, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {c.name}{c.id === currentChatId ? ' (este chat)' : ''}
                </span>
                <span style={{ width: 24, height: 24, borderRadius: '50%', flexShrink: 0, border: `2px solid ${on ? '#3D5A80' : T.border}`, background: on ? '#3D5A80' : 'transparent',
                               color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 900 }}>{on ? '✓' : ''}</span>
              </button>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: 10, padding: '12px 18px 0' }}>
          <button onClick={onClose} style={{ flex: 1, background: T.bgHover, color: T.textPrimary, border: 'none', borderRadius: 14, padding: '13px 0', fontWeight: 800, fontSize: 15, cursor: 'pointer' }}>Cancelar</button>
          <button onClick={send} disabled={!picked.size || busy}
            style={{ flex: 2, background: '#3D5A80', color: 'white', border: 'none', borderRadius: 14, padding: '13px 0', fontWeight: 800, fontSize: 15, cursor: 'pointer', opacity: !picked.size || busy ? 0.5 : 1 }}>
            {busy ? 'Enviando…' : picked.size > 1 ? `Enviar a ${picked.size} chats` : 'Enviar'}
          </button>
        </div>
      </div>
    </div>
  );
}

const IS_TOUCH = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;

// ── Cita de respuesta (dentro de la burbuja y en la barra de escribir) ─────
const REPLY_ICONS = {
  image:    'M4 5h16a1 1 0 011 1v12a1 1 0 01-1 1H4a1 1 0 01-1-1V6a1 1 0 011-1zm0 11l5-5 4 4 3-3 4 4M15.5 9.5h.01',
  video:    'M15 10l4.55-2.07A1 1 0 0121 8.87v6.26a1 1 0 01-1.45.9L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z',
  audio:    'M12 3a3 3 0 00-3 3v6a3 3 0 006 0V6a3 3 0 00-3-3zM5 11a7 7 0 0014 0M12 18v3',
  location: 'M12 21s-7-6.2-7-11.5A7 7 0 0112 2.5a7 7 0 017 7C19 14.8 12 21 12 21zM12 12a2.5 2.5 0 100-5 2.5 2.5 0 000 5z',
  document: 'M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8zM14 3v5h5',
  sticker:  'M12 3a9 9 0 100 18 9 9 0 000-18zM8.5 14.5s1.3 2 3.5 2 3.5-2 3.5-2M9 9.5h.01M15 9.5h.01',
  contact:  'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0',
};
REPLY_ICONS.live_location = REPLY_ICONS.location;
const REPLY_LABELS = { image: 'Foto', video: 'Vídeo', audio: 'Nota de voz', location: 'Ubicación', live_location: 'Ubicación en tiempo real',
                       document: 'Documento', sticker: 'Sticker', contact: 'Contacto' };

/** Colores de la cita según dónde se pinta: 'sent' / 'recv' (burbujas) o 'bar' (barra de escribir) */
function replyColors(where, isDark) {
  if (isDark) return {
    bg: where === 'sent' ? 'rgba(255,255,255,0.12)' : where === 'recv' ? 'rgba(0,0,0,0.22)' : 'rgba(152,193,217,0.12)',
    bar: '#98C1D9', name: '#98C1D9', text: 'rgba(224,251,252,0.85)',
  };
  return { bg: where === 'sent' ? 'rgba(255,255,255,0.7)' : '#EEF3F7', bar: '#3D5A80', name: '#3D5A80', text: '#4b5563' };
}

function ReplyQuote({ reply, where, isDark, onClick, children }) {
  const c = replyColors(where, isDark);
  const t = reply.type || 'text';
  const icon = REPLY_ICONS[t];
  const label = reply.viewOnce ? `${REPLY_LABELS[t] || 'Foto'} (ver una vez)`
              : t === 'document' ? (reply.fileName || REPLY_LABELS.document)
              : (t === 'image' || t === 'video') && reply.text && !/^\[/.test(reply.text) ? reply.text
              : REPLY_LABELS[t] || reply.text || '';
  const thumb = reply.url && (t === 'image' || t === 'video' || t === 'sticker') ? reply.url : null;
  return (
    <div onClick={onClick} style={{
      display: 'flex', alignItems: 'stretch', gap: 8, background: c.bg, borderRadius: 10, overflow: 'hidden',
      cursor: onClick ? 'pointer' : 'default', minWidth: 0, flex: where === 'bar' ? 1 : undefined,
    }}>
      <span style={{ width: 4, background: c.bar, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0, padding: '7px 4px 7px 0' }}>
        <p style={{ fontSize: 13, fontWeight: 800, color: c.name, margin: '0 0 2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {reply.senderName}
        </p>
        <p style={{ fontSize: 13, lineHeight: 1.35, color: c.text, margin: 0, display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
          {icon && (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <path d={icon} />
            </svg>
          )}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', wordBreak: 'break-word' }}>
            {label}
          </span>
        </p>
      </div>
      {thumb && (t === 'video'
        ? <video src={thumb} muted style={{ width: 52, height: 52, objectFit: 'cover', flexShrink: 0, alignSelf: 'center', borderRadius: 6, marginRight: 4 }} />
        : <img src={thumb} alt="" style={{ width: 52, height: 52, objectFit: 'cover', flexShrink: 0, alignSelf: 'center', borderRadius: 6, marginRight: 4 }} />)}
      {children}
    </div>
  );
}

// ── Vista previa corta de un mensaje (fijados, destacados) ─────────────────
function msgPreview(m) {
  const t = m.type || 'text';
  if (m.deleted || t === 'deleted') return '🚫 Se eliminó este mensaje';
  if (m.viewOnce) return t === 'video' ? '① Vídeo (ver una vez)' : '① Foto (ver una vez)';
  return t === 'image' ? '📷 Foto' : t === 'video' ? '🎥 Vídeo' : t === 'audio' ? '🎤 Nota de voz'
       : t === 'sticker' ? '🌟 Sticker' : t === 'location' ? '📍 Ubicación' : t === 'live_location' ? '📍 Ubicación en tiempo real'
       : t === 'document' ? `📄 ${m.fileName || 'Documento'}` : t === 'contact' ? '👤 Contacto' : (m.text || '');
}

// ── Fondo del chat (en este móvil): por chat o para todos ('*') ────────────
const BG_KEY = 'oldface_chat_bg_v1';
function readChatBg(chatId) {
  try { const all = JSON.parse(localStorage.getItem(BG_KEY) || '{}'); return all[chatId] || all['*'] || null; } catch { return null; }
}
/** Guarda el fondo (null = predeterminado). Devuelve el texto del error o null */
function saveChatBg(key, bg, clearKey) {
  try {
    const all = JSON.parse(localStorage.getItem(BG_KEY) || '{}');
    if (bg) all[key] = bg; else delete all[key];
    if (clearKey) delete all[clearKey];   // "para todos": este chat deja de tener uno propio
    localStorage.setItem(BG_KEY, JSON.stringify(all));
    return null;
  } catch { return 'No hay espacio para guardar esa foto de fondo. Prueba con otra foto o con un color.'; }
}

const BG_PRESETS = [
  ['Predeterminado', null],
  ['Cielo', '#E3EDF2'], ['Arena', '#FDF2E9'], ['Menta', '#E8F5E9'], ['Lavanda', '#F3E5F5'], ['Crema', '#FFF8E1'],
  ['Mar', 'linear-gradient(160deg,#98C1D9,#E0FBFC)'], ['Noche', 'linear-gradient(160deg,#293241,#3D5A80)'],
  ['Atardecer', 'linear-gradient(160deg,#EE6C4D,#FFC800)'], ['Bosque', 'linear-gradient(160deg,#2E7D32,#A5D6A7)'],
];

function BackgroundSheet({ T, current, onClose, onApply }) {
  const [all, setAll] = useState(false);
  const fileRef = useRef(null);
  const pickPhoto = (file) => {
    if (!file) return;
    const rd = new FileReader();
    rd.onload = () => {
      const img = new Image();
      img.onload = () => {
        const max = 1080, r = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * r); c.height = Math.round(img.height * r);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        onApply({ css: `url(${c.toDataURL('image/jpeg', 0.72)}) center / cover no-repeat fixed` }, all);
      };
      img.src = rd.result;
    };
    rd.readAsDataURL(file);
  };
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 950, background: 'rgba(10,13,37,0.55)', display: 'flex', alignItems: 'flex-end' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: T.bgSurface, width: '100%', borderRadius: '22px 22px 0 0', padding: '18px', paddingBottom: 'max(18px, env(safe-area-inset-bottom, 18px))' }}>
        <p style={{ margin: '0 0 12px', fontWeight: 900, fontSize: 18, color: T.textPrimary }}>Fondo del chat</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(64px, 1fr))', gap: 10 }}>
          {BG_PRESETS.map(([name, css]) => {
            const on = (current?.css || null) === css;
            return (
              <button key={name} onClick={() => onApply(css ? { css } : null, all)} title={name}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                <span style={{ width: '100%', aspectRatio: '3 / 4', borderRadius: 12, background: css || T.bgMain, border: `${on ? 3 : 1}px solid ${on ? '#3D5A80' : T.border}` }} />
                <span style={{ fontSize: 11, color: T.textSecondary, fontWeight: 600 }}>{name}</span>
              </button>
            );
          })}
          <button onClick={() => fileRef.current?.click()}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
            <span style={{ width: '100%', aspectRatio: '3 / 4', borderRadius: 12, border: '2px dashed #3D5A80', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>📷</span>
            <span style={{ fontSize: 11, color: T.textSecondary, fontWeight: 600 }}>Tu foto</span>
          </button>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16, color: T.textPrimary, fontSize: 14, fontWeight: 600 }}>
          <input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)} style={{ width: 18, height: 18 }} />
          Usar en todos los chats
        </label>
        <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { pickPhoto(e.target.files?.[0]); e.target.value = ''; }} />
      </div>
    </div>
  );
}

// ── Menú de un mensaje (pulsación larga) ───────────────────────────────────
function MessageActions({ T, msg, canEdit, onClose, onReply, onCopy, onEdit, onPin, onStar, onForward, onSelect, onDelete, onAddSticker, onSaveMedia }) {
  const deleted = msg.deleted || msg.type === 'deleted';
  const local = msg.status === 'sending' || msg.status === 'error';
  const sticker = msg.type === 'sticker' && !deleted && !local && /^https?:/.test(msg.url || '');
  const media = ['image', 'video', 'sticker'].includes(msg.type) && !deleted && !local && !!msg.url && !msg.viewOnce;
  const items = [
    !deleted && !local && ['Responder', onReply],
    sticker && !msg.isMine && ['Añadir a mis stickers', onAddSticker],
    media && [msg.type === 'video' ? 'Descargar vídeo' : msg.type === 'sticker' ? 'Guardar en el móvil' : 'Descargar foto', onSaveMedia],
    !deleted && (msg.type || 'text') === 'text' && ['Copiar', onCopy],
    canEdit && ['Editar', onEdit],
    !deleted && !local && [msg.pinned ? 'Dejar de fijar' : 'Fijar', onPin],
    !deleted && !local && [msg.starred ? 'Quitar destacado' : 'Destacar', onStar],
    !deleted && !local && !msg.viewOnce && ['Reenviar', onForward],
    ['Seleccionar varios', onSelect],
    ['Eliminar', onDelete, true],
  ].filter(Boolean);
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 940, background: 'rgba(10,13,37,0.45)', display: 'flex', alignItems: 'flex-end' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: T.bgSurface, width: '100%', borderRadius: '22px 22px 0 0', padding: '10px 10px', paddingBottom: 'max(12px, env(safe-area-inset-bottom, 12px))' }}>
        <p style={{ margin: '4px 12px 8px', fontSize: 13, color: T.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{msgPreview(msg)}</p>
        {items.map(([label, fn, danger]) => (
          <button key={label} onClick={() => { onClose(); fn(); }}
            style={{ display: 'block', width: '100%', background: 'none', border: 'none', padding: '13px 16px', borderRadius: 12, cursor: 'pointer',
                     color: danger ? '#dc2626' : T.textPrimary, fontSize: 15, fontWeight: 700, textAlign: 'left' }}>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Eliminar: para mí / para todos ─────────────────────────────────────────
function DeleteDialog({ T, msgs, onCancel, onDelete }) {
  const n = msgs.length;
  // "Para todos" solo si todos son míos, ya enviados y no eliminados
  const canAll = msgs.every(m => m.isMine && !m.deleted && m.type !== 'deleted' && m.status !== 'sending' && m.status !== 'error');
  const btn = (label, fn, color) => (
    <button onClick={fn} style={{ width: '100%', background: 'none', border: 'none', borderTop: `1px solid ${T.border}`, padding: '15px 0', fontSize: 16, fontWeight: 800, color, cursor: 'pointer' }}>{label}</button>
  );
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 960, background: 'rgba(10,13,37,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }} onClick={onCancel}>
      <div onClick={e => e.stopPropagation()} style={{ background: T.bgSurface, width: '100%', maxWidth: 360, borderRadius: 20, overflow: 'hidden' }}>
        <p style={{ margin: 0, padding: '20px 20px 6px', fontWeight: 900, fontSize: 17, color: T.textPrimary }}>
          {n === 1 ? '¿Eliminar mensaje?' : `¿Eliminar ${n} mensajes?`}
        </p>
        <p style={{ margin: 0, padding: '0 20px 16px', fontSize: 13, color: T.textMuted }}>
          {canAll ? '«Para todos» lo quita también del móvil de los demás.' : 'Solo desaparecerá de tu móvil.'}
        </p>
        {canAll && btn('Eliminar para todos', () => onDelete('all'), '#dc2626')}
        {btn('Eliminar para mí', () => onDelete('me'), '#dc2626')}
        {btn('Cancelar', onCancel, '#3D5A80')}
      </div>
    </div>
  );
}

// ── Mensajes destacados ────────────────────────────────────────────────────
function StarredSheet({ T, msgs, onClose, onPick, onUnstar }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 950, background: 'rgba(10,13,37,0.55)', display: 'flex', alignItems: 'flex-end' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: T.bgSurface, width: '100%', maxHeight: '80dvh', borderRadius: '22px 22px 0 0', display: 'flex', flexDirection: 'column',
                                                      paddingBottom: 'max(12px, env(safe-area-inset-bottom, 12px))' }}>
        <p style={{ margin: 0, padding: '18px 18px 10px', fontWeight: 900, fontSize: 18, color: T.textPrimary }}>Mensajes destacados</p>
        <div style={{ overflowY: 'auto', padding: '0 10px' }}>
          {msgs.length === 0 && <p style={{ textAlign: 'center', color: T.textMuted, fontSize: 13, padding: '16px 20px 24px' }}>
            Aún no hay mensajes destacados. Mantén pulsado un mensaje y elige «Destacar».</p>}
          {msgs.map(m => (
            <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8, borderBottom: `1px solid ${T.border}` }}>
              <button onClick={() => onPick(m)} style={{ flex: 1, minWidth: 0, background: 'none', border: 'none', padding: '12px 8px', textAlign: 'left', cursor: 'pointer' }}>
                <span style={{ display: 'block', fontSize: 12, color: T.textMuted, fontWeight: 700 }}>{m.isMine ? 'Tú' : 'Recibido'} · {m.time}</span>
                <span style={{ display: 'block', fontSize: 14, color: T.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{msgPreview(m)}</span>
              </button>
              <button onClick={() => onUnstar(m)} aria-label="Quitar destacado" title="Quitar destacado"
                style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', padding: 8 }}>✖️</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Crear un sticker a partir de una foto ──────────────────────────────────
const STICKER_SIZE = 512;
function StickerEditor({ T, src, onCancel, onSave }) {
  const canvasRef = useRef(null);
  const [img, setImg] = useState(null);
  const [shape, setShape] = useState('rounded');   // rounded | circle | free
  const [text, setText] = useState('');
  const [color, setColor] = useState('#ffffff');
  const [pos, setPos] = useState('bottom');
  const [zoom, setZoom] = useState(1);

  useEffect(() => { const i = new Image(); i.onload = () => setImg(i); i.src = src; }, [src]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !img) return;
    const S = STICKER_SIZE, pad = 18, g = c.getContext('2d');
    g.clearRect(0, 0, S, S);
    const box = S - pad * 2;
    // Forma (con borde blanco, como los stickers)
    const path = () => {
      g.beginPath();
      if (shape === 'circle') g.arc(S / 2, S / 2, box / 2, 0, Math.PI * 2);
      else if (shape === 'rounded') g.roundRect(pad, pad, box, box, 70);
      else g.rect(pad, pad, box, box);
    };
    g.save();
    if (shape !== 'free') { path(); g.clip(); }
    // Foto: rellena la forma (o entera en "libre"), con zoom
    const base = shape === 'free' ? Math.min(box / img.width, box / img.height) : Math.max(box / img.width, box / img.height);
    const sc = base * zoom, w = img.width * sc, h = img.height * sc;
    g.drawImage(img, (S - w) / 2, (S - h) / 2, w, h);
    g.restore();
    if (shape !== 'free') { path(); g.lineWidth = 14; g.strokeStyle = '#ffffff'; g.stroke(); }
    // Texto
    const t = text.trim();
    if (t) {
      let size = 78;
      g.font = `900 ${size}px system-ui, sans-serif`;
      while (g.measureText(t).width > S - 60 && size > 28) { size -= 4; g.font = `900 ${size}px system-ui, sans-serif`; }
      g.textAlign = 'center'; g.textBaseline = pos === 'top' ? 'top' : 'bottom';
      const y = pos === 'top' ? 34 : S - 34;
      g.lineJoin = 'round'; g.lineWidth = Math.max(8, size / 6); g.strokeStyle = color === '#000000' ? '#ffffff' : '#000000';
      g.strokeText(t, S / 2, y);
      g.fillStyle = color; g.fillText(t, S / 2, y);
    }
  }, [img, shape, text, color, pos, zoom]);

  const save = (andSend) => canvasRef.current?.toBlob(b => { if (b) onSave(b, andSend); }, 'image/png');
  const chip = (on) => ({ background: on ? '#3D5A80' : T.bgHover, color: on ? 'white' : T.textPrimary, border: 'none', borderRadius: 14, padding: '7px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer' });

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 970, background: 'rgba(10,13,37,0.7)', display: 'flex', alignItems: 'flex-end' }} onClick={onCancel}>
      <div onClick={e => e.stopPropagation()} style={{ background: T.bgSurface, width: '100%', maxHeight: '94dvh', overflowY: 'auto', borderRadius: '22px 22px 0 0', padding: 18,
                                                      paddingBottom: 'max(18px, env(safe-area-inset-bottom, 18px))' }}>
        <p style={{ margin: '0 0 12px', fontWeight: 900, fontSize: 18, color: T.textPrimary }}>🌟 Crear sticker</p>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12,
                      background: 'repeating-conic-gradient(#e5e7eb 0% 25%, #ffffff 0% 50%) 50% / 20px 20px', borderRadius: 16 }}>
          <canvas ref={canvasRef} width={STICKER_SIZE} height={STICKER_SIZE} style={{ width: 'min(64vw, 240px)', height: 'min(64vw, 240px)' }} />
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {[['rounded', 'Redondeado'], ['circle', 'Círculo'], ['free', 'Foto entera']].map(([k, l]) => (
            <button key={k} onClick={() => setShape(k)} style={chip(shape === k)}>{l}</button>
          ))}
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: T.textSecondary, fontWeight: 700, marginBottom: 10 }}>
          Zoom
          <input type="range" min="1" max="3" step="0.05" value={zoom} onChange={e => setZoom(Number(e.target.value))} style={{ flex: 1 }} />
        </label>
        <input value={text} onChange={e => setText(e.target.value.slice(0, 30))} placeholder="Texto (opcional)"
          style={{ width: '100%', boxSizing: 'border-box', padding: '11px 14px', borderRadius: 12, border: `1px solid ${T.border}`, background: T.bgInput, color: T.textPrimary, fontSize: 15, outline: 'none', marginBottom: 10 }} />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
          {['#ffffff', '#000000', '#FFC800', '#EE6C4D', '#3D5A80', '#22c55e'].map(c => (
            <button key={c} onClick={() => setColor(c)} aria-label={`Color ${c}`}
              style={{ width: 30, height: 30, borderRadius: '50%', background: c, border: `3px solid ${color === c ? '#3D5A80' : T.border}`, cursor: 'pointer' }} />
          ))}
          <span style={{ flex: 1 }} />
          <button onClick={() => setPos('top')} style={chip(pos === 'top')}>Arriba</button>
          <button onClick={() => setPos('bottom')} style={chip(pos === 'bottom')}>Abajo</button>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onCancel} style={{ flex: 1, background: T.bgHover, color: T.textPrimary, border: 'none', borderRadius: 14, padding: '13px 0', fontWeight: 800, fontSize: 14, cursor: 'pointer' }}>Cancelar</button>
          <button onClick={() => save(false)} disabled={!img} style={{ flex: 1, background: '#D5E6F0', color: '#3D5A80', border: 'none', borderRadius: 14, padding: '13px 0', fontWeight: 800, fontSize: 14, cursor: 'pointer' }}>Guardar</button>
          <button onClick={() => save(true)} disabled={!img} style={{ flex: 1.3, background: '#3D5A80', color: 'white', border: 'none', borderRadius: 14, padding: '13px 0', fontWeight: 800, fontSize: 14, cursor: 'pointer' }}>Guardar y enviar</button>
        </div>
      </div>
    </div>
  );
}
