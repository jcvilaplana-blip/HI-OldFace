/**
 * Insignia del icono de la app (número de mensajes sin leer), como WhatsApp.
 * Con la app cerrada la pone el aviso push (notificationCount); con la app abierta se actualiza desde la lista de chats.
 * En Android depende del lanzador: Samsung, Xiaomi, Huawei… muestran el número; Pixel solo un punto.
 */
import { Capacitor } from '@capacitor/core';

let last = -1;

export async function setAppBadge(count) {
  const n = Math.max(0, Number(count) || 0);
  if (n === last || !Capacitor.isNativePlatform()) return;
  last = n;
  try {
    const { Badge } = await import('@capawesome/capacitor-badge');
    if (n > 0) await Badge.set({ count: n });
    else await Badge.clear();
  } catch { /* APK antiguo sin el plugin: la insignia la sigue poniendo el aviso push */ }
}
