/**
 * LegalPage — Términos de uso y Política de privacidad (dos pestañas). Rutas /legal, /terms y /privacy.
 * Describe lo que la app hace de verdad con los datos (servidor propio, avisos por Firebase, pagos del taxi
 * con Stripe…). Textos en español e inglés aquí mismo.
 */
import React, { useState } from 'react';
import SimplePage, { Card } from '../components/SimplePage.jsx';
import { useThemeStore } from '../store/themeStore';
import { LANG, tr } from '../i18n';

const UPDATED = { es: 'Última actualización: 10 de octubre de 2026', en: 'Last updated: 10 October 2026' };

const TERMS = {
  es: [
    ['1. Qué es OldFace', 'OldFace es una aplicación de mensajería y comunicación: chats, llamadas y videollamadas, grupos, estados, directos, encuestas, karaoke y un servicio de taxi. Al crear una cuenta o usar la app aceptas estos términos.'],
    ['2. Tu cuenta', 'Para usar OldFace necesitas un número de teléfono y un email donde recibir el código de acceso. Debes tener al menos 14 años. Eres responsable de lo que se haga desde tu cuenta y de mantener seguros tus dispositivos; puedes ver y cerrar las sesiones abiertas en Ajustes → Dispositivos vinculados.'],
    ['3. Uso aceptable', 'No puedes usar OldFace para enviar contenido ilegal, acosar, amenazar o suplantar a otras personas, difundir spam o software dañino, ni intentar acceder a cuentas o sistemas ajenos. Podemos suspender o eliminar cuentas que incumplan estas normas.'],
    ['4. Tu contenido', 'Los mensajes, fotos, vídeos, audios y estados que compartes son tuyos. Nos das permiso para guardarlos y transmitirlos solo lo necesario para prestar el servicio (por ejemplo, para entregarlos a quien se los envías).'],
    ['5. Taxi y pagos', 'El servicio de taxi pone en contacto a clientes con conductores. Los pagos con tarjeta los procesa Stripe; OldFace no guarda los datos de tu tarjeta. Las tarifas, comisiones y condiciones de cancelación se muestran en la app antes de pedir un viaje.'],
    ['6. Disponibilidad', 'Trabajamos para que OldFace funcione siempre, pero puede haber interrupciones por mantenimiento o causas ajenas. Podemos cambiar o retirar funciones; si el cambio es importante te avisaremos en la app.'],
    ['7. Responsabilidad', 'OldFace se ofrece «tal cual». No somos responsables del contenido que envían los usuarios ni de los daños indirectos derivados del uso de la app, salvo en los casos en que la ley no permita esta limitación.'],
    ['8. Baja', 'Puedes eliminar tu cuenta cuando quieras en Ajustes → Ayuda → Eliminar cuenta. Se borrarán tus datos como se explica en la Política de privacidad.'],
    ['9. Ley aplicable', 'Estos términos se rigen por la legislación española. Si eres consumidor, mantienes los derechos que te reconozca la ley de tu país de residencia.'],
    ['10. Contacto', 'Para cualquier consulta sobre estos términos escríbenos a info@oldface.app.'],
  ],
  en: [
    ['1. What OldFace is', 'OldFace is a messaging and communication app: chats, voice and video calls, groups, status updates, live streams, polls, karaoke and a taxi service. By creating an account or using the app you accept these terms.'],
    ['2. Your account', 'To use OldFace you need a phone number and an email address to receive your sign-in code. You must be at least 14 years old. You are responsible for what is done from your account and for keeping your devices secure; you can see and close open sessions in Settings → Linked devices.'],
    ['3. Acceptable use', 'You may not use OldFace to send illegal content, harass, threaten or impersonate others, spread spam or malware, or try to access other people’s accounts or systems. We may suspend or delete accounts that break these rules.'],
    ['4. Your content', 'The messages, photos, videos, audio and status updates you share are yours. You allow us to store and transmit them only as needed to provide the service (for example, to deliver them to the people you send them to).'],
    ['5. Taxi and payments', 'The taxi service connects customers with drivers. Card payments are processed by Stripe; OldFace does not store your card details. Fares, fees and cancellation terms are shown in the app before you request a ride.'],
    ['6. Availability', 'We work to keep OldFace running at all times, but there may be interruptions for maintenance or reasons beyond our control. We may change or remove features; if a change is important we will tell you in the app.'],
    ['7. Liability', 'OldFace is provided “as is”. We are not responsible for content sent by users or for indirect damage arising from use of the app, except where the law does not allow this limitation.'],
    ['8. Closing your account', 'You can delete your account at any time in Settings → Help → Delete account. Your data will be deleted as explained in the Privacy policy.'],
    ['9. Governing law', 'These terms are governed by Spanish law. If you are a consumer, you keep the rights granted by the law of your country of residence.'],
    ['10. Contact', 'For any question about these terms write to info@oldface.app.'],
  ],
};

const PRIVACY = {
  es: [
    ['1. Responsable', 'OldFace es responsable del tratamiento de tus datos. Contacto para temas de privacidad: privacidad@oldface.app.'],
    ['2. Qué datos tratamos', 'Cuenta: teléfono, email (solo para enviarte el código de acceso), nombre, foto de perfil y texto de estado. Contenido: mensajes, fotos, vídeos, notas de voz, stickers, estados y grabaciones de karaoke. Uso: última vez en línea, historial de llamadas (las últimas 100), dispositivos con la sesión iniciada y preferencias (tono, idioma, privacidad). Contactos: comprobamos qué números de tu agenda usan OldFace y guardamos solo esas coincidencias. Ubicación: solo cuando la compartes en un chat o usas el taxi. Pagos del taxi: los procesa Stripe.'],
    ['3. Para qué los usamos', 'Para prestarte el servicio (entregar mensajes y llamadas, mostrar tus estados a quien elijas, enviarte avisos), mantener la seguridad de las cuentas y cumplir obligaciones legales. No vendemos tus datos ni los usamos para publicidad.'],
    ['4. Base legal', 'El contrato que aceptas al usar OldFace (para prestar el servicio), nuestro interés legítimo en mantenerlo seguro y, cuando la ley lo exige, tu consentimiento (por ejemplo, para la ubicación o el acceso a la agenda, que puedes retirar en los permisos del móvil).'],
    ['5. Quién más los ve', 'Las personas con las que hablas y, según tu configuración de privacidad, quienes pueden ver tu foto, tu última vez y tus estados. Proveedores que nos ayudan a prestar el servicio: Google Firebase (avisos al móvil), el proveedor de email que envía los códigos de acceso y Stripe (pagos del taxi). Los mapas, las rutas y las llamadas funcionan en servidores propios de OldFace.'],
    ['6. Cuánto tiempo', 'Los mensajes se guardan hasta que los eliminas o eliminas tu cuenta. Los estados, 24 horas. Las fotos y vídeos de «ver una vez» se borran poco después de que todos los destinatarios los abran. Al eliminar tu cuenta borramos tu perfil, tus chats, tus mensajes en grupos, estados, stickers, llamadas, grabaciones y dispositivos. Los datos de viajes y facturas del taxi se conservan el tiempo que exige la ley.'],
    ['7. Tu privacidad en la app', 'En Ajustes → Privacidad decides quién ve tu última vez, tu foto de perfil y tus estados: Todos, Mis contactos, Mis contactos excepto… o Nadie.'],
    ['8. Tus derechos', 'Puedes acceder a tus datos, corregirlos, eliminarlos (también desde Ajustes → Ayuda → Eliminar cuenta), limitar u oponerte a su tratamiento y pedir una copia, escribiendo a privacidad@oldface.app. Si no quedas satisfecho puedes reclamar ante la Agencia Española de Protección de Datos (www.aepd.es).'],
    ['9. Seguridad', 'Las conexiones van cifradas (HTTPS) y el acceso a tu cuenta requiere un código enviado a tu email. Puedes añadir un PIN o tu huella en Ajustes → Bloqueo de la app.'],
    ['10. Cambios', 'Si cambiamos esta política de forma importante te avisaremos en la app.'],
  ],
  en: [
    ['1. Controller', 'OldFace is responsible for processing your data. Privacy contact: privacidad@oldface.app.'],
    ['2. What data we process', 'Account: phone number, email (only to send you the sign-in code), name, profile photo and about text. Content: messages, photos, videos, voice notes, stickers, status updates and karaoke recordings. Usage: last seen, call history (the latest 100), devices signed in and preferences (tone, language, privacy). Contacts: we check which numbers in your address book use OldFace and keep only those matches. Location: only when you share it in a chat or use the taxi. Taxi payments: processed by Stripe.'],
    ['3. Why we use it', 'To provide the service (deliver messages and calls, show your status to the people you choose, send you notifications), keep accounts secure and meet legal obligations. We do not sell your data or use it for advertising.'],
    ['4. Legal basis', 'The contract you accept by using OldFace (to provide the service), our legitimate interest in keeping it secure and, where the law requires it, your consent (for example for location or address-book access, which you can withdraw in your phone’s permissions).'],
    ['5. Who else sees it', 'The people you talk to and, depending on your privacy settings, those who can see your photo, last seen and status. Providers that help us run the service: Google Firebase (phone notifications), the email provider that sends sign-in codes and Stripe (taxi payments). Maps, routes and calls run on OldFace’s own servers.'],
    ['6. How long', 'Messages are kept until you delete them or delete your account. Status updates, 24 hours. “View once” photos and videos are deleted shortly after every recipient has opened them. When you delete your account we delete your profile, chats, your messages in groups, status updates, stickers, calls, recordings and devices. Taxi trip and invoice data is kept for as long as the law requires.'],
    ['7. Your privacy in the app', 'In Settings → Privacy you decide who sees your last seen, your profile photo and your status: Everyone, My contacts, My contacts except… or Nobody.'],
    ['8. Your rights', 'You can access, correct and delete your data (also from Settings → Help → Delete account), restrict or object to its processing and ask for a copy by writing to privacidad@oldface.app. If you are not satisfied you can complain to the Spanish Data Protection Agency (www.aepd.es) or your local authority.'],
    ['9. Security', 'Connections are encrypted (HTTPS) and signing in requires a code sent to your email. You can add a PIN or your fingerprint in Settings → App lock.'],
    ['10. Changes', 'If we change this policy in an important way we will tell you in the app.'],
  ],
};

export default function LegalPage({ tab: initialTab = 'terms' }) {
  const T = useThemeStore(s => s.colors);
  const isDark = useThemeStore(s => s.isDark);
  const [tab, setTab] = useState(initialTab);
  const lang = LANG === 'es' ? 'es' : 'en';
  const sections = (tab === 'terms' ? TERMS : PRIVACY)[lang];

  const tabBtn = (key, label) => (
    <button key={key} onClick={() => setTab(key)} role="tab" aria-selected={tab === key}
      style={{ flex: 1, padding: '10px 0 12px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 800,
               color: tab === key ? 'white' : 'rgba(255,255,255,0.6)', borderBottom: `3px solid ${tab === key ? 'white' : 'transparent'}` }}>
      {label}
    </button>
  );

  return (
    <SimplePage title={tr('Términos y privacidad')} subtitle={UPDATED[lang]}
      headerExtra={<div role="tablist" style={{ display: 'flex' }}>{tabBtn('terms', tr('Términos de uso'))}{tabBtn('privacy', tr('Privacidad'))}</div>}>
      <Card style={{ padding: '6px 20px 10px' }}>
        {sections.map(([title, body]) => (
          <div key={title} style={{ padding: '14px 0', borderBottom: `1px solid ${T.border}` }}>
            <h2 style={{ fontSize: 15, fontWeight: 800, color: isDark ? '#98C1D9' : '#3D5A80', margin: '0 0 6px' }}>{title}</h2>
            <p style={{ fontSize: 14, color: T.textSecondary, lineHeight: 1.65, margin: 0 }}>{body}</p>
          </div>
        ))}
      </Card>
      <p style={{ fontSize: 11, color: T.textMuted, textAlign: 'center', margin: '8px 0 0' }}>
        © {new Date().getFullYear()} {tr('OldFace. Todos los derechos reservados.')}
      </p>
    </SimplePage>
  );
}
