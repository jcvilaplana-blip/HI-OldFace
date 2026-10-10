/**
 * Foto de perfil de otro usuario (caché por sesión).
 * Pasa viewerId: solo llega la foto si la privacidad de esa persona me deja verla.
 */
import { useEffect, useState } from 'react';
import { useAuthStore } from '../store/authStore';

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
const avatarCache = new Map();

export function useUserAvatar(userId) {
  const [src, setSrc] = useState(() => avatarCache.get(userId) || null);
  useEffect(() => {
    if (!userId) return undefined;
    if (avatarCache.has(userId)) { setSrc(avatarCache.get(userId)); return undefined; }
    let alive = true;
    fetch(`${BACKEND}/user/avatar/${encodeURIComponent(userId)}?viewerId=${encodeURIComponent(useAuthStore.getState().user?.id || '')}`)
      .then(r => r.ok ? r.json() : { avatar: null })
      .then(d => { avatarCache.set(userId, d.avatar || null); if (alive) setSrc(d.avatar || null); })
      .catch(() => {});
    return () => { alive = false; };
  }, [userId]);
  return src;
}
