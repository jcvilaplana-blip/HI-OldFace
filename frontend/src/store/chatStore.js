/**
 * Store de chats y mensajes
 */
import { create } from 'zustand';

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';

export const useChatStore = create((set, get) => ({
  chats: [],
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
        const data = await res.json();
        const mapped = (data.chats || []).map(c => ({
          ...c,
          lastTime: c.lastTime
            ? new Date(c.lastTime).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
            : '',
        }));
        set({ chats: mapped });
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
            ? new Date(chat.lastTime).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
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
  loadMessages: async (chatId, userId) => {
    try {
      const res = await fetch(`${BACKEND}/messages/${encodeURIComponent(chatId)}`);
      if (res.ok) {
        const data = await res.json();
        const mapped = (data.messages || []).map(m => ({
          id:     m.id,
          text:   m.text,
          sender: m.senderId,
          time:   m.time,
          type:   m.type || 'text',
          url:    m.url || null,
          status: 'received',
          isMine: m.senderId === userId,
        }));
        set((state) => ({ messages: { ...state.messages, [chatId]: mapped } }));
      }
    } catch (err) {
      console.warn('[chatStore] loadMessages error:', err.message);
    }
  },

  /** Persiste un mensaje en el backend */
  persistMessage: async (chatId, senderId, text, type = 'text', url = null) => {
    try {
      await fetch(`${BACKEND}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId, senderId, text, type, url }),
      });
    } catch {
      // Fallo silencioso — el mensaje ya está en el store local
    }
  },
}));
