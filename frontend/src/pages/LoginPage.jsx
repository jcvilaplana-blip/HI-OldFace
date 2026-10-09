/**
 * LoginPage - Autenticación real por OTP SMS
 */
import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { takePendingLink } from '../utils/deepLinks';
import { deviceInfo } from '../utils/devices';
import LinkDevicePanel from '../components/LinkDevicePanel.jsx';
import { tr } from '../i18n';

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';

// ── Autofill helpers (@capgo/capacitor-autofill-save-password) ──────────────
async function autofillRead() {
  try {
    const { Capacitor } = await import('@capacitor/core');
    if (!Capacitor.isNativePlatform()) return null;
    const { SavePassword } = await import('@capgo/capacitor-autofill-save-password');
    const saved = await SavePassword.readPassword();
    return saved?.username || null; // username = phone number
  } catch { return null; }
}

async function autofillSave(phone) {
  try {
    const { Capacitor } = await import('@capacitor/core');
    if (!Capacitor.isNativePlatform()) return;
    const { SavePassword } = await import('@capgo/capacitor-autofill-save-password');
    await SavePassword.promptDialog({ username: phone, password: '' });
  } catch { /* silent — usuario canceló o no disponible */ }
}

export default function LoginPage() {
  const navigate = useNavigate();
  const { setUser, generateUserId } = useAuthStore();

  const [phone, setPhone] = useState('');
  const [phoneNormalized, setPhoneNormalized] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [step, setStep] = useState('form'); // form | otp | loading | link
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);
  const [sentChannel, setSentChannel] = useState('email');
  const [termsAccepted, setTermsAccepted] = useState(false);

  // Intentar prellenar el teléfono guardado por autofill
  useEffect(() => {
    autofillRead().then(saved => {
      if (saved) setPhone(saved);
    });
  }, []);

  const normalizePhone = (raw) => {
    const digits = raw.trim().replace(/\s+/g, '');
    if (digits.startsWith('+')) return digits;
    if (digits.startsWith('00')) return '+' + digits.slice(2);
    // Sin prefijo — asumir España +34
    return '+34' + digits;
  };

  const handleSendOtp = async () => {
    if (!phone.trim() || !name.trim()) return;
    setLoading(true);
    setError('');

    const normalized = normalizePhone(phone);
    setPhoneNormalized(normalized);

    try {
      const res = await fetch(`${BACKEND}/send-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: normalized, email: email.trim() }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || tr('Error enviando el código'));
        setLoading(false);
        return;
      }

      setSentChannel(data.channel || 'email');
      setStep('otp');
      startResendCooldown();
    } catch (err) {
      setError(tr('Error de red: {p0}', { p0: err.message || 'Sin respuesta del servidor' }));
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (otp.length < 6) return;
    setLoading(true);
    setError('');

    try {
      const res = await fetch(`${BACKEND}/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phoneNormalized, code: otp.trim(), name: name.trim(), ...deviceInfo() }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || tr('Código incorrecto'));
        setLoading(false);
        return;
      }

      // OTP verificado — completar login
      setStep('loading');
      const userId = data.userId || generateUserId(phone);

      // Recuperar avatar guardado en el backend (si el usuario ya había subido uno)
      let savedAvatar = data.user?.avatar || null;
      if (!savedAvatar) {
        try {
          const avatarRes = await fetch(`${BACKEND}/user/avatar/${userId}`);
          if (avatarRes.ok) {
            const avatarData = await avatarRes.json();
            savedAvatar = avatarData.avatar || null;
          }
        } catch { /* silencioso */ }
      }

      const userData = {
        id: userId,
        name: name.trim(),
        phone: phone.trim(),
        avatar: savedAvatar,
        createdAt: Date.now(),
      };

      if (data.rtcToken) useAuthStore.getState().setRtcToken(data.rtcToken);
      setUser(userData);

      // Ofrecer guardar el teléfono en el autofill del dispositivo
      autofillSave(phoneNormalized);

      // Si se abrió la app desde un enlace compartido (p. ej. un directo), ir ahí
      navigate(takePendingLink() || '/', { replace: true });

    } catch {
      setError(tr('Error de conexión. Inténtalo de nuevo.'));
      setLoading(false);
    }
  };

  const handleResend = async (channel = 'sms') => {
    if (resendCooldown > 0) return;
    setOtp('');
    setError('');
    setLoading(true);

    try {
      const res = await fetch(`${BACKEND}/send-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phoneNormalized, email: email.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || tr('Error reenviando el código'));
      } else {
        setSentChannel(data.channel || 'email');
        startResendCooldown();
      }
    } catch {
      setError(tr('Error de conexión.'));
    } finally {
      setLoading(false);
    }
  };

  const startResendCooldown = () => {
    setResendCooldown(60);
    const interval = setInterval(() => {
      setResendCooldown(prev => {
        if (prev <= 1) { clearInterval(interval); return 0; }
        return prev - 1;
      });
    }, 1000);
  };

  return (
    /* Contenedor scrollable — ocupa todo el viewport sin romper el overflow:hidden del root */
    <div style={{ height: '100%', overflowY: 'auto', background: 'linear-gradient(135deg, #E3EDF2 0%, #D5E6F0 100%)' }}>
      <div style={{ minHeight: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px 24px 0' }}>

        {/* Logo */}
        <div className="mb-10 flex flex-col items-center animate-scale-in">
          <div className="mb-4">
            <img src="/logo-oldface.png" alt="OldFace" className="w-28 h-28 object-contain drop-shadow-2xl"
                 onError={(e) => { e.target.style.display='none'; }} />
          </div>
          <p className="text-oldface-500 text-sm mt-1 font-medium">{tr('Conecta con quien más quieres')}</p>
        </div>

        {/* Card */}
        <div className="w-full max-w-sm bg-white rounded-3xl shadow-xl p-8 animate-slide-up">

        {step === 'loading' && (
          <div className="flex flex-col items-center py-8">
            <div className="w-16 h-16 border-4 border-oldface-200 border-t-oldface-500 rounded-full animate-spin mb-4" />
            <p className="text-oldface-600 font-semibold">{tr('Iniciando sesión...')}</p>
          </div>
        )}

        {step === 'form' && (
          <>
            <h2 className="text-xl font-bold text-gray-800 mb-6">{tr('Tu número de teléfono')}</h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-600 mb-2">{tr('Tu nombre')}</label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder={tr('Ej: María García')}
                  className="w-full px-4 py-3 rounded-2xl border-2 border-gray-100 focus:border-oldface-400 outline-none text-gray-800 font-medium transition-colors"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-600 mb-2">{tr('Teléfono')}</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  placeholder="+34 600 000 000"
                  className="w-full px-4 py-3 rounded-2xl border-2 border-gray-100 focus:border-oldface-400 outline-none text-gray-800 font-medium transition-colors"
                />
                <p className="text-xs text-gray-400 mt-1">{tr('Incluye el prefijo internacional (ej: +34)')}</p>
              </div>

              {error && (
                <p className="text-sm text-red-500 font-medium bg-red-50 px-4 py-3 rounded-2xl">{error}</p>
              )}

              <div>
                <label className="block text-sm font-semibold text-gray-600 mb-2">{tr('Email')}</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder={tr('tu@email.com')}
                  className="w-full px-4 py-3 rounded-2xl border-2 border-gray-100 focus:border-oldface-400 outline-none text-gray-800 font-medium transition-colors"
                />
                <p className="text-xs text-gray-400 mt-1">{tr('Recibirás el código aquí')}</p>
              </div>

              {/* Checkbox de aceptación legal */}
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={termsAccepted}
                  onChange={e => setTermsAccepted(e.target.checked)}
                  style={{
                    marginTop: 2, width: 18, height: 18, flexShrink: 0,
                    accentColor: '#3D5A80', cursor: 'pointer',
                  }}
                />
                <span style={{ fontSize: 12, color: '#64748b', lineHeight: 1.6 }}>{tr('He leído y acepto los')}{' '}
                  <Link to="/terms" style={{ color: '#3D5A80', fontWeight: 600, textDecoration: 'underline' }}>{tr('Términos y condiciones')}</Link>
                  {', '}{tr('la')}{' '}
                  <Link to="/privacy" style={{ color: '#3D5A80', fontWeight: 600, textDecoration: 'underline' }}>{tr('Política de privacidad')}</Link>
                  {' '}{tr('y la')}{' '}
                  <Link to="/cookies" style={{ color: '#3D5A80', fontWeight: 600, textDecoration: 'underline' }}>{tr('Política de cookies')}</Link>
                  {' '}{tr('de OldFace.')}</span>
              </label>

              <button
                onClick={handleSendOtp}
                disabled={!phone.trim() || !name.trim() || !email.trim() || !termsAccepted || loading}
                className="w-full py-4 bg-oldface-500 text-white rounded-2xl font-bold text-lg disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 transition-all shadow-lg shadow-blue-100"
              >
                {loading ? tr('Enviando...') : tr('Enviar código →')}
              </button>

              {/* Ordenador o tablet: entrar con la cuenta del móvil escaneando un QR */}
              <div className="pt-2 border-t border-gray-100">
                <button
                  onClick={() => { setError(''); setStep('link'); }}
                  className="w-full py-3 rounded-2xl font-bold text-sm text-oldface-500 bg-oldface-50 active:scale-95 transition-all flex items-center justify-center gap-2"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>
                    <path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3"/>
                  </svg>{tr('Vincular con mi móvil (QR)')}</button>
                <p className="text-xs text-gray-400 mt-1 text-center">{tr('Para usar OldFace en el ordenador o en una tablet')}</p>
              </div>
            </div>
          </>
        )}

        {step === 'link' && (
          <LinkDevicePanel
            onBack={() => setStep('form')}
            onLinked={(r) => {
              setStep('loading');
              if (r.rtcToken) useAuthStore.getState().setRtcToken(r.rtcToken);
              setUser({
                id: r.user.userId, name: r.user.name, phone: r.user.phone, avatar: r.user.avatar,
                status: r.user.status || undefined, createdAt: Date.now(),
              });
              navigate(takePendingLink() || '/', { replace: true });
            }}
          />
        )}

        {step === 'otp' && (
          <>
            <button onClick={() => { setStep('form'); setError(''); }} className="mb-4 text-oldface-500 font-semibold text-sm flex items-center gap-1">{tr('← Atrás')}</button>

            <h2 className="text-xl font-bold text-gray-800 mb-2">{tr('Verificar código')}</h2>
            <p className="text-gray-500 text-sm mb-6">{tr('Código enviado a')}{' '}<strong>{email.trim() || phoneNormalized}</strong>{tr('. Revisa tu bandeja de entrada.')}</p>

            <input
              type="number"
              value={otp}
              onChange={e => setOtp(e.target.value.slice(0, 6))}
              placeholder="______"
              className="w-full px-4 py-4 rounded-2xl border-2 border-gray-100 focus:border-oldface-400 outline-none text-gray-800 font-bold text-2xl text-center tracking-widest mb-4 transition-colors"
              autoFocus
            />

            {error && (
              <p className="text-sm text-red-500 font-medium bg-red-50 px-4 py-3 rounded-2xl mb-4">{error}</p>
            )}

            <button
              onClick={handleVerifyOtp}
              disabled={otp.length < 6 || loading}
              className="w-full py-4 bg-oldface-500 text-white rounded-2xl font-bold text-lg disabled:opacity-50 active:scale-95 transition-all shadow-lg shadow-blue-100 mb-4"
            >
              {loading ? tr('Verificando...') : tr('Verificar ✓')}
            </button>

            <button
              onClick={() => handleResend()}
              disabled={resendCooldown > 0 || loading}
              className="w-full py-2 text-sm text-oldface-500 font-semibold disabled:opacity-40"
            >
              {resendCooldown > 0 ? tr('Reenviar en {resendCooldown}s', { resendCooldown }) : tr('No recibí el código — Reenviar')}
            </button>
          </>
        )}
        </div>

        {/* Footer legal */}
        <footer style={{ width: '100%', maxWidth: 384, textAlign: 'center', padding: '28px 0 32px', color: '#9ca3af', fontSize: 11 }}>
          <p style={{ marginBottom: 10 }}>© {new Date().getFullYear()}{' '}{tr('OldFace. Todos los derechos reservados.')}</p>
          <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: '6px 14px' }}>
            <Link to="/terms" style={{ color: '#3D5A80', textDecoration: 'none', fontWeight: 500 }}>{tr('Términos y condiciones')}</Link>
            <span style={{ color: '#d1d5db' }}>·</span>
            <Link to="/privacy" style={{ color: '#3D5A80', textDecoration: 'none', fontWeight: 500 }}>{tr('Privacidad')}</Link>
            <span style={{ color: '#d1d5db' }}>·</span>
            <Link to="/cookies" style={{ color: '#3D5A80', textDecoration: 'none', fontWeight: 500 }}>{tr('Cookies')}</Link>
          </div>
        </footer>

      </div>
    </div>
  );
}
