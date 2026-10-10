/**
 * DeleteAccountPage — eliminar la cuenta: explica qué se borra, pide escribir ELIMINAR y da de baja.
 * El servidor borra todos los datos (POST /account/delete con el token de la sesión) y cierra la sesión
 * en los demás dispositivos.
 */
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import SimplePage, { Card } from '../components/SimplePage.jsx';
import { useAuthStore } from '../store/authStore';
import { usePrefsStore } from '../store/prefsStore';
import { useThemeStore } from '../store/themeStore';
import { deleteAccount } from '../utils/account';
import { tr } from '../i18n';

const RED = '#ef4444';

export default function DeleteAccountPage() {
  const navigate = useNavigate();
  const user = useAuthStore(s => s.user);
  const T = useThemeStore(s => s.colors);
  const isDark = useThemeStore(s => s.isDark);
  const [typed, setTyped] = useState('');
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState('');

  const WORD = tr('ELIMINAR');
  const ok = typed.trim().toUpperCase() === WORD;

  const removed = [
    tr('Tu perfil: nombre, foto, teléfono y estado'),
    tr('Tus chats y todos sus mensajes, fotos, vídeos y notas de voz'),
    tr('Tus mensajes en los grupos (saldrás de todos)'),
    tr('Tus estados, stickers y grabaciones de karaoke'),
    tr('Tu historial de llamadas y tus directos'),
    tr('Tus dispositivos vinculados, ajustes y privacidad'),
  ];

  const submit = async () => {
    if (!ok || busy) return;
    setBusy(true);
    setError('');
    try {
      await deleteAccount();
      usePrefsStore.getState().disableLock();
      useAuthStore.getState().logout();
      navigate('/login', { replace: true });
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  return (
    <SimplePage title={tr('Eliminar cuenta')}>
      <Card style={{ padding: 20, border: `1.5px solid ${isDark ? 'rgba(239,68,68,0.35)' : '#fecaca'}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <span style={{ width: 44, height: 44, borderRadius: 14, flexShrink: 0, background: isDark ? 'rgba(239,68,68,0.15)' : '#fee2e2',
                         display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={RED} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><path d="M12 9v4M12 17h.01"/>
            </svg>
          </span>
          <p style={{ margin: 0, fontSize: 16, fontWeight: 900, color: T.textPrimary }}>{tr('Esto no se puede deshacer')}</p>
        </div>
        <p style={{ margin: '0 0 12px', fontSize: 14, lineHeight: 1.6, color: T.textSecondary }}>
          {tr('Si eliminas tu cuenta ({phone}) se darán de baja y se borrarán para siempre:', { phone: user?.phone || '' })}
        </p>
        <ul style={{ margin: 0, paddingLeft: 20, listStyle: 'disc', fontSize: 14, lineHeight: 1.7, color: T.textPrimary }}>
          {removed.map(r => <li key={r}>{r}</li>)}
        </ul>
        <p style={{ margin: '12px 0 0', fontSize: 12, lineHeight: 1.5, color: T.textMuted }}>
          {tr('Las personas con las que hablabas dejarán de ver tus chats. Los datos de viajes y facturas del taxi se conservan el tiempo que exige la ley.')}
        </p>
      </Card>

      <Card style={{ padding: 20 }}>
        <label htmlFor="confirm-delete" style={{ display: 'block', fontSize: 14, fontWeight: 700, color: T.textPrimary, marginBottom: 10 }}>
          {tr('Para confirmar, escribe {word}', { word: WORD })}
        </label>
        <input id="confirm-delete" value={typed} onChange={e => { setTyped(e.target.value); setError(''); }}
          autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder={WORD} disabled={busy}
          style={{ width: '100%', boxSizing: 'border-box', padding: '13px 16px', borderRadius: 14, fontSize: 16, fontWeight: 700, letterSpacing: 1,
                   border: `2px solid ${ok ? RED : T.borderStrong}`, background: T.bgInput, color: T.textPrimary, outline: 'none', fontFamily: 'inherit' }} />
        {error && <p role="alert" style={{ margin: '10px 0 0', fontSize: 13, fontWeight: 600, color: RED }}>{error}</p>}
        <button onClick={submit} disabled={!ok || busy}
          style={{ width: '100%', marginTop: 14, padding: 15, borderRadius: 16, border: 'none', cursor: ok && !busy ? 'pointer' : 'default',
                   background: RED, color: 'white', fontWeight: 800, fontSize: 15, opacity: ok && !busy ? 1 : 0.45 }}>
          {busy ? tr('Eliminando…') : tr('Eliminar mi cuenta')}
        </button>
        <button onClick={() => navigate(-1)} disabled={busy}
          style={{ width: '100%', marginTop: 10, padding: 13, borderRadius: 16, border: 'none', cursor: 'pointer',
                   background: 'transparent', color: T.textSecondary, fontWeight: 700, fontSize: 14 }}>
          {tr('Cancelar')}
        </button>
      </Card>
    </SimplePage>
  );
}
