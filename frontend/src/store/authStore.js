/**
 * Store de autenticación — Zustand con persistencia
 * Guarda: user (nombre, teléfono, avatar, estado), token
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

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
