/**
 * zimStore — stub: zegoStore gestiona ZIM completo (login + eventos + mensajes).
 * Este store solo existe para no romper imports existentes.
 */
import { create } from 'zustand';

export const useZIMStore = create(() => ({
  engine:    null,
  connected: false,

  // No-op: zegoStore ya inicializa ZIM
  init: async (_user) => {},

  // Envío de texto via ZIM singleton (fallback, ChatPage usa zegoStore)
  sendMessage: async (toUserId, text) => {
    try {
      const { ZIM } = await import('zego-zim-web');
      const engine = ZIM.getInstance();
      if (!engine) return;
      await engine.sendMessage({ type: 1, message: text }, toUserId, 0, { priority: 2 });
    } catch (err) {
      console.warn('[ZIM-chat] sendMessage error:', err?.message);
    }
  },
}));
