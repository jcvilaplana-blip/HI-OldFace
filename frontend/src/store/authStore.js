/**
 * Store de autenticación — Zustand con persistencia
 * Guarda: user (nombre, teléfono, avatar, estado), token
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';

export const useAuthStore = create(
  persist(
    (set, get) => ({
      user: null,
      isAuthenticated: false,
      token: null,

      // Establecer usuario completo
      setUser: (user) => set({ user, isAuthenticated: true }),

      // Actualizar campos del usuario (nombre, avatar, estado…)
      updateUser: (fields) => set(state => ({
        user: state.user ? { ...state.user, ...fields } : state.user
      })),

      setToken: (token) => set({ token }),

      // Token del servidor RTC propio (rtc-server) — ver utils/rtcClient.js
      rtcToken: null,
      setRtcToken: (rtcToken) => set({ rtcToken }),

      logout: () => set({ user: null, isAuthenticated: false, token: null, rtcToken: null }),

      generateUserId: (phone) => `user_${phone.replace(/\D/g, '')}`,

      // Obtener token del backend ZEGOCLOUD
      fetchToken: async (userId) => {
        const res = await fetch(`${BACKEND}/generate-token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId }),
        });
        const data = await res.json();
        if (data.token) {
          set({ token: data.token });
          return data.token;
        }
        throw new Error('No se pudo obtener el token de sesión');
      },
    }),
    {
      name: 'oldface-auth',
      // Persistir todo excepto funciones
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
        token: state.token,
        rtcToken: state.rtcToken,
      }),
    }
  )
);
