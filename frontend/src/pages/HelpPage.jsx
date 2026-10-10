/**
 * HelpPage — Centro de ayuda: preguntas frecuentes por temas, con buscador.
 * Los textos van en español e inglés aquí mismo (son largos para el diccionario de tr()).
 */
import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import SimplePage, { Card, BRAND } from '../components/SimplePage.jsx';
import { useThemeStore } from '../store/themeStore';
import { LANG, tr } from '../i18n';

const CONTACT_EMAIL = 'info@oldface.app';

const TOPICS = {
  es: [
    { icon: '👋', title: 'Primeros pasos', items: [
      ['¿Cómo entro en OldFace?', 'Escribe tu número de teléfono y tu email. Te enviaremos un código de 6 cifras al email; escríbelo en la app y ya está. El código caduca a los 10 minutos.'],
      ['¿Puedo usar OldFace en el ordenador?', 'Sí. En el ordenador abre oldface.app y pulsa «Vincular con mi móvil (QR)». En el móvil ve a Ajustes → Dispositivos vinculados y escanea el código (o escríbelo).'],
      ['¿Cómo cambio mi nombre o mi foto?', 'En Ajustes, toca la cámara sobre tu foto para cambiarla, o el lápiz junto a tu nombre.'],
    ] },
    { icon: '💬', title: 'Chats', items: [
      ['¿Cómo envío fotos, vídeos o mi ubicación?', 'Dentro de un chat usa el clip o la cámara. La ubicación puede ser la actual o en tiempo real durante 15 minutos, 1 hora u 8 horas.'],
      ['¿Qué es «ver una vez»?', 'Al elegir una foto o un vídeo, pulsa el botón ①. Quien lo reciba solo podrá abrirlo una vez, no podrá descargarlo ni hacer capturas, y se borra del servidor poco después.'],
      ['¿Puedo eliminar o editar un mensaje?', 'Mantén pulsado el mensaje. Puedes eliminarlo para ti o para todos (solo los tuyos) y editar el texto durante 15 minutos después de enviarlo.'],
      ['¿Qué significan los checks?', 'Un check: enviado. Dos checks azules: leído.'],
    ] },
    { icon: '📞', title: 'Llamadas', items: [
      ['¿Cómo llamo o hago una videollamada?', 'Abre el chat y pulsa el teléfono o la cámara arriba. En una llamada de voz puedes activar el vídeo sin colgar y girar la cámara.'],
      ['No me suenan las llamadas con la app cerrada', 'Permite a OldFace mostrar notificaciones a pantalla completa y quítala del ahorro de batería (Ajustes del móvil → Aplicaciones → OldFace → Batería → Sin restricciones). En algunas marcas también hay que activar el «Inicio automático».'],
      ['¿Puedo hacer llamadas de grupo?', 'Sí. Abre el grupo y pulsa llamada o vídeo. Cada persona entra y sale cuando quiere; la llamada sigue mientras quede alguien.'],
    ] },
    { icon: '👥', title: 'Grupos', items: [
      ['¿Cómo creo un grupo?', 'Pulsa «Grupos» en la barra de abajo → Crear grupo nuevo. Elige nombre, foto y participantes.'],
      ['¿Quién puede añadir o quitar personas?', 'Cualquier miembro puede añadir personas. Solo el administrador puede quitarlas. Si el administrador sale, pasa a serlo el siguiente.'],
    ] },
    { icon: '⭕', title: 'Estados', items: [
      ['¿Cuánto duran los estados?', '24 horas. Puedes tener hasta 20 a la vez: 15 fotos y 5 vídeos como máximo.'],
      ['¿Quién ve mis estados?', 'Lo eliges al publicarlo o en Ajustes → Privacidad → Estado: Todos, Mis contactos, Mis contactos excepto… o Nadie. En tus estados verás quién los ha visto.'],
    ] },
    { icon: '🔒', title: 'Privacidad y seguridad', items: [
      ['¿Puedo ocultar mi última vez o mi foto?', 'Sí, en Ajustes → Privacidad. Para cada una elige Todos, Mis contactos, Mis contactos excepto… o Nadie. Quien no pueda ver tu última vez tampoco verá cuándo estás en línea.'],
      ['¿Quiénes son «mis contactos»?', 'Las personas de la agenda de tu móvil que usan OldFace y las personas con las que tienes un chat o un grupo.'],
      ['¿Puedo proteger la app con PIN o huella?', 'Sí, en Ajustes → Bloqueo de la app. Si olvidas el PIN, tendrás que volver a entrar con tu teléfono y el código del email.'],
      ['Veo un dispositivo que no reconozco', 'Ve a Ajustes → Dispositivos vinculados y pulsa «Cerrar sesión» en ese dispositivo.'],
    ] },
    { icon: '🔔', title: 'Avisos', items: [
      ['¿Cómo cambio el sonido de los mensajes?', 'En Ajustes → Sonidos elige el tono en el desplegable. Pulsa ▶ para escucharlo.'],
      ['No me llegan los avisos', 'Comprueba que las notificaciones de OldFace están activadas y que la app no tiene restricciones de batería.'],
    ] },
    { icon: '👤', title: 'Tu cuenta', items: [
      ['¿Cómo elimino mi cuenta?', 'En Ajustes → Ayuda → Eliminar cuenta. Se borran tus datos y tu cuenta para siempre; no se puede deshacer.'],
    ] },
  ],
  en: [
    { icon: '👋', title: 'Getting started', items: [
      ['How do I sign in?', 'Enter your phone number and your email. We will email you a 6-digit code; type it in the app and you are in. The code expires after 10 minutes.'],
      ['Can I use OldFace on my computer?', 'Yes. On the computer open oldface.app and tap “Link with my phone (QR)”. On your phone go to Settings → Linked devices and scan the code (or type it).'],
      ['How do I change my name or photo?', 'In Settings, tap the camera on your photo to change it, or the pencil next to your name.'],
    ] },
    { icon: '💬', title: 'Chats', items: [
      ['How do I send photos, videos or my location?', 'In a chat use the paperclip or the camera. You can share your current location or your live location for 15 minutes, 1 hour or 8 hours.'],
      ['What is “view once”?', 'When you pick a photo or video, tap the ① button. The recipient can open it only once, cannot download it or take screenshots, and it is deleted from the server shortly after.'],
      ['Can I delete or edit a message?', 'Press and hold the message. You can delete it for yourself or for everyone (only your own messages) and edit the text for 15 minutes after sending it.'],
      ['What do the ticks mean?', 'One tick: sent. Two blue ticks: read.'],
    ] },
    { icon: '📞', title: 'Calls', items: [
      ['How do I make a voice or video call?', 'Open the chat and tap the phone or camera at the top. During a voice call you can turn on video without hanging up and switch cameras.'],
      ['Calls don’t ring when the app is closed', 'Allow OldFace to show full-screen notifications and remove it from battery saving (phone Settings → Apps → OldFace → Battery → Unrestricted). Some brands also require turning on “Auto-start”.'],
      ['Can I make group calls?', 'Yes. Open the group and tap call or video. Everyone joins and leaves when they want; the call goes on while someone is in it.'],
    ] },
    { icon: '👥', title: 'Groups', items: [
      ['How do I create a group?', 'Tap “Groups” in the bottom bar → Create new group. Choose a name, a photo and the members.'],
      ['Who can add or remove people?', 'Any member can add people. Only the admin can remove them. If the admin leaves, the next member becomes admin.'],
    ] },
    { icon: '⭕', title: 'Status', items: [
      ['How long do status updates last?', '24 hours. You can have up to 20 at once: at most 15 photos and 5 videos.'],
      ['Who sees my status?', 'You choose when posting, or in Settings → Privacy → Status: Everyone, My contacts, My contacts except… or Nobody. You can see who viewed each of yours.'],
    ] },
    { icon: '🔒', title: 'Privacy and security', items: [
      ['Can I hide my last seen or my photo?', 'Yes, in Settings → Privacy. For each one choose Everyone, My contacts, My contacts except… or Nobody. People who can’t see your last seen won’t see when you are online either.'],
      ['Who are “my contacts”?', 'People in your phone’s address book who use OldFace, and people you have a chat or a group with.'],
      ['Can I lock the app with a PIN or fingerprint?', 'Yes, in Settings → App lock. If you forget the PIN you will have to sign in again with your phone number and the email code.'],
      ['I see a device I don’t recognise', 'Go to Settings → Linked devices and tap “Sign out” on that device.'],
    ] },
    { icon: '🔔', title: 'Notifications', items: [
      ['How do I change the message sound?', 'In Settings → Sounds pick the tone from the drop-down. Tap ▶ to hear it.'],
      ['I don’t get notifications', 'Check that OldFace notifications are on and that the app has no battery restrictions.'],
    ] },
    { icon: '👤', title: 'Your account', items: [
      ['How do I delete my account?', 'In Settings → Help → Delete account. Your data and your account are deleted for good; it can’t be undone.'],
    ] },
  ],
};

export default function HelpPage() {
  const navigate = useNavigate();
  const T = useThemeStore(s => s.colors);
  const isDark = useThemeStore(s => s.isDark);
  const [query, setQuery] = useState('');
  const [open, setOpen]   = useState(null);   // "tema:pregunta"

  const topics = TOPICS[LANG] || TOPICS.es;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return topics;
    return topics
      .map(t => ({ ...t, items: t.items.filter(([qq, a]) => (qq + ' ' + a).toLowerCase().includes(q)) }))
      .filter(t => t.items.length);
  }, [query, topics]);

  return (
    <SimplePage title={tr('Centro de ayuda')} subtitle={tr('Preguntas frecuentes')}>
      <input value={query} onChange={e => setQuery(e.target.value)} placeholder={tr('Buscar en la ayuda…')} aria-label={tr('Buscar en la ayuda…')}
        style={{ width: '100%', boxSizing: 'border-box', padding: '13px 16px', borderRadius: 16, border: `1px solid ${T.borderStrong}`,
                 background: T.bgInput, color: T.textPrimary, fontSize: 15, outline: 'none', fontFamily: 'inherit', marginBottom: 16 }} />

      {filtered.length === 0 && (
        <p style={{ textAlign: 'center', color: T.textSecondary, fontSize: 14, padding: '20px 0' }}>{tr('No hemos encontrado nada. Prueba con otras palabras.')}</p>
      )}

      {filtered.map(topic => (
        <Card key={topic.title}>
          <p style={{ margin: 0, padding: '13px 18px', fontSize: 12, fontWeight: 900, letterSpacing: 0.6, textTransform: 'uppercase',
                      color: T.textSecondary, borderBottom: `1px solid ${T.border}` }}>{topic.icon} {topic.title}</p>
          {topic.items.map(([q, a], i) => {
            const id = `${topic.title}:${i}`;
            const isOpen = open === id || !!query.trim();
            return (
              <div key={id} style={{ borderBottom: i < topic.items.length - 1 ? `1px solid ${T.border}` : 'none' }}>
                <button onClick={() => setOpen(open === id ? null : id)} aria-expanded={isOpen}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', background: 'none',
                           border: 'none', cursor: 'pointer', textAlign: 'left' }}>
                  <span style={{ flex: 1, fontSize: 14, fontWeight: 700, color: T.textPrimary }}>{q}</span>
                  <svg width="16" height="16" fill="none" stroke={T.textMuted} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"
                    style={{ flexShrink: 0, transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
                    <path d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {isOpen && <p style={{ margin: 0, padding: '0 18px 16px', fontSize: 14, lineHeight: 1.6, color: T.textSecondary }}>{a}</p>}
              </div>
            );
          })}
        </Card>
      ))}

      <Card style={{ padding: '18px', background: isDark ? T.bgSurface : '#E3EDF2' }}>
        <p style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 800, color: T.textPrimary }}>{tr('¿No encuentras lo que buscas?')}</p>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: T.textSecondary }}>
          {tr('Escríbenos a')}{' '}<strong style={{ color: isDark ? '#98C1D9' : BRAND, userSelect: 'all' }}>{CONTACT_EMAIL}</strong>{' '}
          {tr('y te responderemos lo antes posible.')}
        </p>
      </Card>

      <button onClick={() => navigate('/legal')}
        style={{ width: '100%', padding: 14, borderRadius: 16, border: `1px solid ${T.borderStrong}`, background: 'transparent',
                 color: T.textPrimary, fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
        {tr('Términos y política de privacidad')}
      </button>
    </SimplePage>
  );
}
