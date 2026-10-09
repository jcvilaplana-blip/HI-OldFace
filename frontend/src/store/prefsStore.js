/**
 * Preferencias de la app en este dispositivo — Zustand con persistencia
 *   · messageTone: tono de los mensajes nuevos (también se guarda en el servidor para los avisos con la app cerrada)
 *   · lock: bloqueo de la app con PIN (+ huella/cara si el móvil lo permite)
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { tr, LANG } from '../i18n';

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';

/** Tonos de mensaje: id → nombre visible. Los archivos están en public/sounds y android res/raw (msg_<id>.wav) */
export const MESSAGE_TONES = [
  { id: 'clasico', name: tr('Clásico') },
  { id: 'campana', name: tr('Campana') },
  { id: 'burbuja', name: tr('Burbuja') },
  { id: 'cristal', name: tr('Cristal') },
  { id: 'suave',   name: tr('Suave') },
  { id: 'ninguno', name: tr('Ninguno') },
];

/** Cuándo se bloquea la app al salir de ella (segundos fuera) */
export const LOCK_AFTER = [
  { secs: 0,    label: tr('Inmediatamente') },
  { secs: 60,   label: tr('Al pasar 1 minuto') },
  { secs: 1800, label: tr('Al pasar 30 minutos') },
];

const DEFAULT_LOCK = { enabled: false, pinHash: null, salt: null, biometric: false, after: 60 };

async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export const usePrefsStore = create(
  persist(
    (set, get) => ({
      messageTone: 'clasico',
      lock: DEFAULT_LOCK,

      setMessageTone: (messageTone, userId) => {
        set({ messageTone });
        if (userId) syncTone(userId, messageTone);
      },

      /** Activar el bloqueo (o cambiar el PIN) */
      setPin: async (pin) => {
        const salt = crypto.getRandomValues(new Uint32Array(4)).join('-');
        const pinHash = await sha256(`${salt}:${pin}`);
        set({ lock: { ...get().lock, enabled: true, salt, pinHash } });
      },
      checkPin: async (pin) => {
        const { salt, pinHash } = get().lock;
        return !!pinHash && (await sha256(`${salt}:${pin}`)) === pinHash;
      },
      setLockOption: (patch) => set({ lock: { ...get().lock, ...patch } }),
      disableLock: () => set({ lock: DEFAULT_LOCK }),
    }),
    { name: 'oldface-prefs' }
  )
);

/** Guardar el tono en el servidor: el aviso de un mensaje con la app cerrada suena con él */
export function syncTone(userId, messageTone = usePrefsStore.getState().messageTone) {
  return fetch(`${BACKEND}/user/prefs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, messageTone, lang: LANG }),   // también el idioma: los avisos llegan en él
  }).catch(() => {});
}
