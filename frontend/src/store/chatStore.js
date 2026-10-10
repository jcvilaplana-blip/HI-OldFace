/**
 * Store de chats y mensajes
 */
import { create } from 'zustand';
import { playMessageSound } from '../utils/sounds.js';
import { tr, LOCALE } from '../i18n';

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';

/** Hora del mensaje en la zona horaria del móvil (el servidor está en UTC; `time` solo para mensajes antiguos) */
export const msgTime = (m) => (m?.createdAt
  ? new Date(m.createdAt).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' })
  : m?.time || '');

// ── Copia local (localStorage) de la lista de chats y de los últimos mensajes de cada chat ──
// Al abrir la app o un chat se pinta al instante con lo último que se vio y luego se actualiza con el servidor.
const MSG_CACHE = 'oldface-msgs:';
const CHATS_CACHE = 'oldface-chats:';
const MSG_CACHE_MAX = 200;
const myId = () => { try { return JSON.parse(localStorage.getItem('oldface-auth'))?.state?.user?.id || ''; } catch { return ''; } };
const readJSON = (key) => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } };
const writeJSON = (key, v) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* sin espacio: no pasa nada */ } };

const msgCacheMem = new Map();   // chatId → mensajes leídos de localStorage (para no parsear en cada render)
/** Últimos mensajes guardados de un chat (o null) — para pintar el chat antes de que conteste el servidor */
export function cachedMessages(chatId) {
  if (!msgCacheMem.has(chatId)) msgCacheMem.set(chatId, readJSON(MSG_CACHE + chatId));
  return msgCacheMem.get(chatId);
}
function saveMessageCache(chatId, list) {
  const keep = list.filter(m => m.status !== 'sending' && m.status !== 'error').slice(-MSG_CACHE_MAX)
    .map(m => (/^(data|blob):/.test(m.url || '') ? { ...m, url: null } : m));
  msgCacheMem.set(chatId, keep);
  writeJSON(MSG_CACHE + chatId, keep);
}

// Última respuesta del servidor por chat: si no ha cambiado nada no se toca el estado (sin repintar cada 5 s)
const lastMessagesRaw = new Map();
let lastChatsRaw = '';

export const useChatStore = create((set, get) => ({
  chats: readJSON(CHATS_CACHE + myId()) || [],
  activeChat: null,
  messages: {},

  setChats: (chats) => set({ chats }),

  setActiveChat: (chat) => set({ activeChat: chat }),

  addMessage: (chatId, message) => set((state) => ({
    messages: {
      ...state.messages,
      [chatId]: [...(state.messages[chatId] || []), message]
    }
  })),

  setMessages: (chatId, messages) => set((state) => ({
    messages: { ...state.messages, [chatId]: messages }
  })),

  updateMessageStatus: (chatId, messageId, status) => set((state) => ({
    messages: {
      ...state.messages,
      [chatId]: (state.messages[chatId] || []).map(msg =>
        msg.id === messageId ? { ...msg, status } : msg
      )
    }
  })),

  addChat: (chat) => set((state) => {
    const exists = state.chats.some(c => c.id === chat.id);
    if (exists) return state;
    return { chats: [chat, ...state.chats] };
  }),

  updateChatLastMessage: (chatId, lastMessage, lastTime) => set((state) => ({
    chats: state.chats.map(c =>
      c.id === chatId ? { ...c, lastMessage, lastTime } : c
    )
  })),

  // ── Backend integration ──────────────────────────────────────────

  /** Carga todos los chats del usuario desde el backend */
  fetchChats: async (userId) => {
    try {
      const res = await fetch(`${BACKEND}/chats?userId=${encodeURIComponent(userId)}`);
      if (res.ok) {
        const raw = await res.text();
        if (raw === lastChatsRaw && get().chats.length) return;   // nada nuevo
        lastChatsRaw = raw;
        const data = JSON.parse(raw);
        const mapped = await Promise.all((data.chats || []).map(async (c) => {
          let name = c.name;
          // Si el nombre es un userId (user_XXXXXXXX), intentar resolverlo al nombre real
          if (name && name.startsWith('user_')) {
            try {
              const ur = await fetch(`${BACKEND}/find-user-by-id?userId=${encodeURIComponent(name)}`);
              if (ur.ok) {
                const ud = await ur.json();
                if (ud.name && !ud.name.startsWith('user_')) name = ud.name;
                else if (ud.phone) name = ud.phone;
              }
            } catch { /* silencioso */ }
            // Último recurso: formatear como número de teléfono
            if (name.startsWith('user_')) name = '+' + name.replace(/^user_/, '');
          }
          return {
            ...c,
            name,
            lastTime: c.lastTime
              ? new Date(c.lastTime).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' })
              : '',
          };
        }));
        set({ chats: mapped });
        writeJSON(CHATS_CACHE + userId, mapped);
      }
    } catch (err) {
      console.warn('[chatStore] fetchChats error:', err.message);
    }
  },

  /** Crea o recupera un chat 1-a-1 entre dos usuarios */
  createOrGetChat: async (userId1, userId2, name) => {
    try {
      const res = await fetch(`${BACKEND}/chats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId1, userId2, name }),
      });
      if (res.ok) {
        const chat = await res.json();
        const mapped = {
          ...chat,
          lastTime: chat.lastTime
            ? new Date(chat.lastTime).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' })
            : '',
        };
        get().addChat(mapped);
        return mapped;
      }
    } catch (err) {
      console.warn('[chatStore] createOrGetChat error:', err.message);
    }
    return null;
  },

  /** Carga el historial de mensajes de un chat desde el backend */
  loadMessages: async (chatId, userId, participantId = null) => {
    try {
      const res = await fetch(`${BACKEND}/messages/${encodeURIComponent(chatId)}?userId=${encodeURIComponent(userId || '')}`);
      if (res.ok) {
        const raw = await res.text();
        const rawKey = `${chatId}|${participantId || ''}`;
        // Igual que la última vez y ya en pantalla → no repintar el chat entero (pasaba cada 5 s)
        if (raw === lastMessagesRaw.get(rawKey) && get().messages[chatId]) return;
        lastMessagesRaw.set(rawKey, raw);
        const data = JSON.parse(raw);
        const mapped = (data.messages || []).map(m => {
          const isMine = m.senderId === userId;
          let status = 'received';
          if (isMine) {
            const readBy = Array.isArray(m.readBy) ? m.readBy : [];
            status = (participantId && readBy.includes(participantId)) ? 'read' : 'sent';
          }
          return {
            id:       m.id,
            text:     m.text,
            sender:   m.senderId,
            time:     msgTime(m),
            type:     m.type || 'text',
            url:      m.url || null,
            replyTo:  m.replyTo || null,
            fileName: m.fileName || null,   // ← antes faltaba: documentos perdían el nombre
            duration: m.duration || null,   // segundos de la nota de voz
            live:     m.live || null,       // ubicación en tiempo real { lat, lng, until, updatedAt, stopped }
            createdAt: m.createdAt || null,
            editedAt: m.editedAt || null,   // "editado"
            deleted:  !!m.deleted,          // eliminado para todos
            viewOnce: !!m.viewOnce,         // foto/vídeo "ver una vez" (sin url: se pide al abrir)
            opened:   Array.isArray(m.openedBy) && (isMine ? m.openedBy.length > 0 : m.openedBy.includes(userId)),
            pinned:   !!m.pinned,           // fijado arriba del chat
            pinnedAt: m.pinnedAt || null,
            starred:  Array.isArray(m.starredBy) && m.starredBy.includes(userId),   // destacado por mí
            status,
            isMine,
          };
        });

        // Detectar mensajes nuevos de otros (polling) — reproducir sonido (no al pasar de la copia local al servidor)
        const prev = get().messages[chatId] || [];
        if (prev.length > 0 && mapped.length > prev.length) {
          const newMsgs = mapped.slice(prev.length);
          const hasNewFromOther = newMsgs.some(m => m.sender !== userId);
          if (hasNewFromOther) playMessageSound();
        }

        // ── Preservar mensajes optimistas que aún están en tránsito ──────────
        // Si el usuario acaba de enviar un archivo (status='sending'), ese mensaje
        // vive solo en local mientras el upload (persistMessage) está en curso.
        // loadMessages NO debe borrarlo; lo eliminamos solo cuando el backend
        // devuelva una coincidencia (mismo sender + texto + tipo).
        const localMsgs = get().messages[chatId] || [];
        const pendingLocal = localMsgs.filter(lm => {
          if (lm.status !== 'sending') return false;
          // ¿Ya está confirmado por el backend?
          const confirmedInBackend = mapped.some(bm =>
            bm.sender === lm.sender &&
            bm.text   === lm.text   &&
            bm.type   === (lm.type || 'text')
          );
          return !confirmedInBackend;
        });

        set((state) => ({
          messages: {
            ...state.messages,
            [chatId]: [...mapped, ...pendingLocal],
          },
        }));
        saveMessageCache(chatId, mapped);
      }
    } catch (err) {
      console.warn('[chatStore] loadMessages error:', err.message);
    }
  },

  /** Marca todos los mensajes del chat como leídos por el usuario (para ✓✓ azul) */
  markAsRead: async (chatId, userId) => {
    try {
      await fetch(`${BACKEND}/messages/${encodeURIComponent(chatId)}/mark-read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
    } catch { /* silencioso */ }
  },

  /** Elimina un chat y sus mensajes en backend + store local */
  deleteChat: async (chatId) => {
    try {
      await fetch(`${BACKEND}/chats/${encodeURIComponent(chatId)}`, { method: 'DELETE' });
    } catch { /* silencioso */ }
    msgCacheMem.delete(chatId);
    lastMessagesRaw.forEach((_, k) => { if (k.startsWith(`${chatId}|`)) lastMessagesRaw.delete(k); });
    try { localStorage.removeItem(MSG_CACHE + chatId); } catch { /* nada */ }
    set((state) => {
      const messages = { ...state.messages };
      delete messages[chatId];
      return {
        chats: state.chats.filter(c => c.id !== chatId),
        messages,
      };
    });
  },

  /** Elimina un mensaje concreto en backend + store local */
  deleteMessage: async (chatId, messageId) => {
    try {
      await fetch(`${BACKEND}/messages/${encodeURIComponent(chatId)}/${encodeURIComponent(messageId)}`, { method: 'DELETE' });
    } catch { /* silencioso */ }
    set((state) => ({
      messages: {
        ...state.messages,
        [chatId]: (state.messages[chatId] || []).filter(m => m.id !== messageId),
      },
    }));
  },

  /**
   * Eliminar mensajes: scope 'me' (solo desaparecen para mí) o 'all' (para todos, sin dejar rastro; solo los míos).
   */
  deleteMessagesScoped: async (chatId, messageIds, scope, userId) => {
    const ids = new Set(messageIds);
    await Promise.all([...ids].map(id =>
      fetch(`${BACKEND}/messages/${encodeURIComponent(chatId)}/${encodeURIComponent(id)}?scope=${scope}&userId=${encodeURIComponent(userId)}`,
            { method: 'DELETE' }).catch(() => {})));
    // 'all' tampoco deja rastro: desaparece y se quita la cita de las respuestas
    set((state) => ({
      messages: { ...state.messages, [chatId]: (state.messages[chatId] || []).filter(m => !ids.has(m.id))
        .map(m => scope === 'all' && m.replyTo && ids.has(m.replyTo.id) ? { ...m, replyTo: null } : m) },
    }));
  },

  /** Editar un mensaje de texto propio (hasta 15 min). Devuelve null si fue bien o el texto del error */
  editMessage: async (chatId, messageId, userId, text) => {
    try {
      const res = await fetch(`${BACKEND}/messages/${encodeURIComponent(chatId)}/${encodeURIComponent(messageId)}/edit`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId, text }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return data.error || tr('No se pudo editar');
      set((state) => ({
        messages: { ...state.messages, [chatId]: (state.messages[chatId] || []).map(m => m.id === messageId
          ? { ...m, text: data.message.text, editedAt: data.message.editedAt } : m) },
      }));
      return null;
    } catch { return tr('Sin conexión'); }
  },

  /** Fijar (para todos) o destacar (para mí) un mensaje: flags = { pinned } o { starred } */
  setMessageFlags: async (chatId, messageId, userId, flags) => {
    set((state) => ({
      messages: { ...state.messages, [chatId]: (state.messages[chatId] || []).map(m => m.id === messageId
        ? { ...m, ...('pinned' in flags ? { pinned: flags.pinned, pinnedAt: flags.pinned ? Date.now() : null } : {}),
                  ...('starred' in flags ? { starred: flags.starred } : {}) } : m) },
    }));
    try {
      await fetch(`${BACKEND}/messages/${encodeURIComponent(chatId)}/${encodeURIComponent(messageId)}/flags`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId, ...flags }),
      });
    } catch { /* se corrige en la siguiente carga */ }
  },

  /** Elimina varios mensajes a la vez (selección múltiple) */
  deleteMessages: async (chatId, messageIds) => {
    const ids = new Set(messageIds);
    await Promise.all([...ids].map(id =>
      fetch(`${BACKEND}/messages/${encodeURIComponent(chatId)}/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {})));
    set((state) => ({
      messages: { ...state.messages, [chatId]: (state.messages[chatId] || []).filter(m => !ids.has(m.id)) },
    }));
  },

  /**
   * Persiste un mensaje en el backend. `extra`: { duration } (nota de voz) · { live } (ubicación en tiempo real).
   * Devuelve el mensaje guardado (con su id) o null.
   */
  persistMessage: async (chatId, senderId, text, type = 'text', url = null, replyTo = null, fileName = null, extra = {}) => {
    try {
      const res = await fetch(`${BACKEND}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId, senderId, text, type, url, replyTo, fileName, ...extra }),
      });
      return res.ok ? await res.json() : null;
    } catch {
      return null;   // Fallo silencioso — el mensaje ya está en el store local
    }
  },
}));
