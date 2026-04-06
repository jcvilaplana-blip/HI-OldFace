/**
 * zegoStore — ZEGOCLOUD UIKit (llamadas) + ZIM (chat)
 *
 * IMPORTANTE: UIKit gestiona ZIM internamente vía addPlugins({ ZIM }).
 * NO pre-inicializamos ZIM. Dejamos que UIKit haga el login de ZIM para
 * que sus handlers de invitación de llamada se registren correctamente.
 *
 * Tras setCallInvitationConfig, esperamos a que ZIM.getInstance() esté
 * disponible y añadimos nuestro listener de chat (peerMessageReceived).
 */
import { create } from 'zustand';

const APP_ID        = parseInt(import.meta.env.VITE_ZEGOCLOUD_APP_ID);
const SERVER_SECRET = import.meta.env.VITE_ZEGOCLOUD_SERVER_SECRET;

export const useZegoStore = create((set, get) => ({
  // ── Estado UIKit ──────────────────────────────────────────────────────────
  instance:      null,
  containerRef:  null,
  isCallActive:  false,
  incomingCall:  null,    // { callType, caller, refuse, accept, callerName, isVideo }
  outgoingCancel: null,
  callError:     null,    // mensaje de error visible al usuario

  // ── Estado ZIM (chat) ─────────────────────────────────────────────────────
  zimEngine:    null,
  zimConnected: false,

  setContainerRef: (ref) => set({ containerRef: ref }),

  setCallError: (msg) => {
    set({ callError: msg });
    setTimeout(() => set({ callError: null }), 3500);
  },

  // ── Init: UIKit primero, ZIM lo gestiona UIKit ────────────────────────────
  init: async (user) => {
    if (get().instance) return; // ya inicializado

    try {
      const [{ ZegoUIKitPrebuilt }, { ZIM }] = await Promise.all([
        import('@zegocloud/zego-uikit-prebuilt'),
        import('zego-zim-web'),
      ]);

      // Token para call invitations: roomID = null (requerido por la documentación oficial)
      const kitToken = ZegoUIKitPrebuilt.generateKitTokenForTest(
        APP_ID, SERVER_SECRET, null, user.id, user.name || 'Usuario'
      );

      const zp = ZegoUIKitPrebuilt.create(kitToken);

      // UIKit crea y hace login en ZIM internamente
      zp.addPlugins({ ZIM });

      zp.setCallInvitationConfig({
        enableCustomCallInvitationDialog:      true,
        enableCustomCallInvitationWaitingPage: true,

        // Receptor: llega invitación → mostrar nuestro modal
        onConfirmDialogWhenReceiving: (callType, caller, refuse, accept) => {
          set({ incomingCall: {
            callType,
            caller,
            refuse,
            accept,
            callerName: caller?.userName || caller?.userID || '?',
            isVideo:    callType === ZegoUIKitPrebuilt.InvitationTypeVideoCall,
          }});
        },

        // Ambos: listos para unirse al room
        onSetRoomConfigBeforeJoining: (callType) => {
          set({ isCallActive: true, incomingCall: null, outgoingCancel: null });
          const { containerRef } = get();
          return {
            container:                    containerRef?.current ?? null,
            showPreJoinView:              false,
            turnOnMicrophoneWhenJoining:  true,
            turnOnCameraWhenJoining:      callType === ZegoUIKitPrebuilt.InvitationTypeVideoCall,
            showMyCameraToggleButton:     true,
            showMyMicrophoneToggleButton: true,
            showAudioVideoSettingsButton: false,
            showScreenSharingButton:      false,
            showTextChat:                 false,
            showUserList:                 false,
            maxUsers:                     2,
            layout:                       'Auto',
            showLayoutButton:             false,
            scenario:                     { mode: ZegoUIKitPrebuilt.OneONoneCall },
            onLeaveRoom:                  () => set({ isCallActive: false }),
          };
        },

        // Llamante: pantalla de espera personalizada
        onWaitingPageWhenSending: (_type, _callees, cancel) => {
          set({ isCallActive: true, outgoingCancel: cancel });
        },

        // Fin de cualquier llamada
        onCallInvitationEnded:  () => set({ incomingCall: null, isCallActive: false, outgoingCancel: null }),
        onOutgoingCallAccepted: () => console.log('[Zego] llamada aceptada'),
        onOutgoingCallRejected: () => set({ isCallActive: false, outgoingCancel: null }),
        onOutgoingCallDeclined: () => set({ isCallActive: false, outgoingCancel: null }),
        onOutgoingCallTimeout:  () => set({ isCallActive: false, outgoingCancel: null }),
        onIncomingCallCanceled: () => set({ incomingCall: null }),
        onIncomingCallTimeout:  () => set({ incomingCall: null }),
      });

      set({ instance: zp });
      console.log('[Zego] UIKit listo para', user.id);

      // ── Esperar a que UIKit inicialice ZIM, luego añadir listener de chat ──
      // UIKit hace el login ZIM de forma asíncrona tras setCallInvitationConfig.
      // Sondeamos hasta tener la instancia (máx 10 s).
      let attempts = 0;
      const grabZIM = setInterval(() => {
        const zimInst = ZIM.getInstance();
        if (zimInst) {
          clearInterval(grabZIM);
          zimInst.off('peerMessageReceived');
          zimInst.on('peerMessageReceived', (_zim, { messageList, fromConversationID }) => {
            import('./chatStore').then(({ useChatStore }) => {
              const { addMessage } = useChatStore.getState();
              const msgChatId = `chat_${[user.id, fromConversationID].sort().join('_')}`;
              messageList.forEach(msg => {
                if (msg.type === 1) {
                  addMessage(msgChatId, {
                    id:     `zim_${Date.now()}_${Math.random()}`,
                    text:   msg.message,
                    sender: msg.senderUserID,
                    time:   new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }),
                    status: 'received',
                    isMine: false,
                  });
                }
              });
            });
          });
          set({ zimEngine: zimInst, zimConnected: true });
          console.log('[Zego] ZIM chat listo para', user.id);
        } else if (++attempts >= 20) {
          clearInterval(grabZIM);
          console.warn('[Zego] ZIM no disponible tras 10s');
        }
      }, 500);

    } catch (err) {
      console.error('[Zego] init ERROR:', err);
    }
  },

  // ── Enviar mensaje de chat (usando ZIM gestionado por UIKit) ─────────────
  sendChatMessage: async (toUserId, text) => {
    const { zimEngine } = get();
    if (!zimEngine) return;
    try {
      await zimEngine.sendMessage({ type: 1, message: text }, toUserId, 0, { priority: 2 });
    } catch (err) {
      console.warn('[ZIM] sendMessage error:', err?.message);
    }
  },

  // ── Videollamada saliente ─────────────────────────────────────────────────
  sendVideoCall: async (calleeId, calleeName) => {
    const { instance } = get();
    if (!instance) {
      get().setCallError('Conectando... espera un momento e inténtalo de nuevo');
      return;
    }
    const { ZegoUIKitPrebuilt } = await import('@zegocloud/zego-uikit-prebuilt');
    try {
      const res = await instance.sendCallInvitation({
        callees:  [{ userID: calleeId, userName: calleeName || calleeId }],
        callType: ZegoUIKitPrebuilt.InvitationTypeVideoCall,
        timeout:  60,
      });
      if (res?.errorInvitees?.length) {
        console.warn('[Zego] receptor no disponible:', res.errorInvitees);
        set({ isCallActive: false, outgoingCancel: null });
        get().setCallError(`${calleeName || calleeId} no está disponible ahora mismo`);
      }
    } catch (err) {
      console.error('[Zego] sendVideoCall error:', err?.message);
      set({ isCallActive: false, outgoingCancel: null });
      get().setCallError('No se pudo iniciar la videollamada');
    }
  },

  // ── Llamada de voz saliente ───────────────────────────────────────────────
  sendVoiceCall: async (calleeId, calleeName) => {
    const { instance } = get();
    if (!instance) {
      get().setCallError('Conectando... espera un momento e inténtalo de nuevo');
      return;
    }
    const { ZegoUIKitPrebuilt } = await import('@zegocloud/zego-uikit-prebuilt');
    try {
      const res = await instance.sendCallInvitation({
        callees:  [{ userID: calleeId, userName: calleeName || calleeId }],
        callType: ZegoUIKitPrebuilt.InvitationTypeVoiceCall,
        timeout:  60,
      });
      if (res?.errorInvitees?.length) {
        set({ isCallActive: false, outgoingCancel: null });
        get().setCallError(`${calleeName || calleeId} no está disponible ahora mismo`);
      }
    } catch (err) {
      console.error('[Zego] sendVoiceCall error:', err?.message);
      set({ isCallActive: false, outgoingCancel: null });
      get().setCallError('No se pudo iniciar la llamada');
    }
  },

  // ── Aceptar / rechazar llamada entrante ───────────────────────────────────
  acceptCall: () => {
    const { incomingCall } = get();
    incomingCall?.accept?.();
    set({ incomingCall: null });
  },
  rejectCall: () => {
    const { incomingCall } = get();
    incomingCall?.refuse?.();
    set({ incomingCall: null });
  },

  // ── Cancelar llamada saliente ─────────────────────────────────────────────
  cancelOutgoing: () => {
    const { outgoingCancel } = get();
    outgoingCancel?.();
    set({ isCallActive: false, outgoingCancel: null });
  },
}));
