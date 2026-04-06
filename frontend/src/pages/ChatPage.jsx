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

export default function ChatPage() {
  const { chatId: routeChatId } = useParams();
  const { state } = useLocation();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { messages, addMessage, loadMessages, persistMessage, createOrGetChat } = useChatStore();
  const { getCurrentPosition, formatLocationMessage } = useGeolocation();

  const { zimEngine, zimConnected: connected, sendChatMessage, sendVideoCall, sendVoiceCall } = useZegoStore();
  const { isDark } = useThemeStore();
  const T = isDark ? DARK : LIGHT;

  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  // ── Audio recording ───────────────────────────────────────────────────────
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const recordingTimerRef = useRef(null);

  const chat = state?.chat || { id: routeChatId, name: routeChatId };

  // ── Calcular participantId y msgChatId de forma consistente ───────────────
  const isComposite = routeChatId.startsWith('chat_');

  // ID del destinatario para ZIM ('user_XXX')
  const participantId = useMemo(() => {
    if (!user?.id) return routeChatId;
    if (!isComposite) return routeChatId;
    // 'chat_user_A_user_B' → extraer el ID que no es el mío
    const withoutChat = routeChatId.replace(/^chat_/, '');
    const parts = withoutChat.split(/_(?=user_)/);
    return parts.find(p => p !== user.id) || parts[1] || parts[0];
  }, [routeChatId, user?.id, isComposite]);

  // Clave de mensajes en backend y store (igual para ambos usuarios)
  const msgChatId = useMemo(() => {
    if (!user?.id) return routeChatId;
    if (isComposite) return routeChatId;
    return `chat_${[user.id, routeChatId].sort().join('_')}`;
  }, [routeChatId, user?.id, isComposite]);

  const chatMessages = messages[msgChatId] || [];

  // ── Cargar historial + asegurar que el chat existe en backend ─────────────
  useEffect(() => {
    if (!user?.id) return;
    loadMessages(msgChatId, user.id);
    createOrGetChat(user.id, participantId, chat.name);
  }, [msgChatId, user?.id]);

  // ── Polling cada 5 s — fallback si ZIM no entrega en tiempo real ──────────
  useEffect(() => {
    if (!user?.id) return;
    const interval = setInterval(() => {
      loadMessages(msgChatId, user.id);
    }, 5000);
    return () => clearInterval(interval);
  }, [msgChatId, user?.id]);

  // Scroll al fondo
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // Cleanup recording on unmount
  useEffect(() => {
    return () => {
      clearInterval(recordingTimerRef.current);
      if (mediaRecorderRef.current?.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

  // ── Enviar mensaje de texto ───────────────────────────────────────────────
  const sendMessage = useCallback(async () => {
    if (!text.trim() || sending) return;

    const msg = {
      id: `msg_${Date.now()}`,
      text: text.trim(),
      sender: user.id,
      time: new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }),
      status: 'sending',
      isMine: true,
    };

    addMessage(msgChatId, msg);
    const sentText = text.trim();
    setText('');
    setSending(true);

    try {
      await persistMessage(msgChatId, user.id, sentText);

      if (connected) {
        await sendChatMessage(participantId, sentText);
      }
    } catch (err) {
      console.log('Enviado vía backend (sin ZIM en tiempo real):', err.message);
    } finally {
      setSending(false);
    }
  }, [text, sending, msgChatId, participantId, user, connected, sendChatMessage, addMessage, persistMessage]);

  // ── Enviar ubicación ──────────────────────────────────────────────────────
  const sendLocation = async () => {
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

  // ── Grabación de audio ────────────────────────────────────────────────────
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : 'audio/mp4';

      const mr = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mr;
      audioChunksRef.current = [];

      mr.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mr.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        sendAudioNote(blob, mimeType);
      };

      mr.start(100); // collect data every 100ms
      setIsRecording(true);
      setRecordingTime(0);

      recordingTimerRef.current = setInterval(() => {
        setRecordingTime(t => {
          if (t >= 59) {
            stopRecording();
            return 60;
          }
          return t + 1;
        });
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

  const sendAudioNote = (blob, mimeType) => {
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result;
      const duration = recordingTime || 1;
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
        if (connected) {
          await sendChatMessage(participantId, '[Nota de voz]');
        }
      } catch { /* fallback: ya está en el store local */ }
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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', background: T.bgMain, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        backgroundColor: T.bgSurface,
        borderBottom: `1px solid ${T.border}`,
        padding: '0 14px 10px',
        paddingTop: 'env(safe-area-inset-top, 40px)',
        display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
      }}>
        <button onClick={() => navigate(-1)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, marginLeft: -4 }}>
          <svg width="24" height="24" fill="none" stroke={T.textPrimary} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
            <path d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <div style={{ position: 'relative' }}>
          <Avatar name={chat.name} size="md" />
          {chat.online && (
            <span style={{ position: 'absolute', bottom: 0, right: 0, width: 12, height: 12, background: '#4ade80', borderRadius: '50%', border: `2px solid ${T.bgSurface}` }} />
          )}
        </div>

        <div style={{ flex: 1 }}>
          <p style={{ fontWeight: 700, fontSize: 15, color: T.textPrimary, margin: 0, lineHeight: 1.2 }}>{chat.name}</p>
          <p style={{ fontSize: 11, color: connected ? BRAND : T.textMuted, margin: 0 }}>
            {connected ? '● en línea' : 'último visto hace poco'}
          </p>
        </div>

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
      </div>

      {/* Messages */}
      <div className="scroll-hide" style={{ flex: 1, overflowY: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {chatMessages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} isDark={isDark} T={T} />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div style={{
        background: T.bgSurface,
        borderTop: `1px solid ${T.border}`,
        padding: '10px 12px',
        paddingBottom: 'max(10px, env(safe-area-inset-bottom, 10px))',
        display: 'flex', alignItems: 'flex-end', gap: 8, flexShrink: 0,
      }}>
        {/* Botón izquierdo: ubicación (cuando no graba) */}
        {!isRecording && (
          <button onClick={sendLocation}
            style={{ width: 40, height: 40, borderRadius: '50%', background: T.bgHover, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="20" height="20" fill="none" stroke={T.textSecondary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
              <path d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        )}

        {/* Centro: input de texto o indicador de grabación */}
        {isRecording ? (
          <div style={{
            flex: 1, background: T.bgInput, borderRadius: 22, padding: '10px 16px',
            height: 42, display: 'flex', alignItems: 'center', gap: 10,
            border: `1.5px solid #ef4444`,
          }}>
            <div style={{
              width: 10, height: 10, borderRadius: '50%', background: '#ef4444',
              animation: 'recBlink 1s ease infinite',
              flexShrink: 0,
            }} />
            <span style={{ fontSize: 14, color: '#ef4444', fontWeight: 700, flex: 1 }}>
              Grabando {fmtTime(recordingTime)}
            </span>
            <span style={{ fontSize: 11, color: T.textMuted }}>máx 1:00</span>
            <style>{`@keyframes recBlink { 0%,100%{opacity:1} 50%{opacity:0.2} }`}</style>
          </div>
        ) : (
          <div style={{ flex: 1, background: T.bgInput, borderRadius: 22, padding: '10px 16px', minHeight: 42, maxHeight: 128, display: 'flex', alignItems: 'center', border: `1px solid ${T.border}` }}>
            <textarea
              ref={inputRef}
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Mensaje..."
              rows={1}
              style={{ width: '100%', resize: 'none', outline: 'none', fontSize: 14, fontWeight: 500, color: T.textPrimary, background: 'transparent', maxHeight: 80, lineHeight: 1.5 }}
            />
          </div>
        )}

        {/* Botón derecho: enviar texto / micrófono / detener grabación */}
        {text.trim() && !isRecording ? (
          <button onClick={sendMessage} disabled={sending}
            style={{ width: 40, height: 40, borderRadius: '50%', background: BRAND, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, opacity: sending ? 0.7 : 1 }}>
            <svg width="18" height="18" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" style={{ transform: 'translateX(1px)' }}>
              <path d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        ) : isRecording ? (
          /* Detener grabación y enviar */
          <button onClick={stopRecording}
            style={{ width: 40, height: 40, borderRadius: '50%', background: '#ef4444', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="16" height="16" fill="white" viewBox="0 0 24 24">
              <rect x="5" y="5" width="14" height="14" rx="2" />
            </svg>
          </button>
        ) : (
          /* Iniciar grabación */
          <button onClick={startRecording}
            style={{ width: 40, height: 40, borderRadius: '50%', background: BRAND, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="18" height="18" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
              <path d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

// ── Reproductor de audio ────────────────────────────────────────────────────
function AudioPlayer({ src, isMine }) {
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

      {/* Play/Pause */}
      <button onClick={toggle} style={{
        width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
        background: isMine ? 'rgba(255,255,255,0.25)' : '#000080',
        border: 'none', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {playing ? (
          <svg width="14" height="14" fill={isMine ? '#dbeafe' : 'white'} viewBox="0 0 24 24">
            <rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>
          </svg>
        ) : (
          <svg width="14" height="14" fill={isMine ? '#dbeafe' : 'white'} viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z"/>
          </svg>
        )}
      </button>

      {/* Waveform / barra de progreso */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div
          style={{ height: 4, borderRadius: 4, background: isMine ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,128,0.15)', cursor: 'pointer', position: 'relative' }}
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
            height: '100%', borderRadius: 4,
            background: isMine ? 'rgba(255,255,255,0.7)' : '#000080',
            width: duration ? `${(progress / duration) * 100}%` : '0%',
            transition: 'width 0.1s linear',
          }} />
        </div>
        <span style={{ fontSize: 10, color: isMine ? 'rgba(255,255,255,0.6)' : '#6b7280' }}>
          {fmtTime(progress || 0)} / {fmtTime(duration)}
        </span>
      </div>

      {/* Icono micrófono */}
      <svg width="14" height="14" fill="none" stroke={isMine ? 'rgba(255,255,255,0.5)' : '#9ca3af'} strokeWidth="2" viewBox="0 0 24 24">
        <path d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </div>
  );
}

function MessageBubble({ msg, isDark, T }) {
  const isLocation = msg.type === 'location';
  const isAudio    = msg.type === 'audio';

  const sentBg   = isDark ? 'linear-gradient(135deg, #000066, #000080)' : '#dbeafe';
  const recvBg   = isDark ? '#0c1e3c' : 'white';
  const sentText  = isDark ? '#dbeafe' : '#000066';
  const recvText  = isDark ? '#dce8ff' : '#1f2937';
  const timeColor = isDark ? '#4d7aad' : '#9ca3af';
  const recvTime  = isDark ? '#3d5578' : '#9ca3af';

  return (
    <div style={{ display: 'flex', justifyContent: msg.isMine ? 'flex-end' : 'flex-start' }}>
      <div style={{
        maxWidth: isAudio ? 280 : '78%',
        padding: '9px 14px',
        borderRadius: msg.isMine ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
        background: msg.isMine ? sentBg : recvBg,
        boxShadow: isDark ? '0 1px 4px rgba(0,0,0,0.4)' : '0 1px 3px rgba(0,0,0,0.08)',
      }}>
        {isLocation ? (
          <a href={msg.url} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#000080', textDecoration: 'none' }}>
            <svg width="18" height="18" fill="currentColor" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
              <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
            </svg>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Ver ubicación</span>
          </a>
        ) : isAudio ? (
          <AudioPlayer src={msg.url} isMine={msg.isMine} />
        ) : (
          <p style={{ fontSize: 14, color: msg.isMine ? sentText : recvText, fontWeight: 500, lineHeight: 1.5, margin: 0, whiteSpace: 'pre-wrap' }}>{msg.text}</p>
        )}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4, marginTop: 4 }}>
          <span style={{ fontSize: 11, color: msg.isMine ? timeColor : recvTime }}>{msg.time}</span>
          {msg.isMine && (
            <span style={{ fontSize: 11, color: msg.status === 'read' ? '#60a5fa' : timeColor }}>
              {msg.status === 'sending' ? '○' : msg.status === 'sent' ? '✓' : '✓✓'}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
