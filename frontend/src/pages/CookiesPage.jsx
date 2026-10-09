/**
 * CookiesPage — Política de cookies
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { tr } from '../i18n';

const BRAND = '#3D5A80';

const COOKIE_TYPES = [
  {
    icon: '🔒',
    name: tr('Cookies esenciales'),
    desc: tr('Necesarias para el funcionamiento básico de la app (sesión, autenticación).'),
    required: true,
  },
  {
    icon: '📊',
    name: tr('Cookies analíticas'),
    desc: tr('Nos ayudan a entender cómo se usa la aplicación para mejorarla.'),
    required: false,
  },
  {
    icon: '🎯',
    name: tr('Cookies funcionales'),
    desc: tr('Recuerdan tus preferencias (tema, idioma) para personalizar tu experiencia.'),
    required: false,
  },
];

export default function CookiesPage() {
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
          <h1 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: '#293241' }}>{tr('Política de cookies')}</h1>
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
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.7, opacity: 0.9 }}>{tr('Usamos cookies y tecnologías similares para que OldFace funcione correctamente y para mejorar tu experiencia. Aquí te explicamos qué son y cómo las usamos.')}</p>
        </div>

        {/* Tipos de cookies — cards visuales */}
        <h2 style={{ fontSize: 15, fontWeight: 800, color: BRAND, margin: '0 0 14px' }}>{tr('Tipos de cookies que utilizamos')}</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 28 }}>
          {COOKIE_TYPES.map((c, i) => (
            <div key={i} style={{
              background: 'white', borderRadius: 14, padding: '14px 16px',
              boxShadow: '0 1px 6px rgba(0,0,0,0.06)',
              display: 'flex', alignItems: 'flex-start', gap: 14,
            }}>
              <span style={{ fontSize: 24, flexShrink: 0, lineHeight: 1 }}>{c.icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                  <p style={{ fontSize: 13, fontWeight: 800, color: '#293241', margin: 0 }}>{c.name}</p>
                  {c.required && (
                    <span style={{
                      fontSize: 10, fontWeight: 700, color: BRAND,
                      background: '#E3EDF2', borderRadius: 6, padding: '2px 7px',
                    }}>{tr('Obligatoria')}</span>
                  )}
                </div>
                <p style={{ fontSize: 12, color: '#64748b', margin: 0, lineHeight: 1.6 }}>{c.desc}</p>
              </div>
            </div>
          ))}
        </div>

        {[
          {
            title: tr('1. ¿Qué son las cookies?'),
            body: tr('Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.'),
          },
          {
            title: tr('2. Cookies propias y de terceros'),
            body: tr('Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident.'),
          },
          {
            title: tr('3. Duración de las cookies'),
            body: tr('Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.'),
          },
          {
            title: tr('4. Cómo gestionar las cookies'),
            body: tr('Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Puedes configurar tu navegador o dispositivo para rechazar o eliminar cookies en cualquier momento. Ten en cuenta que deshabilitar ciertas cookies puede afectar al funcionamiento de la aplicación.'),
          },
          {
            title: tr('5. Actualizaciones de esta política'),
            body: tr('Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.'),
          },
          {
            title: tr('6. Contacto'),
            body: tr('Lorem ipsum dolor sit amet, consectetur adipiscing elit. Para cualquier duda sobre nuestra política de cookies, puedes escribirnos a cookies@oldface.app.'),
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
