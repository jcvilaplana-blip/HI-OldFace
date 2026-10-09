/**
 * PrivacyPage — Política de privacidad
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { tr } from '../i18n';

const BRAND = '#3D5A80';

export default function PrivacyPage() {
  const navigate = useNavigate();

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: '#f8fafc' }}>
      {/* Header */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 10,
        background: 'white', borderBottom: '1px solid #e2e8f0',
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '14px 16px',
      }}>
        <button
          onClick={() => navigate(-1)}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 36, height: 36, borderRadius: '50%',
            color: BRAND,
          }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={BRAND} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
        </button>
        <div>
          <h1 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: '#293241' }}>{tr('Política de privacidad')}</h1>
          <p style={{ margin: 0, fontSize: 11, color: '#94a3b8' }}>{tr('Última actualización: enero 2025')}</p>
        </div>
      </div>

      {/* Contenido */}
      <div style={{ maxWidth: 680, margin: '0 auto', padding: '24px 20px 48px' }}>

        {/* Intro */}
        <div style={{
          background: `linear-gradient(135deg, ${BRAND} 0%, #1a237e 100%)`,
          borderRadius: 18, padding: '22px 24px', marginBottom: 28, color: 'white',
        }}>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.7, opacity: 0.9 }}>{tr('Tu privacidad es importante para nosotros. Esta política explica qué datos recopilamos, cómo los usamos y cuáles son tus derechos al respecto.')}</p>
        </div>

        {[
          {
            title: tr('1. Responsable del tratamiento'),
            body: tr('Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.'),
          },
          {
            title: tr('2. Datos que recopilamos'),
            body: tr('Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.'),
          },
          {
            title: tr('3. Finalidad del tratamiento'),
            body: tr('Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit.'),
          },
          {
            title: tr('4. Base legal'),
            body: tr('Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.'),
          },
          {
            title: tr('5. Conservación de los datos'),
            body: tr('Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.'),
          },
          {
            title: tr('6. Compartición de datos con terceros'),
            body: tr('Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident.'),
          },
          {
            title: tr('7. Tus derechos'),
            body: tr('Lorem ipsum dolor sit amet, consectetur adipiscing elit. Tienes derecho de acceso, rectificación, supresión, portabilidad y oposición al tratamiento de tus datos. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation.'),
          },
          {
            title: tr('8. Seguridad'),
            body: tr('Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.'),
          },
          {
            title: tr('9. Contacto y reclamaciones'),
            body: tr('Lorem ipsum dolor sit amet, consectetur adipiscing elit. Para ejercer tus derechos o presentar una reclamación, contacta con nosotros en privacidad@oldface.app.'),
          },
        ].map((section, i) => (
          <div key={i} style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: 15, fontWeight: 800, color: BRAND, margin: '0 0 8px' }}>{section.title}</h2>
            <p style={{ fontSize: 13, color: '#475569', lineHeight: 1.8, margin: 0 }}>{section.body}</p>
          </div>
        ))}

        {/* Footer */}
        <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 20, marginTop: 12 }}>
          <p style={{ fontSize: 11, color: '#94a3b8', textAlign: 'center', margin: 0 }}>
            © {new Date().getFullYear()}{' '}{tr('OldFace. Todos los derechos reservados.')}</p>
        </div>
      </div>
    </div>
  );
}
