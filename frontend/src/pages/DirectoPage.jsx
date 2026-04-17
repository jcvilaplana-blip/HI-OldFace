/**
 * DirectoPage — Gestión de sesiones en directo
 * Crear, programar, nombrar, añadir contactos, compartir y cobrar por ver.
 * Solo los usuarios autorizados pueden crear directos.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { useContacts } from '../hooks/useContacts';

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
const BRAND   = '#000080';
const RED     = '#ef4444';

// Usuarios autorizados para crear directos
const DIRECTO_ALLOWED_PHONES = ['641872224', '647148175'];

function isDirectoCreator(user) {
  if (!user?.phone) return false;
  const digits = user.phone.replace(/\D/g, '');
  return DIRECTO_ALLOWED_PHONES.some(p => digits.endsWith(p));
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function formatScheduled(iso) {
  if (!iso) return 'Sin programar';
  const d = new Date(iso);
  return d.toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function statusLabel(status) {
  if (status === 'live')      return { text: '● EN VIVO',    color: RED,     bg: '#fee2e2' };
  if (status === 'ended')     return { text: 'Finalizado',   color: '#94a3b8', bg: '#f1f5f9' };
  return                             { text: 'Programado',   color: BRAND,    bg: '#eff6ff' };
}

// ── Componente principal ──────────────────────────────────────────────────────
export default function DirectoPage() {
  const navigate   = useNavigate();
  const { user }   = useAuthStore();
  const canCreate  = isDirectoCreator(user);

  const [directos, setDirectos]     = useState([]);
  const [loading,  setLoading]      = useState(true);
  const [showForm, setShowForm]     = useState(false);
  const [editing,  setEditing]      = useState(null); // directo being edited

  const loadDirectos = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${BACKEND}/directos`);
      if (res.ok) {
        const data = await res.json();
        setDirectos(data.directos || []);
      }
    } catch (err) {
      console.warn('[DirectoPage] load error:', err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadDirectos(); }, []);

  const handleDelete = async (id) => {
    if (!window.confirm('¿Eliminar este directo?')) return;
    try {
      await fetch(`${BACKEND}/directos/${id}`, { method: 'DELETE' });
      setDirectos(prev => prev.filter(d => d.id !== id));
    } catch { /* silent */ }
  };

  const handleGoLive = async (directo) => {
    // 1. Marcar como live en el backend
    try {
      const res = await fetch(`${BACKEND}/directos/${directo.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'live' }),
      });
      if (res.ok) {
        const updated = await res.json();
        setDirectos(prev => prev.map(d => d.id === updated.id ? updated : d));
      }
    } catch { /* continuar igualmente */ }

    // 2. Navegar a la sala de streaming
    navigate(`/directo/${directo.id}/live`);
  };

  const handleEnd = async (directo) => {
    try {
      const res = await fetch(`${BACKEND}/directos/${directo.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'ended' }),
      });
      if (res.ok) {
        const updated = await res.json();
        setDirectos(prev => prev.map(d => d.id === updated.id ? updated : d));
      }
    } catch { /* silent */ }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', background: '#f8fafc' }}>

      {/* Header */}
      <div style={{
        background: RED, color: 'white', flexShrink: 0,
        paddingTop: 'var(--sat)',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px 14px' }}>
          <button onClick={() => navigate(-1)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 19l-7-7 7-7"/>
            </svg>
          </button>

          {/* Antena pulsante */}
          <div style={{ position: 'relative', width: 36, height: 36 }}>
            <div style={{
              position: 'absolute', inset: 0, borderRadius: '50%',
              background: 'rgba(255,255,255,0.3)',
              animation: 'pulse 1.8s ease-in-out infinite',
            }}/>
            <div style={{
              position: 'relative', width: 36, height: 36, borderRadius: '50%',
              background: 'rgba(255,255,255,0.2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"/>
                <path d="M6.343 6.343a8 8 0 000 11.314M17.657 6.343a8 8 0 010 11.314M3.515 3.515a13 13 0 000 16.97M20.485 3.515a13 13 0 010 16.97"/>
              </svg>
            </div>
          </div>

          <div style={{ flex: 1 }}>
            <h1 style={{ fontSize: 18, fontWeight: 900, margin: 0, lineHeight: 1.1 }}>DIRECTO</h1>
            <p style={{ fontSize: 11, margin: 0, opacity: 0.8 }}>
              {canCreate ? 'Crea y gestiona tus directos' : 'Directos disponibles'}
            </p>
          </div>

          {canCreate && (
            <button
              onClick={() => { setEditing(null); setShowForm(true); }}
              style={{
                background: 'rgba(255,255,255,0.25)', border: 'none', borderRadius: 20,
                padding: '6px 14px', color: 'white', fontWeight: 800, fontSize: 13, cursor: 'pointer',
              }}
            >
              + Nuevo
            </button>
          )}
        </div>
      </div>

      <style>{`
        @keyframes pulse { 0%,100% { transform: scale(1); opacity:0.6 } 50% { transform: scale(1.5); opacity:0 } }
      `}</style>

      {/* Lista de directos */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 0' }}>
        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200 }}>
            <div style={{
              width: 36, height: 36, borderRadius: '50%',
              border: `3px solid #fecaca`, borderTopColor: RED,
              animation: 'spin 0.8s linear infinite',
            }}/>
            <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
          </div>
        )}

        {!loading && directos.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 24px', color: '#94a3b8' }}>
            <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#e2e8f0" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ margin: '0 auto 16px', display: 'block' }}>
              <circle cx="12" cy="12" r="3"/>
              <path d="M6.343 6.343a8 8 0 000 11.314M17.657 6.343a8 8 0 010 11.314M3.515 3.515a13 13 0 000 16.97M20.485 3.515a13 13 0 010 16.97"/>
            </svg>
            <p style={{ fontWeight: 700, fontSize: 15, color: '#64748b', margin: '0 0 6px' }}>
              {canCreate ? 'Ningún directo creado' : 'No hay directos disponibles'}
            </p>
            {canCreate && (
              <p style={{ fontSize: 13, color: '#94a3b8', margin: 0 }}>
                Pulsa "+ Nuevo" para crear tu primer directo
              </p>
            )}
          </div>
        )}

        {!loading && directos.map(d => (
          <DirectoCard
            key={d.id}
            directo={d}
            canManage={canCreate && d.creatorId === user?.id}
            canWatch={d.status === 'live'}
            onEdit={() => { setEditing(d); setShowForm(true); }}
            onDelete={() => handleDelete(d.id)}
            onGoLive={() => handleGoLive(d)}
            onEnd={() => handleEnd(d)}
            onWatch={() => navigate(`/directo/${d.id}/live`)}
          />
        ))}
      </div>

      {/* Modal crear/editar */}
      {showForm && (
        <DirectoForm
          initial={editing}
          user={user}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSaved={(d) => {
            setDirectos(prev => {
              const idx = prev.findIndex(x => x.id === d.id);
              return idx >= 0 ? prev.map(x => x.id === d.id ? d : x) : [d, ...prev];
            });
            setShowForm(false);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

// ── Tarjeta de directo ────────────────────────────────────────────────────────
function DirectoCard({ directo: d, canManage, canWatch, onEdit, onDelete, onGoLive, onEnd, onWatch }) {
  const st = statusLabel(d.status);

  const handleShare = async () => {
    const when = d.scheduledAt ? `\nCuándo: ${formatScheduled(d.scheduledAt)}` : '';
    const price = d.price > 0 ? `\nPrecio: ${d.price}€` : '\nGratis';
    const text = `${d.title}${d.description ? ' — ' + d.description : ''}${when}${price}\nDescarga OldFace: https://oldface.fullstark.es`;
    try {
      if (navigator.share) {
        await navigator.share({ title: d.title, text, url: 'https://oldface.fullstark.es' });
      } else {
        // Fallback: abrir WhatsApp con el texto
        window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
      }
    } catch { /* cancelled */ }
  };
  return (
    <div style={{
      margin: '0 12px 10px', background: 'white', borderRadius: 16,
      boxShadow: '0 1px 6px rgba(0,0,0,0.07)', overflow: 'hidden',
    }}>
      {/* Franja de estado */}
      <div style={{ background: d.status === 'live' ? RED : d.status === 'ended' ? '#f1f5f9' : '#eff6ff', padding: '6px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 10, fontWeight: 800, color: st.color, letterSpacing: '0.5px' }}>{st.text}</span>
        {d.price > 0 && (
          <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 800, color: '#1e293b', background: '#fef9c3', borderRadius: 20, padding: '2px 8px' }}>
            {d.price} € / acceso
          </span>
        )}
      </div>

      <div style={{ padding: '12px 14px' }}>
        <p style={{ fontSize: 15, fontWeight: 900, color: '#1e293b', margin: '0 0 4px' }}>{d.title}</p>
        {d.description && (
          <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 8px' }}>{d.description}</p>
        )}
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 4 }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
            {formatScheduled(d.scheduledAt)}
          </span>
          {d.contacts?.length > 0 && (
            <span style={{ fontSize: 11, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 4 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>
              {d.contacts.length} contacto{d.contacts.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          {/* Botones del creador */}
          {canManage && d.status === 'scheduled' && (
            <button onClick={onGoLive} style={btnStyle(RED, 'white')}>● Iniciar ahora</button>
          )}
          {canManage && d.status === 'live' && (
            <>
              <button onClick={onGoLive} style={btnStyle(RED, 'white')}>● Volver al directo</button>
              <button onClick={onEnd} style={btnStyle('#64748b', 'white')}>Finalizar</button>
            </>
          )}
          {canManage && d.status !== 'live' && (
            <button onClick={onEdit} style={btnStyle('#e2e8f0', '#1e293b')}>Editar</button>
          )}
          {canManage && (
            <button onClick={onDelete} style={btnStyle('#fee2e2', RED)}>Eliminar</button>
          )}

          {/* Botones para la audiencia */}
          {!canManage && d.status === 'live' && (
            <button onClick={onWatch} style={btnStyle(RED, 'white')}>● Ver directo</button>
          )}
          {!canManage && d.status === 'scheduled' && (
            <button onClick={handleShare} style={btnStyle(BRAND, 'white')}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8M16 6l-4-4-4 4M12 2v13"/>
                </svg>
                Compartir
              </span>
            </button>
          )}
          {!canManage && d.status === 'ended' && (
            <span style={{ fontSize: 11, color: '#94a3b8', padding: '6px 0', fontWeight: 600 }}>Este directo ha finalizado</span>
          )}
        </div>
      </div>
    </div>
  );
}

function btnStyle(bg, color) {
  return {
    background: bg, color, border: 'none', borderRadius: 20,
    padding: '6px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
  };
}

// ── Formulario crear / editar directo ─────────────────────────────────────────
function DirectoForm({ initial, user, onClose, onSaved }) {
  const { contacts, loadContacts } = useContacts();

  const [title,       setTitle]       = useState(initial?.title       || '');
  const [description, setDescription] = useState(initial?.description || '');
  const [scheduledAt, setScheduledAt] = useState(
    initial?.scheduledAt ? new Date(initial.scheduledAt).toISOString().slice(0, 16) : ''
  );
  const [price,       setPrice]       = useState(initial?.price       ?? 0);
  const [selected,    setSelected]    = useState(new Set(initial?.contacts || []));
  const [shareAll,    setShareAll]    = useState(false);
  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState('');

  useEffect(() => { loadContacts(); }, []);

  const toggleContact = (phone) => {
    setSelected(prev => {
      const n = new Set(prev);
      n.has(phone) ? n.delete(phone) : n.add(phone);
      return n;
    });
  };

  const handleSave = async () => {
    if (!title.trim()) { setError('El nombre del directo es obligatorio'); return; }
    setSaving(true);
    setError('');

    const contactList = shareAll
      ? contacts.map(c => c.phone)
      : [...selected];

    const body = {
      creatorId:   user.id,
      title:       title.trim(),
      description: description.trim(),
      scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
      contacts:    contactList,
      price:       Number(price) || 0,
    };

    try {
      const url    = initial ? `${BACKEND}/directos/${initial.id}` : `${BACKEND}/directos`;
      const method = initial ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data = await res.json();
        onSaved(data);
      } else {
        const err = await res.json();
        setError(err.error || 'Error guardando el directo');
      }
    } catch (e) {
      setError('Error de conexión');
    } finally {
      setSaving(false);
    }
  };

  const oldFaceContacts = contacts.filter(c => c.usesOldFace);
  const otherContacts   = contacts.filter(c => !c.usesOldFace);

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 60,
      background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'flex-end',
    }}>
      <div style={{
        width: '100%', background: 'white', borderRadius: '24px 24px 0 0',
        maxHeight: '92vh', overflowY: 'auto',
        paddingBottom: 'env(safe-area-inset-bottom, 24px)',
      }}>
        {/* Handle */}
        <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0 4px' }}>
          <div style={{ width: 40, height: 4, background: '#cbd5e1', borderRadius: 2 }}/>
        </div>

        {/* Title bar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 16px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: '50%', background: RED, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"/>
                <path d="M6.343 6.343a8 8 0 000 11.314M17.657 6.343a8 8 0 010 11.314"/>
              </svg>
            </div>
            <h2 style={{ fontSize: 16, fontWeight: 900, color: '#1e293b', margin: 0 }}>
              {initial ? 'Editar directo' : 'Nuevo directo'}
            </h2>
          </div>
          <button onClick={onClose} style={{ background: '#f1f5f9', border: 'none', borderRadius: '50%', width: 30, height: 30, cursor: 'pointer', fontSize: 16, fontWeight: 800, color: '#64748b' }}>
            ✕
          </button>
        </div>

        <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Nombre */}
          <Field label="Nombre del directo *">
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Ej: Clase de cocina en vivo"
              style={inputStyle}
            />
          </Field>

          {/* Descripción */}
          <Field label="Descripción">
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Cuéntales de qué va..."
              rows={3}
              style={{ ...inputStyle, resize: 'none' }}
            />
          </Field>

          {/* Fecha y hora */}
          <Field label="Fecha y hora de inicio">
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={e => setScheduledAt(e.target.value)}
              style={inputStyle}
            />
          </Field>

          {/* Precio */}
          <Field label="Precio de acceso (€)">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="number"
                min="0"
                step="0.50"
                value={price}
                onChange={e => setPrice(e.target.value)}
                style={{ ...inputStyle, width: 100 }}
              />
              <span style={{ fontSize: 12, color: '#64748b' }}>
                {Number(price) === 0 ? 'Gratis' : `${Number(price).toFixed(2)} € por espectador`}
              </span>
            </div>
          </Field>

          {/* Compartir */}
          <Field label="Compartir con">
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '10px 12px', background: '#f8fafc', borderRadius: 12, marginBottom: 8 }}>
              <input
                type="checkbox"
                checked={shareAll}
                onChange={e => setShareAll(e.target.checked)}
                style={{ width: 18, height: 18, accentColor: RED }}
              />
              <div>
                <p style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', margin: 0 }}>Todos mis contactos</p>
                <p style={{ fontSize: 11, color: '#94a3b8', margin: 0 }}>Notificar a todos cuando empiece el directo</p>
              </div>
            </label>

            {!shareAll && (
              <>
                {oldFaceContacts.length > 0 && (
                  <>
                    <p style={{ fontSize: 10, fontWeight: 800, color: RED, letterSpacing: '0.5px', margin: '8px 0 4px' }}>EN OLDFACE</p>
                    {oldFaceContacts.map(c => (
                      <ContactCheck
                        key={c.id}
                        contact={c}
                        checked={selected.has(c.phone)}
                        onChange={() => toggleContact(c.phone)}
                      />
                    ))}
                  </>
                )}
                {otherContacts.slice(0, 10).length > 0 && (
                  <>
                    <p style={{ fontSize: 10, fontWeight: 800, color: '#94a3b8', letterSpacing: '0.5px', margin: '8px 0 4px' }}>OTROS CONTACTOS</p>
                    {otherContacts.slice(0, 10).map(c => (
                      <ContactCheck
                        key={c.id}
                        contact={c}
                        checked={selected.has(c.phone)}
                        onChange={() => toggleContact(c.phone)}
                      />
                    ))}
                  </>
                )}
                {contacts.length === 0 && (
                  <p style={{ fontSize: 12, color: '#94a3b8', padding: '8px 0' }}>
                    Los contactos solo están disponibles en la app Android/iOS
                  </p>
                )}
              </>
            )}
          </Field>

          {error && (
            <p style={{ fontSize: 12, color: RED, background: '#fee2e2', padding: '10px 14px', borderRadius: 10, margin: 0 }}>
              {error}
            </p>
          )}

          {/* Botones */}
          <div style={{ display: 'flex', gap: 10, paddingBottom: 8 }}>
            <button onClick={onClose} style={{ flex: 1, padding: '14px', background: '#f1f5f9', border: 'none', borderRadius: 14, fontWeight: 700, fontSize: 14, cursor: 'pointer', color: '#64748b' }}>
              Cancelar
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              style={{ flex: 2, padding: '14px', background: saving ? '#fca5a5' : RED, border: 'none', borderRadius: 14, fontWeight: 800, fontSize: 14, cursor: saving ? 'not-allowed' : 'pointer', color: 'white', boxShadow: '0 4px 14px rgba(239,68,68,0.35)' }}
            >
              {saving ? 'Guardando...' : initial ? 'Guardar cambios' : 'Crear directo'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Sub-componentes utilitarios ───────────────────────────────────────────────
function Field({ label, children }) {
  return (
    <div>
      <p style={{ fontSize: 11, fontWeight: 800, color: '#64748b', letterSpacing: '0.4px', margin: '0 0 6px' }}>{label.toUpperCase()}</p>
      {children}
    </div>
  );
}

function ContactCheck({ contact, checked, onChange }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', cursor: 'pointer', borderBottom: '0.5px solid #f1f5f9' }}>
      <input type="checkbox" checked={checked} onChange={onChange} style={{ width: 16, height: 16, accentColor: RED }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{contact.name}</p>
        <p style={{ fontSize: 11, color: '#94a3b8', margin: 0 }}>{contact.phone}</p>
      </div>
    </label>
  );
}

const inputStyle = {
  width: '100%',
  padding: '11px 14px',
  borderRadius: 12,
  border: '1.5px solid #e2e8f0',
  fontSize: 14,
  color: '#1e293b',
  background: 'white',
  outline: 'none',
  boxSizing: 'border-box',
  fontFamily: 'inherit',
};
