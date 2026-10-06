/**
 * TaxiPage — entrada al módulo de taxi (/taxi).
 *   1ª vez: elegir "Entrar como Cliente" o "Entrar como Conductor". La elección queda fijada a la cuenta de OldFace:
 *           un cliente no puede ser conductor y un conductor no puede ser cliente (solo el administrador lo cambia).
 *   Después: abre directamente la parte elegida (cada una con su interfaz y su panel).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import { taxiApi, setTaxiLanguage, tx, closeTaxiSocket } from '../../utils/taxiApi';
import { BRAND, C, Header, Btn, Card, Field, inputStyle, Spinner, Center } from './ui.jsx';
import CustomerApp from './CustomerApp.jsx';
import DriverApp from './DriverApp.jsx';

export default function TaxiPage() {
  const navigate = useNavigate();
  const [boot, setBoot] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const b = await taxiApi('/bootstrap');
      setTaxiLanguage(b.language);
      setBoot(b);
    } catch (e) { setError(e.message); }
  }, []);

  useEffect(() => { load(); return () => closeTaxiSocket(); }, [load]);

  const exit = () => navigate('/');

  if (error) return (
    <Screen>
      <Header title="Taxi" onBack={exit} />
      <Center>
        <span style={{ fontSize: 44 }}>🚕</span>
        <p style={{ fontWeight: 700 }}>{error}</p>
        <div style={{ width: 220 }}><Btn onClick={load}>{tx('Reintentar')}</Btn></div>
      </Center>
    </Screen>
  );
  if (!boot) return <Screen><Header title="Taxi" onBack={exit} /><Center><Spinner /></Center></Screen>;

  if (boot.settings.app?.maintenance) return (
    <Screen>
      <Header title={boot.settings.app.name || 'Taxi'} onBack={exit} />
      <Center><span style={{ fontSize: 44 }}>🛠️</span><p style={{ fontWeight: 700 }}>{tx('Estamos haciendo mejoras. Vuelve a intentarlo en unos minutos.')}</p></Center>
    </Screen>
  );

  if (!boot.role) return <RoleChooser boot={boot} onDone={load} onExit={exit} />;
  if (boot.role === 'customer') return <Screen><CustomerApp boot={boot} reload={load} onExit={exit} /></Screen>;
  return <Screen><DriverApp boot={boot} reload={load} onExit={exit} /></Screen>;
}

function Screen({ children }) {
  return <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', background: C.bg, color: C.text }}>{children}</div>;
}

// ── Elegir rol (una sola vez) ────────────────────────────────────────────────
function RoleChooser({ boot, onDone, onExit }) {
  const user = useAuthStore(s => s.user);
  const [role, setRole] = useState(null);
  const defCountry = boot.countries.find(c => c.is_default) || boot.countries[0];
  const [form, setForm] = useState({ name: user?.name || '', phone: user?.phone || '', countryId: defCountry?.id || '', referralCode: '' });
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const submit = async () => {
    setBusy(true); setError('');
    try {
      const country = boot.countries.find(c => c.id === Number(form.countryId));
      await taxiApi('/role', { method: 'POST', body: { role, name: form.name, phone: form.phone, photo: user?.avatar || null,
        countryId: Number(form.countryId) || undefined, language: country?.default_language, referralCode: form.referralCode.trim() || undefined } });
      onDone();
    } catch (e) { setError(e.message); setBusy(false); }
  };

  if (!role) return (
    <Screen>
      <Header title={boot.settings.app?.name || 'OldFace Taxi'} onBack={onExit} />
      <div style={{ flex: 1, overflowY: 'auto', padding: '22px 16px calc(var(--sab) + 20px)' }}>
        <p style={{ fontSize: 22, fontWeight: 900, margin: '0 0 6px' }}>{tx('¿Cómo quieres entrar?')}</p>
        <p style={{ color: C.muted, margin: '0 0 20px', fontSize: 14 }}>{tx('Elige una opción para empezar a usar el taxi de OldFace.')}</p>
        <RoleCard icon="🙋" title={tx('Entrar como Cliente')} text={tx('Pide un taxi, sigue al conductor en el mapa y paga en efectivo, con el monedero o con tarjeta.')} onClick={() => setRole('customer')} />
        <RoleCard icon="🚖" title={tx('Entrar como Conductor')} text={tx('Regístrate con tu vehículo y tus documentos, conéctate y gana dinero haciendo viajes.')} onClick={() => setRole('driver')} />
        <div style={{ display: 'flex', gap: 10, background: '#fef3c7', color: '#92400e', borderRadius: 14, padding: 12, fontSize: 13, fontWeight: 600, marginTop: 6 }}>
          <span>⚠️</span>
          <span>{tx('Solo puedes elegir una vez: un cliente no puede ser conductor y un conductor no puede ser cliente.')}</span>
        </div>
      </div>
    </Screen>
  );

  const isDriver = role === 'driver';
  return (
    <Screen>
      <Header title={isDriver ? tx('Entrar como Conductor') : tx('Entrar como Cliente')} onBack={() => { setRole(null); setAgree(false); setError(''); }} />
      <div style={{ flex: 1, overflowY: 'auto', padding: '18px 16px calc(var(--sab) + 20px)' }}>
        <Card>
          <Field label={tx('Nombre')}><input style={inputStyle} value={form.name} onChange={set('name')} maxLength={80} /></Field>
          <Field label={tx('Teléfono')}><input style={inputStyle} value={form.phone} onChange={set('phone')} inputMode="tel" maxLength={30} /></Field>
          <Field label={tx('País')}>
            <select style={inputStyle} value={form.countryId} onChange={set('countryId')}>
              {boot.countries.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label={tx('Código de invitación (opcional)')}><input style={{ ...inputStyle, textTransform: 'uppercase' }} value={form.referralCode} onChange={set('referralCode')} maxLength={20} /></Field>
        </Card>
        {isDriver && (
          <p style={{ fontSize: 13, color: C.muted, margin: '12px 4px 0' }}>
            {tx('Después tendrás que añadir tu vehículo y subir tus documentos. Podrás conectarte cuando el equipo los apruebe.')}
          </p>
        )}
        <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', margin: '16px 4px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
          <input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} style={{ width: 20, height: 20, accentColor: BRAND, flexShrink: 0 }} />
          <span>{isDriver ? tx('Entiendo que mi cuenta será de conductor y no podré pedir viajes como cliente.')
                          : tx('Entiendo que mi cuenta será de cliente y no podré ser conductor.')}</span>
        </label>
        {error && <p style={{ color: C.danger, fontWeight: 700, fontSize: 14, margin: '0 4px 12px' }}>{error}</p>}
        <Btn onClick={submit} disabled={!agree || busy || !form.name.trim()}>{busy ? tx('Un momento…') : isDriver ? tx('Empezar como Conductor') : tx('Empezar como Cliente')}</Btn>
      </div>
    </Screen>
  );
}

function RoleCard({ icon, title, text, onClick }) {
  return (
    <button onClick={onClick} style={{ width: '100%', textAlign: 'left', display: 'flex', gap: 14, alignItems: 'center', background: 'white', border: `1.5px solid ${C.line}`,
      borderRadius: 18, padding: 16, marginBottom: 12, cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
      <span style={{ width: 56, height: 56, borderRadius: 16, background: '#D5E6F0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 30, flexShrink: 0 }}>{icon}</span>
      <span style={{ flex: 1 }}>
        <span style={{ display: 'block', fontSize: 17, fontWeight: 900, color: BRAND }}>{title}</span>
        <span style={{ display: 'block', fontSize: 13, color: C.muted, marginTop: 3 }}>{text}</span>
      </span>
      <span style={{ color: BRAND, fontSize: 22, fontWeight: 900 }}>›</span>
    </button>
  );
}

