/**
 * zegoStore — ZEGOCLOUD UIKit (Video Conference via joinRoom) + ZIM (chat + señalamiento)
 *
 * Engine lock (Promise-chain mutex): garantiza que acquireCallInstance y
 * releaseCallInstance nunca se ejecuten en paralelo → elimina error 1002011.
 *
 * Protocolo ZIM de señalamiento:
 *   _oc_type: 'call_invite'  → { callType, callerName }
 *   _oc_type: 'call_accept'  → {}
 *   _oc_type: 'call_reject'  → {}
 *   _oc_type: 'call_cancel'  → {}
 *   _oc_type: 'call_end'     → {}
 */
import { create } from 'zustand';
import { playMessageSound } from '../utils/sounds.js';
import { getRtcConfig, connectRtc, sendSignal, isRtcConnected } from '../utils/rtcClient.js';

const APP_ID        = parseInt(import.meta.env.VITE_ZEGOCLOUD_APP_ID);
const SERVER_SECRET = import.meta.env.VITE_ZEGOCLOUD_SERVER_SECRET;
const BACKEND       = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';

// ── Engine lock: serializa acquire/release para evitar error 1002011 ──────────
// Es un Promise que siempre está "pending" mientras alguna operación corre.
// Encadenamos cada operación sobre el lock anterior para garantizar orden FIFO.
let engineLock = Promise.resolve();

// Evita que init() se llame dos veces en paralelo
let initInProgress = false;

// Referencia al intervalo grabZIM para poder cancelarlo en acquireCallInstance
let grabZIMInterval = null;

// Servidor RTC propio: se conecta una sola vez por sesión (sobrevive a acquire/release de UIKit)
let rtcStartedFor = null;

// Temporizador de llamada perdida (modal de llamada entrante)
let incomingTimeout = null;

// ─────────────────────────────────────────────────────────────────────────────

async function notifyCallViaFCM(calleeId, callType, roomId = '', media = 'zego') {
  try {
    const { useAuthStore } = await import('./authStore');
    const user = useAuthStore.getState().user;
    if (!user?.id) return;
    await fetch(`${BACKEND}/call-notification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ calleeId, callerId: user.id, callerName: user.name || user.id, callType, roomId, media }),
    });
  } catch { /* silencioso */ }
}

export const useZegoStore = create((set, get) => ({
  // ── Estado UIKit / ZIM ────────────────────────────────────────────────────
  instance:       null,
  zimEngine:      null,
  zimConnected:   false,

  // ── Señalización: 'zim' (ZEGOCLOUD) o 'oldface' (servidor RTC propio) ─────
  signaling:      'zim',
  rtcConnected:   false,

  // ── Estado de llamadas (ZIM signaling) ───────────────────────────────────
  incomingCall:   null,   // { callType, callerId, callerName, isVideo, roomId }
  callError:      null,   // mensaje de error toast
  pendingCallOut: null,   // { calleeId, calleeName, callType, roomId } → AppShell navega
  callAccepted:   null,   // { callerId, callerName, callType, roomId } → AppShell navega
  callRejected:   false,  // VideoCallPage/CallPage lo escucha para salir
  callEnded:      false,  // la otra parte colgó → pages salen
  pendingFCMCall: null,   // { callType, callerId, callerName, roomId } desde FCM tap

  setCallError: (msg) => {
    set({ callError: msg });
    setTimeout(() => set({ callError: null }), 3500);
  },

  // ── Llamada entrante: muestra el modal Aceptar/Rechazar (App.jsx) ─────────
  // Se usa tanto para señales en vivo (ZIM / servidor RTC) como al tocar la notificación push.
  showIncomingCall: ({ callerId, callerName, callType, roomId, media }) => {
    const type = callType || 'video';
    set({
      incomingCall: {
        callType:   type,
        callerId,
        callerName: callerName || callerId,
        isVideo:    type === 'video',
        roomId:     roomId || null,
        media:      media === 'zego' ? 'zego' : 'oldface', // motor elegido por quien llama (por defecto el propio)
      },
    });
    // Sin respuesta en 60 s → llamada perdida, se cierra el modal
    clearTimeout(incomingTimeout);
    incomingTimeout = setTimeout(() => {
      if (get().incomingCall?.callerId === callerId) set({ incomingCall: null });
    }, 60000);
  },

  // ── Señales de llamada (comunes a ZIM y al servidor RTC) ─────────────────
  _handleCallSignal: ({ type, from, fromName, payload = {}, ts }) => {
    if (type === 'call_invite') {
      // Ignorar invitaciones viejas (p. ej. entregadas al reconectar)
      const age = Date.now() - (ts || 0);
      if (age > 30000) { console.log('[Señal] call_invite obsoleto ignorado (age:', age, 'ms)'); return; }
      console.log('[Señal] Llamada entrante de:', from, payload);
      get().showIncomingCall({ callerId: from, callerName: payload.callerName || fromName, callType: payload.callType, roomId: payload.roomId, media: payload.media });
    }
    else if (type === 'call_reject') set({ callRejected: true });
    else if (type === 'call_cancel' || type === 'call_end') {
      // Si aún está sonando (no se ha aceptado), solo se cierra el modal.
      // No marcar callEnded: quedaría activo y cerraría la SIGUIENTE llamada al abrirse.
      if (get().incomingCall?.callerId === from) { set({ incomingCall: null }); return; }
      if (type === 'call_end') set({ callEnded: true });
    }
    // call_accept: no requiere acción (la sala ya está abierta)
  },

  /** Motor de audio/vídeo para llamadas que inicia este usuario: 'oldface' (servidor propio) o 'zego' */
  // OldFace ya no usa ZEGOCLOUD para llamadas: siempre servidor propio
  mediaProvider: () => 'oldface',

  /** Envía una señal de llamada por el servidor RTC (si está activo). ZIM lo envían las páginas. */
  sendCallSignal: (to, type, payload = {}) => {
    if (!isRtcConnected()) return Promise.resolve(false);
    return sendSignal(to, type, payload);
  },

  // ── Mensaje de chat entregado por el servidor RTC (antes: peerMessageReceived de ZIM) ──
  _handleChatPush: (user, msg) => {
    if (!msg?.chatId || msg.senderId === user.id) return;
    import('./chatStore').then(({ useChatStore }) => {
      const { addMessage, createOrGetChat, fetchChats } = useChatStore.getState();
      const existing = useChatStore.getState().messages[msg.chatId] || [];
      if (!existing.some(m => m.id === msg.id)) {
        addMessage(msg.chatId, {
          id:       msg.id,
          text:     msg.text,
          sender:   msg.senderId,
          time:     msg.time,
          type:     msg.type || 'text',
          url:      msg.url || null,
          replyTo:  msg.replyTo || null,
          fileName: msg.fileName || null,
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

  // ── Conexión con el servidor RTC propio (según el interruptor del backend) ──
  _startRtc: async (user) => {
    if (rtcStartedFor === user.id) return;
    rtcStartedFor = user.id;
    const { rtcSignaling } = await getRtcConfig(user.id);
    if (rtcSignaling !== 'oldface') { set({ signaling: 'zim' }); return; }
    set({ signaling: 'oldface' });
    try {
      await connectRtc(user, {
        onSignal:           (sig) => get()._handleCallSignal(sig),
        onChatMessage:      (msg) => get()._handleChatPush(user, msg),
        onConnectionChange: (ok)  => set({ rtcConnected: ok }),
      });
      console.log('[RTC] Señalización propia activa para', user.id);
    } catch (err) {
      console.warn('[RTC] No se pudo conectar, se sigue con ZIM:', err.message);
      set({ signaling: 'zim' });
      rtcStartedFor = null;
    }
  },

  setPendingFCMCall: (data) => set({ pendingFCMCall: data }),
  clearPendingFCMCall: () => set({ pendingFCMCall: null }),

  // ── Iniciar llamada saliente ──────────────────────────────────────────────
  sendVideoCall: async (calleeId, calleeName) => {
    let { zimEngine } = get();
    if (!zimEngine) {
      try {
        const { ZIM } = await import('zego-zim-web');
        zimEngine = ZIM.getInstance();
        if (zimEngine) set({ zimEngine, zimConnected: true });
      } catch {}
    }
    if (!zimEngine && !isRtcConnected()) {
      get().setCallError('No conectado — espera un momento e inténtalo de nuevo');
      return;
    }
    const roomId = `room_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const media  = get().mediaProvider();
    notifyCallViaFCM(calleeId, 'video', roomId, media);
    set({ pendingCallOut: { calleeId, calleeName, callType: 'video', roomId, media } });
  },

  sendVoiceCall: async (calleeId, calleeName) => {
    let { zimEngine } = get();
    if (!zimEngine) {
      try {
        const { ZIM } = await import('zego-zim-web');
        zimEngine = ZIM.getInstance();
        if (zimEngine) set({ zimEngine, zimConnected: true });
      } catch {}
    }
    if (!zimEngine && !isRtcConnected()) {
      get().setCallError('No conectado — espera un momento e inténtalo de nuevo');
      return;
    }
    const media = get().mediaProvider();
    notifyCallViaFCM(calleeId, 'voice', '', media);
    set({ pendingCallOut: { calleeId, calleeName, callType: 'voice', media } });
  },

  clearPendingCall: () => set({ pendingCallOut: null }),

  // ── Aceptar llamada entrante ──────────────────────────────────────────────
  acceptCall: () => {
    const { incomingCall, zimEngine } = get();
    if (!incomingCall) return;
    if (zimEngine && incomingCall.callerId) {
      zimEngine.sendMessage(
        { type: 1, message: JSON.stringify({ _oc_type: 'call_accept' }) },
        incomingCall.callerId, 0, { priority: 3 }
      ).catch(() => {});
    }
    if (incomingCall.callerId) get().sendCallSignal(incomingCall.callerId, 'call_accept');
    set({
      callAccepted: {
        callerId:   incomingCall.callerId,
        callerName: incomingCall.callerName,
        callType:   incomingCall.callType,
        roomId:     incomingCall.roomId || null,
        media:      incomingCall.media || 'oldface',
      },
      incomingCall: null,
    });
  },

  clearCallAccepted: () => set({ callAccepted: null }),

  // ── Rechazar llamada entrante ─────────────────────────────────────────────
  rejectCall: () => {
    const { incomingCall, zimEngine } = get();
    if (!incomingCall) return;
    if (zimEngine && incomingCall.callerId) {
      zimEngine.sendMessage(
        { type: 1, message: JSON.stringify({ _oc_type: 'call_reject' }) },
        incomingCall.callerId, 0, { priority: 3 }
      ).catch(() => {});
    }
    if (incomingCall.callerId) get().sendCallSignal(incomingCall.callerId, 'call_reject');
    set({ incomingCall: null });
  },

  clearCallRejected: () => set({ callRejected: false }),
  clearCallEnded:    () => set({ callEnded:    false }),
  cancelOutgoing:    () => set({ pendingCallOut: null }),

  // ── Init: UIKit + ZIM ────────────────────────────────────────────────────
  init: async (user) => {
    // Señalización propia: independiente de UIKit, se arranca una vez por sesión
    await get()._startRtc(user);

    // Con el servidor RTC propio no se carga ZEGOCLOUD (ni UIKit ni ZIM)
    if (get().signaling === 'oldface') return;

    // Doble guardia: instancia existente O init ya en marcha
    if (get().instance || initInProgress) return;
    initInProgress = true;

    try {
      const [{ ZegoUIKitPrebuilt }, { ZIM }] = await Promise.all([
        import('@zegocloud/zego-uikit-prebuilt'),
        import('zego-zim-web'),
      ]);

      const kitToken = ZegoUIKitPrebuilt.generateKitTokenForTest(
        APP_ID, SERVER_SECRET, null, user.id, user.name || 'Usuario'
      );

      const zp = ZegoUIKitPrebuilt.create(kitToken);
      zp.addPlugins({ ZIM });
      set({ instance: zp });
      console.log('[Zego] UIKit listo para', user.id);

      // Esperar a que UIKit inicialice ZIM internamente
      let attempts = 0;
      grabZIMInterval = setInterval(() => {
        const zimInst = ZIM.getInstance();
        if (zimInst) {
          clearInterval(grabZIMInterval);
          grabZIMInterval = null;

          zimInst.off('peerMessageReceived');
          zimInst.on('peerMessageReceived', (_zim, { messageList, fromConversationID }) => {
            // Con señalización propia, mensajes y llamadas llegan por el servidor RTC (evita duplicados)
            if (get().signaling === 'oldface') return;
            import('./chatStore').then(({ useChatStore }) => {
              const { addMessage, createOrGetChat, fetchChats } = useChatStore.getState();
              const msgChatId = `chat_${[user.id, fromConversationID].sort().join('_')}`;

              let hasNewChat = false;
              messageList.forEach(msg => {
                if (msg.type !== 1) return;

                let parsed = null;
                try { parsed = JSON.parse(msg.message); } catch {}

                if (parsed?._oc_type?.startsWith('call_')) {
                  // ZIM guarda mensajes no entregados: _handleCallSignal descarta invitaciones viejas
                  const { _oc_type, ...payload } = parsed;
                  get()._handleCallSignal({ type: _oc_type, from: fromConversationID, payload, ts: msg.timestamp });
                  return;
                }

                // Si es un mensaje de archivo/documento, recargar mensajes desde el
                // backend para obtener el tipo, url y fileName correctos.
                const isFileMsgRx = msg.message?.startsWith('[Archivo:') ||
                                    msg.message?.startsWith('[Audio:') ||
                                    msg.message?.startsWith('[Imagen:') ||
                                    msg.message?.startsWith('[Video:');

                createOrGetChat(user.id, fromConversationID, fromConversationID)
                  .then(() => {
                    fetchChats(user.id);
                    if (isFileMsgRx) {
                      // Esperar 2s para que el emisor complete persistMessage,
                      // luego recargar para obtener el documento/archivo real.
                      setTimeout(() => {
                        const { loadMessages } = useChatStore.getState();
                        loadMessages(msgChatId, user.id, fromConversationID);
                      }, 2000);
                    }
                  });

                if (!isFileMsgRx) {
                  addMessage(msgChatId, {
                    id:     `zim_${Date.now()}_${Math.random()}`,
                    text:   msg.message,
                    sender: msg.senderUserID,
                    time:   new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }),
                    status: 'received',
                    isMine: false,
                  });
                }
                hasNewChat = true;
              });

              if (hasNewChat) playMessageSound();
            });
          });

          // ZIM Web SDK v2.x: 0=Disconnected, 1=Connecting, 2=Connected, 3=Reconnecting
          zimInst.on('connectionStateChanged', (_zim, { state }) => {
            const connected = state === 2 || state === 3;
            set({ zimConnected: connected });
            console.log('[ZIM] state:', state, connected ? '✓ OK' : '✗ OFF');
          });

          set({ zimEngine: zimInst, zimConnected: true });
          console.log('[Zego] ZIM listo para', user.id);

        } else if (++attempts >= 20) {
          clearInterval(grabZIMInterval);
          grabZIMInterval = null;
          console.warn('[Zego] ZIM no disponible tras 10s');
        }
      }, 500);

    } catch (err) {
      console.error('[Zego] init ERROR:', err);
    } finally {
      initInProgress = false;
    }
  },

  // ── Adquirir instancia UIKit para una llamada ─────────────────────────────
  // Usa el engine lock para serializar con releaseCallInstance.
  // Garantiza: solo UNA instancia ZEGO Express activa en todo momento.
  acquireCallInstance: async (roomId, userId, userName) => {
    // Encadenar en el lock existente → esperar a que termine cualquier release
    let resolveLock;
    const prevLock = engineLock;
    engineLock = new Promise(r => { resolveLock = r; });

    try {
      await prevLock;

      // Esperar a que init() complete si está en marcha (evita race condition)
      let waitInit = 0;
      while (initInProgress && waitInit < 3000) {
        await new Promise(r => setTimeout(r, 100));
        waitInit += 100;
      }

      // Cancelar el intervalo grabZIM para que no interfiera tras el destroy
      if (grabZIMInterval) { clearInterval(grabZIMInterval); grabZIMInterval = null; }

      const { instance } = get();
      if (instance) {
        console.log('[Zego] Destruyendo instancia previa...');
        try { await instance.destroy?.(); } catch {}
        await new Promise(r => setTimeout(r, 600)); // dar tiempo al engine nativo para liberarse
      }
      set({ instance: null, zimEngine: null, zimConnected: false });

      console.log('[Zego] Creando instancia para room:', roomId);
      const { ZegoUIKitPrebuilt } = await import('@zegocloud/zego-uikit-prebuilt');
      const token = ZegoUIKitPrebuilt.generateKitTokenForTest(
        APP_ID, SERVER_SECRET, roomId, userId, userName || 'Usuario'
      );
      const callInst = ZegoUIKitPrebuilt.create(token);
      set({ instance: callInst });
      return callInst;

    } catch (err) {
      console.error('[Zego] acquireCallInstance ERROR:', err);
      return null;
    } finally {
      resolveLock(); // liberar lock siempre, incluso en error
    }
  },

  // ── Liberar instancia de llamada y re-inicializar ZIM ─────────────────────
  // No bloquea al llamante (fire-and-forget), pero el lock garantiza que
  // cualquier acquire posterior espere a que el engine esté liberado.
  releaseCallInstance: (user) => {
    const { instance } = get();
    // Limpiar estado inmediatamente (síncrono) para que la UI responda
    set({ instance: null, zimEngine: null, zimConnected: false });

    // Encadenar en el lock
    let resolveLock;
    const prevLock = engineLock;
    engineLock = new Promise(r => { resolveLock = r; });

    (async () => {
      try {
        await prevLock;
        try { await instance?.destroy?.(); } catch {}
        await new Promise(r => setTimeout(r, 600)); // esperar liberación del engine nativo
        console.log('[Zego] Engine liberado, re-inicializando ZIM...');
      } finally {
        resolveLock();
      }
      // Re-init FUERA del lock (init no crea Express Engine directamente al inicio)
      get().init(user);
    })();
  },

  // ── Enviar mensaje de chat (ZIM gestionado por UIKit) ────────────────────
  sendChatMessage: async (toUserId, text) => {
    const { zimEngine } = get();
    if (!zimEngine) return;
    try {
      await zimEngine.sendMessage({ type: 1, message: text }, toUserId, 0, { priority: 2 });
    } catch (err) {
      console.warn('[ZIM] sendMessage error:', err?.message);
    }
  },
}));
