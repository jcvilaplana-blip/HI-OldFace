/**
 * Hook para integración con ZEGOCLOUD
 * Los SDKs se cargan dinámicamente en producción
 */
import { useState, useRef, useCallback, useEffect } from 'react';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';

export async function getZegoToken(userId, roomId = '') {
  const res = await fetch(`${BACKEND_URL}/generate-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, roomId })
  });
  const data = await res.json();
  return data.token || null;
}

export const APP_ID = parseInt(import.meta.env.VITE_ZEGOCLOUD_APP_ID || '377576855');

export function useZego() {
  const [isConnected, setIsConnected] = useState(false);
  const zegoRef = useRef(null);

  const joinRoom = useCallback(async (roomId) => {
    console.log('Joining room:', roomId);
    setIsConnected(true);
    return true;
  }, []);

  const leaveRoom = useCallback(async (roomId) => {
    setIsConnected(false);
  }, []);

  return { zego: zegoRef.current, isConnected, joinRoom, leaveRoom };
}
