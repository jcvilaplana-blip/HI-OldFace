/**
 * RemindersPage — Recordatorios (/reminders): crear, ver y borrar. A la hora elegida llega un aviso al móvil.
 * También los puede proponer Willy ("recuérdame contestar a Pedro esta tarde") y el usuario los confirma.
 */
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import SimplePage, { Card, BRAND } from '../components/SimplePage.jsx';
import { useThemeStore } from '../store/themeStore';
import { listReminders, addReminder, deleteReminder } from '../utils/mutesReminders';
import { tr, LOCALE } from '../i18n';

const two = (n) => String(n).padStart(2, '0');
/** Valor para <input type="datetime-local"> dentro de una hora (hora local del móvil) */
const inAnHour = () => { const d = new Date(Date.now() + 3600000); return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}T${two(d.getHours())}:${two(d.getMinutes())}`; };
const when = (ms) => new Date(ms).toLocaleString(LOCALE, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export default function RemindersPage() {
  const navigate = useNavigate();
  const T = useThemeStore(s => s.colors);
  const [list, setList] = useState(null);
  const [text, setText] = useState('');
  const [at, setAt] = useState(inAnHour);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = () => listReminders().then(setList).catch(e => { setList([]); setError(e.message); });
  useEffect(() => { load(); }, []);

  const add = async () => {
    const ms = new Date(at).getTime();
    if (!text.trim()) return setError(tr('Escribe qué quieres recordar'));
    if (!Number.isFinite(ms) || ms <= Date.now()) return setError(tr('Elige una fecha y hora futuras'));
    setBusy(true); setError('');
    try { await addReminder({ text: text.trim(), at: ms }); setText(''); setAt(inAnHour()); await load(); }
    catch (e) { setError(e.message); }
    setBusy(false);
  };
  const remove = async (id) => {
    try { await deleteReminder(id); setList(l => l.filter(r => r.id !== id)); } catch (e) { setError(e.message); }
  };

  const input = { width: '100%', boxSizing: 'border-box', padding: '11px 13px', borderRadius: 12, border: `1px solid ${T.border}`, background: T.bgInput, color: T.textPrimary, fontSize: 15, fontFamily: 'inherit' };
  const pending = (list || []).filter(r => !r.firedAt), done = (list || []).filter(r => r.firedAt);

  return (
    <SimplePage title={tr('Recordatorios')} subtitle={tr('Te avisamos a la hora que elijas')}>
      <Card style={{ padding: 16 }}>
        <p style={{ margin: '0 0 10px', fontSize: 15, fontWeight: 800, color: T.textPrimary }}>{tr('Nuevo recordatorio')}</p>
        <input value={text} onChange={e => setText(e.target.value.slice(0, 200))} placeholder={tr('¿Qué quieres recordar?')} style={input} />
        <input type="datetime-local" value={at} onChange={e => setAt(e.target.value)} style={{ ...input, marginTop: 8 }} />
        {error && <p style={{ margin: '8px 0 0', fontSize: 13, color: '#dc2626', fontWeight: 700 }}>{error}</p>}
        <button onClick={add} disabled={busy}
          style={{ marginTop: 12, width: '100%', background: BRAND, color: 'white', border: 'none', borderRadius: 12, padding: '12px 0', fontSize: 15, fontWeight: 800, cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>
          {tr('Guardar recordatorio')}
        </button>
        <p style={{ margin: '10px 0 0', fontSize: 12, color: T.textMuted }}>{tr('También puedes pedírselo a Willy: «recuérdame llamar al médico mañana a las 9».')}</p>
      </Card>

      {list === null ? <p style={{ textAlign: 'center', color: T.textMuted }}>{tr('Cargando…')}</p> : (
        <>
          <Card>
            {!pending.length && <p style={{ margin: 0, padding: 16, fontSize: 14, color: T.textMuted }}>{tr('No tienes recordatorios pendientes.')}</p>}
            {pending.map(r => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: `1px solid ${T.border}` }}>
                <span style={{ fontSize: 20 }}>⏰</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: T.textPrimary, wordBreak: 'break-word' }}>{r.text}</p>
                  <p style={{ margin: '2px 0 0', fontSize: 12, color: T.textSecondary }}>{when(r.at)}</p>
                </div>
                {r.chatId && <button onClick={() => navigate(`/chat/${encodeURIComponent(r.chatId)}`)} style={{ background: 'none', border: 'none', color: BRAND, fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>{tr('Chat')}</button>}
                <button onClick={() => remove(r.id)} aria-label={tr('Borrar')} style={{ background: 'none', border: 'none', color: '#ef4444', fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>{tr('Borrar')}</button>
              </div>
            ))}
          </Card>
          {!!done.length && (
            <>
              <p style={{ margin: '4px 6px 8px', fontSize: 12, fontWeight: 800, color: T.textMuted, textTransform: 'uppercase' }}>{tr('Ya avisados')}</p>
              <Card>
                {done.map(r => (
                  <div key={r.id} style={{ padding: '10px 16px', borderBottom: `1px solid ${T.border}`, opacity: 0.7 }}>
                    <p style={{ margin: 0, fontSize: 14, color: T.textPrimary }}>{r.text}</p>
                    <p style={{ margin: '2px 0 0', fontSize: 12, color: T.textSecondary }}>{when(r.at)}</p>
                  </div>
                ))}
              </Card>
            </>
          )}
        </>
      )}
    </SimplePage>
  );
}
