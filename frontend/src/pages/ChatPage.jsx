/**
 * ChatPage - Chat 1 a 1 con ZEGOCLOUD ZIM
 *
 * DISEÑO DE IDs:
 *  - routeChatId (URL param) puede ser:
 *      a) 'user_XXX'               → viene de ContactsPage / tab Contactos
 *      b) 'chat_user_A_user_B'     → viene del tab CHATS (ChatList)
 *  - participantId: el ID ZIM del destinatario ('user_XXX')
 *  - msgChatId: clave compuesta usada en backend y store ('chat_user_A_user_B')
 *    Ambos usuarios calculan la misma clave porque [A,B].sort() es determinista.
 */
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore }  from '../store/authStore';
import { useChatStore }  from '../store/chatStore';
import { useZegoStore }  from '../store/zegoStore';
import { useThemeStore, DARK, LIGHT } from '../store/themeStore';
import { useGeolocation } from '../hooks/useGeolocation';
import Avatar from '../components/Avatar.jsx';

const CHAT_BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';

// Muestra hora exacta de la última conexión
function formatPresenceTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const diff = Date.now() - ts;
  const days = Math.floor(diff / 86_400_000);
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
  const { messages, addMessage, loadMessages, persistMessage, createOrGetChat, markAsRead, updateMessageStatus, deleteMessage } = useChatStore();
  const { getCurrentPosition, formatLocationMessage } = useGeolocation();

  const { zimEngine, zimConnected: connected, sendChatMessage, sendVideoCall, sendVoiceCall } = useZegoStore();
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
    const pingMyPresence = () => {
      fetch(`${CHAT_BACKEND}/presence`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id }),
      }).catch(() => {});
    };
    const fetchPresence = () => {
      fetch(`${CHAT_BACKEND}/presence/${encodeURIComponent(participantId)}`)
        .then(r => r.ok ? r.json() : { online: false, lastSeen: null })
        .then(d => setPresenceInfo({ online: d.online, lastSeen: d.lastSeen }))
        .catch(() => {});
    };
    pingMyPresence();
    fetchPresence();
    const interval = setInterval(() => { pingMyPresence(); fetchPresence(); }, 30_000);
    return () => clearInterval(interval);
  }, [user?.id, participantId]);

  // Scroll inteligente
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    isNearBottomRef.current = scrollHeight - scrollTop - clientHeight < 120;
  }, []);

  useEffect(() => {
    const isInitialLoad = prevMsgCountRef.current === 0;
    const hasNew = chatMessages.length > prevMsgCountRef.current;
    prevMsgCountRef.current = chatMessages.length;
    if (!hasNew) return;
    const lastMsg = chatMessages[chatMessages.length - 1];
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
      if (connected && !isGroup && participantId) {
        await sendChatMessage(participantId, sentText);
      }
    } catch (err) {
      console.log('Enviado vía backend:', err.message);
    } finally {
      setSending(false);
    }
  }, [text, sending, replyTo, msgChatId, participantId, isGroup, user, connected, sendChatMessage, addMessage, persistMessage]);

  // ── Enviar ubicación ──────────────────────────────────────────────────────
  const sendLocation = async () => {
    setShowAttachMenu(false);
    try {
      const pos = await getCurrentPosition();
      if (!pos) return;
      const locMsg = formatLocationMessage(pos);
      addMessage(msgChatId, {
        id: `loc_${Date.now()}`,
        text: locMsg.text,
        type: 'location',
        url: locMsg.url,
        sender: user.id,
        time: new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }),
        status: 'sent',
        isMine: true,
      });
      persistMessage(msgChatId, user.id, locMsg.text, 'location', locMsg.url);
    } catch {
      alert('No se pudo obtener la ubicación');
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

  // ── Enviar imagen o video ─────────────────────────────────────────────────
  const sendMediaFile = async (file) => {
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

    const dataUrl = await processFile();
    const msg = {
      id: `media_${Date.now()}`,
      type: isVideo ? 'video' : 'image',
      text: isVideo ? '[Video]' : '[Imagen]',
      url: dataUrl,
      sender: user.id,
      time: new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }),
      status: 'sending',
      isMine: true,
      replyTo: currentReply || null,
    };
    addMessage(msgChatId, msg);
    setReplyTo(null);
    try {
      await persistMessage(msgChatId, user.id, msg.text, msg.type, dataUrl, currentReply);
      if (connected && !isGroup && participantId) {
        await sendChatMessage(participantId, msg.text);
      }
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
        await persistMessage(msgChatId, user.id, '[Nota de voz]', 'audio', dataUrl);
        if (connected && !isGroup && participantId) {
          await sendChatMessage(participantId, '[Nota de voz]');
        }
      } catch { }
    };
    reader.readAsDataURL(blob);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const fmtTime = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  const BRAND = '#000080';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', background: T.bgMain, overflow: 'hidden' }}
      onClick={() => { if (showAttachMenu) setShowAttachMenu(false); }}>

      {/* Header */}
      <div style={{
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
          onClick={() => chat.avatar && setExpandedPhoto(chat.avatar)}>
          <Avatar name={chat.name} src={chat.avatar || null} size="md" />
          {chat.online && (
            <span style={{ position: 'absolute', bottom: 0, right: 0, width: 12, height: 12, background: '#4ade80', borderRadius: '50%', border: `2px solid ${T.bgSurface}` }} />
          )}
        </div>

        <div style={{ flex: 1 }}>
          <p style={{ fontWeight: 700, fontSize: 15, color: T.textPrimary, margin: 0, lineHeight: 1.2 }}>{chat.name}</p>
          <p style={{ fontSize: 11, color: isGroup ? T.textMuted : (presenceInfo.online ? BRAND : T.textMuted), margin: 0 }}>
            {isGroup
              ? 'Grupo'
              : presenceInfo.online
                ? '● en línea'
                : presenceInfo.lastSeen
                  ? `últ. vez ${formatPresenceTime(presenceInfo.lastSeen)}`
                  : 'OldFace'}
          </p>
        </div>

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
      </div>

      {/* Messages */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="scroll-hide"
        style={{ flex: 1, overflowY: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: 6 }}
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
            onDelete={(m) => deleteMessage(msgChatId, m.id)}
            onReply={(m) => setReplyTo({
              id:         m.id,
              text:       m.text,
              type:       m.type || 'text',
              senderName: m.isMine ? 'Tú' : (chat.name || participantId),
              isMine:     m.isMine,
            })}
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

      {/* Barra de respuesta */}
      {replyTo && (
        <div style={{
          background: isDark ? '#0a1628' : '#f0f4ff',
          borderTop: `2px solid ${BRAND}`,
          padding: '8px 12px',
          display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
        }}>
          <div style={{ width: 3, height: 44, background: BRAND, borderRadius: 4, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 11, fontWeight: 800, color: BRAND, margin: '0 0 2px' }}>
              {replyTo.senderName}
            </p>
            <p style={{ fontSize: 12, color: T.textSecondary, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {replyTo.type === 'location' ? '📍 Ubicación'
               : replyTo.type === 'audio' ? '🎤 Nota de voz'
               : replyTo.type === 'image' && !replyTo.url ? '🖼️ Imagen'
               : replyTo.type === 'video' && !replyTo.url ? '🎥 Video'
               : (replyTo.type === 'image' || replyTo.type === 'video') ? replyTo.text
               : replyTo.text?.length > 60 ? replyTo.text.slice(0, 60) + '…' : replyTo.text}
            </p>
          </div>
          {/* Thumbnail cuando se responde a un mensaje con imagen/vídeo */}
          {replyTo.url && (replyTo.type === 'image' || replyTo.type === 'video') && (
            replyTo.type === 'video'
              ? <video src={replyTo.url} style={{ width: 44, height: 44, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }} muted />
              : <img    src={replyTo.url} style={{ width: 44, height: 44, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }} />
          )}
          <button onClick={() => setReplyTo(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, flexShrink: 0 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={T.textMuted} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>
      )}

      {/* Emoji picker */}
      {showEmojiPicker && (
        <div style={{
          background: T.bgSurface,
          borderTop: `1px solid ${T.border}`,
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
          onChange={e => { sendMediaFile(e.target.files?.[0]); e.target.value = ''; }} />
        <input ref={cameraVideoRef} type="file" accept="video/*" capture="environment" style={{ display: 'none' }}
          onChange={e => { sendMediaFile(e.target.files?.[0]); e.target.value = ''; }} />
        <input ref={galleryInputRef} type="file" accept="image/*,video/*" style={{ display: 'none' }}
          onChange={e => { sendMediaFile(e.target.files?.[0]); e.target.value = ''; }} />
        <input ref={docInputRef} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.zip,.rar" style={{ display: 'none' }}
          onChange={e => {
            const file = e.target.files?.[0];
            if (file) {
              const reader = new FileReader();
              reader.onload = async () => {
                const dataUrl    = reader.result;
                const currentReply = replyTo;
                const zimText    = `[Archivo: ${file.name}]`;
                const localId    = `doc_${Date.now()}`;
                const msg = {
                  id:       localId,
                  type:     'document',
                  text:     zimText,
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
                  await persistMessage(msgChatId, user.id, zimText, 'document', fileUrl, currentReply, file.name);
                  // 3. Marcar como enviado
                  updateMessageStatus(msgChatId, localId, 'sent');
                  // 4. Notificar al destinatario por ZIM
                  if (participantId) sendChatMessage(participantId, zimText);
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

        {/* Botón cámara — acceso rápido a foto (más opciones en el menú adjuntos) */}
        {!isRecording && (
          <button onClick={() => { cameraPhotoRef.current?.click(); setShowAttachMenu(false); }}
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
          <button onClick={sendMessage} disabled={sending}
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

      {/* Visor fullscreen: documento */}
      {viewingDoc && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: '#111', display: 'flex', flexDirection: 'column' }}>
          {/* Cabecera */}
          <div style={{
            background: '#000080', padding: '0 14px 12px',
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
                background: docDownloading ? '#4a4a8a' : '#000080',
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
            <video
              src={expandedPhoto.src}
              controls
              autoPlay
              playsInline
              onClick={e => e.stopPropagation()}
              style={{ maxWidth: '96vw', maxHeight: '96vh', borderRadius: 12, outline: 'none' }}
            />
          ) : (
            <img
              src={typeof expandedPhoto === 'string' ? expandedPhoto : expandedPhoto.src}
              style={{ width: '100vw', maxHeight: '100vh', objectFit: 'contain' }}
            />
          )}
          <button
            onClick={() => setExpandedPhoto(null)}
            style={{ position: 'absolute', top: 20, right: 20, width: 40, height: 40, borderRadius: '50%', background: 'rgba(0,0,0,0.5)', border: '1.5px solid rgba(255,255,255,0.3)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}

// ── Reproductor de audio ────────────────────────────────────────────────────
function AudioPlayer({ src, isMine, isDark }) {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef(null);

  const fmtTime = (s) => {
    if (!s || !isFinite(s)) return '0:00';
    return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  };

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) { audio.pause(); setPlaying(false); }
    else { audio.play().then(() => setPlaying(true)).catch(() => {}); }
  };

  // Dark mode + enviado  → fondo azul oscuro → iconos blancos
  // Light mode + enviado → fondo azul claro (#dbeafe) → iconos azul oscuro
  // Recibido (ambos modos) → iconos azul oscuro
  const sentDark = isMine && isDark;
  const playBg    = sentDark ? 'rgba(255,255,255,0.22)' : '#000080';
  const iconColor = sentDark ? 'white' : 'white';
  const trackBg   = sentDark ? 'rgba(255,255,255,0.3)' : (isMine ? 'rgba(0,0,128,0.2)' : 'rgba(0,0,128,0.15)');
  const trackFill = sentDark ? 'rgba(255,255,255,0.9)' : '#000080';
  const timeColor = sentDark ? 'rgba(255,255,255,0.85)' : '#000066';
  const micColor  = sentDark ? 'rgba(255,255,255,0.7)' : '#000080';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 180, maxWidth: 240 }}>
      <audio
        ref={audioRef}
        src={src}
        onTimeUpdate={e => setProgress(e.target.currentTime)}
        onLoadedMetadata={e => setDuration(e.target.duration)}
        onEnded={() => { setPlaying(false); setProgress(0); }}
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
          {fmtTime(progress || 0)} / {fmtTime(duration)}
        </span>
      </div>

      <svg width="14" height="14" fill="none" stroke={micColor} strokeWidth="2" viewBox="0 0 24 24">
        <path d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </div>
  );
}

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
        <img src={thumb} style={{ display: 'block', maxWidth: '100%', maxHeight: 240, objectFit: 'cover', borderRadius: 12, width: '100%' }} alt="" />
      ) : (
        <div style={{ width: '100%', height: 160, background: '#1a1a2e', borderRadius: 12 }} />
      )}
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.28)', borderRadius: 12 }}>
        <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(255,255,255,0.88)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="18" height="18" fill="#000080" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ msg, isDark, T, onReply, onDelete, isGroup, memberNames = {}, onExpandPhoto, onViewDoc }) {
  const isLocation = msg.type === 'location';
  const isAudio    = msg.type === 'audio';
  const isImage    = msg.type === 'image';
  const isVideo    = msg.type === 'video';
  const isDocument = msg.type === 'document';
  const isContact  = msg.type === 'contact';
  const [showReplyBtn, setShowReplyBtn] = useState(false);
  const longPressRef = useRef(null);

  const sentBg   = isDark ? 'linear-gradient(135deg, #000066, #000080)' : '#dbeafe';
  const recvBg   = isDark ? '#0c1e3c' : 'white';
  const sentText  = isDark ? '#ffffff' : '#000066';
  const recvText  = isDark ? '#dce8ff' : '#1f2937';
  const timeColor = isDark ? '#93b8e0' : '#6b7280';
  const recvTime  = isDark ? '#3d5578' : '#9ca3af';

  const startPress = () => { longPressRef.current = setTimeout(() => setShowReplyBtn(true), 400); };
  const endPress   = () => { clearTimeout(longPressRef.current); };

  return (
    <div
      style={{ display: 'flex', justifyContent: msg.isMine ? 'flex-end' : 'flex-start', alignItems: 'flex-end', gap: 4, position: 'relative' }}
      onTouchStart={startPress} onTouchEnd={endPress}
      onMouseDown={startPress} onMouseUp={endPress} onMouseLeave={endPress}
    >
      {/* Botón responder — long press */}
      {showReplyBtn && (
        <div style={{
          position: 'absolute', [msg.isMine ? 'left' : 'right']: 0,
          top: '50%', transform: 'translateY(-50%)',
          display: 'flex', alignItems: 'center', gap: 2, zIndex: 10,
          background: isDark ? 'rgba(10,22,40,0.97)' : 'rgba(255,255,255,0.98)',
          borderRadius: 24, padding: '4px 6px',
          boxShadow: '0 2px 14px rgba(0,0,0,0.22)',
        }}>
          {/* Responder */}
          <button
            onClick={(e) => { e.stopPropagation(); onReply(msg); setShowReplyBtn(false); }}
            style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', cursor: 'pointer', padding: '5px 8px', borderRadius: 16, color: '#000080', fontSize: 12, fontWeight: 700 }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#000080" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 17H5a2 2 0 01-2-2V5a2 2 0 012-2h11a2 2 0 012 2v3"/>
              <path d="M13 21l-4-4 4-4"/><path d="M9 17h8a2 2 0 002-2v-5"/>
            </svg>
            Responder
          </button>

          {/* Separador */}
          <div style={{ width: 1, height: 20, background: isDark ? 'rgba(255,255,255,0.12)' : '#e5e7eb', flexShrink: 0 }} />

          {/* Eliminar */}
          <button
            onClick={(e) => { e.stopPropagation(); onDelete?.(msg); setShowReplyBtn(false); }}
            style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', cursor: 'pointer', padding: '5px 8px', borderRadius: 16, color: '#ef4444', fontSize: 12, fontWeight: 700 }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
              <path d="M10 11v6M14 11v6"/>
            </svg>
            Eliminar
          </button>

          {/* Cerrar */}
          <button onClick={() => setShowReplyBtn(false)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px 5px', color: T.textMuted, fontSize: 17, lineHeight: 1 }}>
            ×
          </button>
        </div>
      )}

      <div style={{
        maxWidth: (isAudio || isImage || isVideo) ? 280 : '78%',
        padding: (isImage || isVideo) ? '4px 4px 8px' : '9px 14px',
        borderRadius: msg.isMine ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
        background: msg.isMine ? sentBg : recvBg,
        boxShadow: isDark ? '0 1px 4px rgba(0,0,0,0.4)' : '0 1px 3px rgba(0,0,0,0.08)',
        overflow: 'hidden',
      }}>
        {/* Nombre remitente en grupos */}
        {isGroup && !msg.isMine && (
          <p style={{ fontSize: 12, fontWeight: 800, color: '#000080', margin: '0 0 4px', letterSpacing: '0.2px', paddingLeft: (isImage || isVideo) ? 8 : 0 }}>
            {memberNames[msg.sender] || msg.sender?.replace(/^user_/, '') || '?'}
          </p>
        )}

        {/* Cita del mensaje al que se responde */}
        {msg.replyTo && (
          <div style={{
            borderLeft: `3px solid ${msg.isMine ? 'rgba(255,255,255,0.6)' : '#000080'}`,
            background: 'rgba(0,0,0,0.28)',
            borderRadius: '0 6px 6px 0', padding: '4px 8px',
            margin: '0 0 6px',
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 12, fontWeight: 800, color: msg.isMine ? 'rgba(255,255,255,0.9)' : '#000080', margin: '0 0 2px' }}>
                {msg.replyTo.senderName}
              </p>
              <p style={{ fontSize: 12, color: msg.isMine ? 'rgba(255,255,255,0.75)' : T.textMuted, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>
                {msg.replyTo.type === 'location' ? '📍 Ubicación'
                 : msg.replyTo.type === 'audio' ? '🎤 Nota de voz'
                 : msg.replyTo.type === 'image' && !msg.replyTo.url ? '🖼️ Imagen'
                 : msg.replyTo.type === 'video' && !msg.replyTo.url ? '🎥 Video'
                 : (msg.replyTo.type === 'image' || msg.replyTo.type === 'video') ? msg.replyTo.text
                 : msg.replyTo.text?.length > 55 ? msg.replyTo.text.slice(0, 55) + '…' : msg.replyTo.text}
              </p>
            </div>
            {/* Thumbnail del estado — solo cuando hay imagen o vídeo */}
            {msg.replyTo.url && (msg.replyTo.type === 'image' || msg.replyTo.type === 'video') && (
              msg.replyTo.type === 'video'
                ? <video src={msg.replyTo.url} style={{ width: 44, height: 44, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }} muted />
                : <img    src={msg.replyTo.url} style={{ width: 44, height: 44, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }} />
            )}
          </div>
        )}

        {/* Contenido del mensaje */}
        {isImage ? (
          <img
            src={msg.url}
            onClick={() => onExpandPhoto?.(msg.url)}
            style={{ display: 'block', maxWidth: '100%', borderRadius: 12, maxHeight: 240, objectFit: 'cover', cursor: 'pointer' }}
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
              background: '#000080',
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
                color: msg.isMine ? (isDark ? '#dbeafe' : '#1e3a8a') : (isDark ? '#dce8ff' : '#1e3a8a'),
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
          <a href={msg.url} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 8, color: msg.isMine ? '#dbeafe' : '#000080', textDecoration: 'none' }}>
            <svg width="18" height="18" fill="currentColor" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
              <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
            </svg>
            <span style={{ fontSize: 14, fontWeight: 600 }}>Ver ubicación</span>
          </a>
        ) : isAudio ? (
          <AudioPlayer src={msg.url} isMine={msg.isMine} isDark={isDark} />
        ) : (
          <p style={{ fontSize: 15, color: msg.isMine ? sentText : recvText, fontWeight: 500, lineHeight: 1.5, margin: 0, whiteSpace: 'pre-wrap', padding: (isImage || isVideo) ? '0 8px' : 0 }}>
            {msg.text}
          </p>
        )}

        {/* Hora y estado */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4,
          marginTop: (isImage || isVideo) ? 2 : 4,
          padding: (isImage || isVideo) ? '0 8px' : 0,
        }}>
          <span style={{ fontSize: 12, color: msg.isMine ? timeColor : recvTime }}>{msg.time}</span>
          {msg.isMine && (
            <span style={{ fontSize: 12, color: msg.status === 'read' ? '#60a5fa' : timeColor }}>
              {msg.status === 'sending' ? '○' : msg.status === 'sent' ? '✓' : '✓✓'}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
