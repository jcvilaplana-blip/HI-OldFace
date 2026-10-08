/**
 * callStore — llamadas y señalización en tiempo real con el servidor RTC propio (sin terceros).
 *
 *   · Conexión Socket.IO con el servidor RTC (rtcClient) una vez por sesión.
 *   · Señales de llamada entre usuarios:
 *       call_invite → { callType, callerName, roomId }
 *       call_accept / call_reject / call_cancel / call_end
 *   · Mensajes de chat entregados al instante (chat:message, los emite el backend al guardar).
 *   · Si el destinatario no está conectado, el backend le avisa por notificación push (FCM).
 */
import { create } from 'zustand';
import { playMessageSound } from '../utils/sounds.js';
import { connectRtc, ensureRtcConnected, sendSignal, isRtcConnected } from '../utils/rtcClient.js';
import { groupIdFromRoom, startGroupCallApi } from '../utils/groupsApi.js';

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';

// Se conecta una sola vez por sesión
let rtcStartedFor = null;
// Temporizador de llamada perdida (modal de llamada entrante)
let incomingTimeout = null;

/** Push FCM al destinatario (despierta la app si está cerrada) + señal en vivo desde el backend */
async function notifyCall(calleeId, callType, roomId = '') {
  try {
    const { useAuthStore } = await import('./authStore');
    const user = useAuthStore.getState().user;
    if (!user?.id) return;
    await fetch(`${BACKEND}/call-notification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ calleeId, callerId: user.id, callerName: user.name || user.id, callType, roomId, media: 'oldface' }),
    });
  } catch { /* silencioso */ }
}

/** Colgar → si el otro móvil aún está sonando (pantalla nativa, app cerrada), deja de sonar */
async function notifyCallCancel(calleeId) {
  try {
    const { useAuthStore } = await import('./authStore');
    const user = useAuthStore.getState().user;
    if (!user?.id || !calleeId) return;
    await fetch(`${BACKEND}/call-cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ calleeId, callerId: user.id }),
    });
  } catch { /* silencioso */ }
}

/** App Android en segundo plano → la llamada la muestra la pantalla nativa (no el modal web) */
const nativeHandlesCall = () => {
  try { return !!window.OldFaceCalls && !window.OldFaceCalls.isForeground(); } catch { return false; }
};

export const useCallStore = create((set, get) => ({
  rtcConnected:   false,

  // ── Estado de llamadas ────────────────────────────────────────────────────
  incomingCall:   null,   // { callType, callerId, callerName, isVideo, roomId }
  callError:      null,   // mensaje de error toast
  pendingCallOut: null,   // { calleeId, calleeName, callType, roomId } → AppShell navega
  callAccepted:   null,   // { callerId, callerName, callType, roomId } → AppShell navega
  callRejected:   false,  // VideoCallPage/CallPage lo escucha para salir
  callEnded:      false,  // la otra parte colgó → pages salen
  pendingFCMCall: null,   // { callType, callerId, callerName, roomId } desde FCM tap
  activeGroupRoom: null,  // sala de la llamada de grupo en la que estoy (GroupCallPage)

  setCallError: (msg) => {
    set({ callError: msg });
    setTimeout(() => set({ callError: null }), 3500);
  },

  // ── Llamada entrante: muestra el modal Aceptar/Rechazar (App.jsx) ─────────
  // Se usa tanto para señales en vivo como al tocar la notificación push.
  // Llamada de grupo: la reconoce el roomId (gcall__<groupId>__…) aunque no venga groupId (aviso push / pantalla nativa).
  showIncomingCall: ({ callerId, callerName, callType, roomId, groupId, groupName }) => {
    const type = callType || 'video';
    const gid = groupId || groupIdFromRoom(roomId);
    // Ya estoy dentro de esa llamada de grupo (p. ej. me invitan otra vez) → nada que mostrar
    if (gid && roomId && get().activeGroupRoom === roomId) return;
    set({
      incomingCall: {
        callType:   type,
        callerId,
        callerName: callerName || callerId,
        isVideo:    type === 'video',
        roomId:     roomId || null,
        groupId:    gid || null,
        groupName:  groupName || (gid ? String(callerName || '').split(' · ')[0] : null),
      },
    });
    // Sin respuesta en 60 s → llamada perdida, se cierra el modal
    clearTimeout(incomingTimeout);
    incomingTimeout = setTimeout(() => {
      if (get().incomingCall?.callerId === callerId) set({ incomingCall: null });
    }, 60000);
  },

  // ── Señales de llamada recibidas ──────────────────────────────────────────
  _handleCallSignal: ({ type, from, fromName, payload = {}, ts }) => {
    if (type === 'call_invite') {
      // Ignorar invitaciones viejas (p. ej. entregadas al reconectar)
      const age = Date.now() - (ts || 0);
      if (age > 30000) { console.log('[Señal] call_invite obsoleto ignorado (age:', age, 'ms)'); return; }
      if (nativeHandlesCall()) return;
      console.log('[Señal] Llamada entrante de:', from, payload);
      get().showIncomingCall({ callerId: from, callerName: payload.callerName || fromName, callType: payload.callType, roomId: payload.roomId,
                               groupId: payload.groupId, groupName: payload.groupName });
    }
    // En una llamada de grupo, que alguien rechace o cuelgue no afecta a los demás
    else if (type === 'call_reject') { if (!get().activeGroupRoom) set({ callRejected: true }); }
    else if (type === 'call_cancel' || type === 'call_end') {
      // Si aún está sonando (no se ha aceptado), solo se cierra el modal.
      // No marcar callEnded: quedaría activo y cerraría la SIGUIENTE llamada al abrirse.
      const ic = get().incomingCall;
      if (ic && (ic.callerId === from || (payload.roomId && ic.roomId === payload.roomId))) { set({ incomingCall: null }); return; }
      if (type === 'call_end' && !get().activeGroupRoom) set({ callEnded: true });
    }
    // call_accept: no requiere acción (la sala ya está abierta)
  },

  /** Envía una señal de llamada por el servidor RTC */
  sendCallSignal: (to, type, payload = {}) => {
    if (type === 'call_end' || type === 'call_cancel') notifyCallCancel(to);
    if (!isRtcConnected()) return Promise.resolve(false);
    return sendSignal(to, type, payload);
  },

  // ── Mensaje de chat entregado por el servidor RTC ─────────────────────────
  _handleChatPush: (user, msg) => {
    if (!msg?.chatId || msg.senderId === user.id) return;
    import('./chatStore').then(({ useChatStore, msgTime }) => {
      const { addMessage, createOrGetChat, fetchChats } = useChatStore.getState();
      const existing = useChatStore.getState().messages[msg.chatId] || [];
      if (!existing.some(m => m.id === msg.id)) {
        addMessage(msg.chatId, {
          id:       msg.id,
          text:     msg.text,
          sender:   msg.senderId,
          time:     msgTime(msg),
          createdAt: msg.createdAt || null,
          type:     msg.type || 'text',
          url:      msg.url || null,
          replyTo:  msg.replyTo || null,
          fileName: msg.fileName || null,
          duration: msg.duration || null,
          live:     msg.live || null,
          viewOnce: !!msg.viewOnce,
          opened:   false,
          status:   'received',
          isMine:   false,
        });
        playMessageSound();
      }
      if (msg.chatId.startsWith('chat_')) {
        createOrGetChat(user.id, msg.senderId, msg.senderName || msg.senderId).then(() => fetchChats(user.id));
      } else {
        fetchChats(user.id);
      }
    });
  },

  /** Un chat cambió (leído, editado, eliminado…): si sus mensajes están cargados, recargarlos ya */
  _handleChatUpdate: (user, d) => {
    if (!d?.chatId) return;
    import('./chatStore').then(({ useChatStore }) => {
      const st = useChatStore.getState();
      if (!st.messages[d.chatId]) return;
      const other = d.chatId.startsWith('chat_')
        ? d.chatId.replace(/^chat_/, '').split(/_(?=user_)/).find(p => p !== user.id) : null;
      st.loadMessages(d.chatId, user.id, other);
    });
  },

  // ── Conectar con el servidor RTC propio (una vez por sesión) ──────────────
  init: async (user) => {
    if (!user?.id || rtcStartedFor === user.id) return;
    rtcStartedFor = user.id;
    try {
      await connectRtc(user, {
        onSignal:           (sig) => get()._handleCallSignal(sig),
        onChatMessage:      (msg) => get()._handleChatPush(user, msg),
        onChatUpdate:       (d)   => get()._handleChatUpdate(user, d),
        onConnectionChange: (ok)  => set({ rtcConnected: ok }),
      });
      console.log('[RTC] Conectado como', user.id);
    } catch (err) {
      console.warn('[RTC] No se pudo conectar:', err.message);
      rtcStartedFor = null;   // se reintenta en el próximo init / al llamar
    }
  },

  /** Asegura la conexión antes de llamar (por si se perdió) */
  _ensureConnected: async () => {
    if (isRtcConnected()) return true;
    try {
      const { useAuthStore } = await import('./authStore');
      const user = useAuthStore.getState().user;
      if (!user?.id) return false;
      if (rtcStartedFor !== user.id) await get().init(user);   // crea el socket con sus eventos
      await ensureRtcConnected(user, 6000);                     // y espera a que conecte
      return isRtcConnected();
    } catch { return false; }
  },

  setPendingFCMCall: (data) => set({ pendingFCMCall: data }),
  clearPendingFCMCall: () => set({ pendingFCMCall: null }),

  // ── Iniciar llamada saliente ──────────────────────────────────────────────
  sendVideoCall: async (calleeId, calleeName) => {
    if (!(await get()._ensureConnected())) {
      get().setCallError('Sin conexión — espera un momento e inténtalo de nuevo');
      return;
    }
    const roomId = `room_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    notifyCall(calleeId, 'video', roomId);
    set({ pendingCallOut: { calleeId, calleeName, callType: 'video', roomId } });
  },

  sendVoiceCall: async (calleeId, calleeName) => {
    if (!(await get()._ensureConnected())) {
      get().setCallError('Sin conexión — espera un momento e inténtalo de nuevo');
      return;
    }
    notifyCall(calleeId, 'voice', '');
    set({ pendingCallOut: { calleeId, calleeName, callType: 'voice' } });
  },

  clearPendingCall: () => set({ pendingCallOut: null }),

  /** Llamada de grupo: la crea (o se une a la que ya está en curso) y AppShell abre GroupCallPage */
  startGroupCall: async (groupId, groupName, callType = 'voice') => {
    if (!(await get()._ensureConnected())) {
      get().setCallError('Sin conexión — espera un momento e inténtalo de nuevo');
      return;
    }
    try {
      const { useAuthStore } = await import('./authStore');
      const user = useAuthStore.getState().user;
      const r = await startGroupCallApi(groupId, user.id, callType);
      set({ pendingCallOut: { groupId, groupName: r.groupName || groupName, callType: r.callType, roomId: r.roomId, joined: r.joined } });
    } catch (err) {
      get().setCallError(err.message || 'No se pudo iniciar la llamada');
    }
  },

  setActiveGroupRoom: (roomId) => set({ activeGroupRoom: roomId || null }),

  // ── Aceptar llamada entrante ──────────────────────────────────────────────
  acceptCall: () => {
    const { incomingCall } = get();
    if (!incomingCall) return;
    if (incomingCall.callerId && !incomingCall.groupId) get().sendCallSignal(incomingCall.callerId, 'call_accept');
    set({
      callAccepted: {
        callerId:   incomingCall.callerId,
        callerName: incomingCall.callerName,
        callType:   incomingCall.callType,
        roomId:     incomingCall.roomId || null,
        groupId:    incomingCall.groupId || null,
        groupName:  incomingCall.groupName || null,
      },
      incomingCall: null,
    });
  },

  clearCallAccepted: () => set({ callAccepted: null }),

  // ── Rechazar llamada entrante ─────────────────────────────────────────────
  rejectCall: () => {
    const { incomingCall } = get();
    if (!incomingCall) return;
    // Grupo: rechazar solo cierra el aviso (la llamada sigue para los demás)
    if (incomingCall.callerId && !incomingCall.groupId) get().sendCallSignal(incomingCall.callerId, 'call_reject');
    set({ incomingCall: null });
  },

  clearCallRejected: () => set({ callRejected: false }),
  clearCallEnded:    () => set({ callEnded:    false }),
  cancelOutgoing:    () => set({ pendingCallOut: null }),
}));
