import { tr } from '../i18n';
/**
 * groupsApi — grupos de OldFace (backend /groups) y llamadas de grupo.
 *
 * El chat de un grupo es `group_<groupId>` (groupId ya empieza por "group_").
 * La sala de una llamada de grupo es `gcall__<groupId>__<inicio>`: la app reconoce la llamada de grupo
 * solo con el roomId (también si llega por la pantalla de llamada nativa de Android).
 */
const BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';

export const groupChatId = (groupId) => `group_${groupId}`;
export const groupIdFromChatId = (chatId) => (String(chatId || '').startsWith('group_group_') ? chatId.slice(6) : null);
export const groupIdFromRoom = (roomId) => String(roomId || '').match(/^gcall__(.+)__\d+$/)?.[1] || null;

async function req(method, path, body) {
  const res = await fetch(`${BACKEND}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || tr('No se pudo completar. Inténtalo de nuevo.'));
  return data;
}

const q = encodeURIComponent;

export const fetchGroups   = (userId) => req('GET', `/groups?userId=${q(userId)}`).then(d => d.groups || []);
export const fetchGroup    = (groupId, userId) => req('GET', `/groups/${q(groupId)}?userId=${q(userId)}`);
export const createGroup   = (adminId, name, members, avatar) => req('POST', '/groups', { adminId, name, members, avatar: avatar || undefined });
export const updateGroup   = (groupId, userId, changes) => req('PUT', `/groups/${q(groupId)}`, { userId, ...changes });
export const addMembers    = (groupId, requesterId, userIds) => req('POST', `/groups/${q(groupId)}/members`, { requesterId, userIds });
export const removeMember  = (groupId, requesterId, userId) => req('DELETE', `/groups/${q(groupId)}/members/${q(userId)}`, { requesterId });

export const fetchGroupCall    = (groupId, userId) => req('GET', `/groups/${q(groupId)}/call?userId=${q(userId)}`).then(d => d.call);
export const startGroupCallApi = (groupId, userId, callType) => req('POST', `/groups/${q(groupId)}/call`, { userId, callType });
export const inviteToGroupCall = (groupId, userId, inviteeIds) => req('POST', `/groups/${q(groupId)}/call/invite`, { userId, inviteeIds });
export const leaveGroupCall    = (groupId, userId) => req('POST', `/groups/${q(groupId)}/call/leave`, { userId }).catch(() => ({}));

/** Foto del grupo: recorte cuadrado de 256 px en JPEG (cabe de sobra en el límite del backend) */
export function compressGroupPhoto(file, size = 256) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const side = Math.min(img.width, img.height);
      const c = document.createElement('canvas');
      c.width = c.height = size;
      c.getContext('2d').drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(tr('No se pudo leer la imagen'))); };
    img.src = url;
  });
}
