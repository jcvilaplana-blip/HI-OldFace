/**
 * useContacts — Contactos reales del dispositivo
 * Usa @capacitor-community/contacts (compatible con Capacitor v7)
 *
 * DISEÑO: getContacts() directamente — el plugin muestra el diálogo de permisos
 * internamente si es necesario (ver ContactsPlugin.java línea 81/111).
 * No se usa checkPermissions/requestPermissions por separado porque añaden
 * puntos de fallo extra sin beneficio.
 */
import { useState, useCallback } from 'react';
import { tr } from '../i18n';

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';

// Misma lógica que el backend — para comparar teléfonos correctamente
function normalizePhone(phone) {
  const p = String(phone).trim().replace(/\s+/g, '');
  if (p.startsWith('+')) return p;
  if (p.startsWith('0034')) return '+34' + p.slice(4);
  if (p.startsWith('34') && p.length === 11) return '+' + p;
  if (p.length === 9) return '+34' + p;
  return p;
}

export function useContacts() {
  const [contacts,   setContacts]   = useState([]);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState(null);
  const [permDenied, setPermDenied] = useState(false);

  // ── Cargar contactos del dispositivo ──────────────────────────────────────
  const loadContacts = useCallback(async () => {
    setLoading(true);
    setError(null);
    setPermDenied(false);

    try {
      const { Capacitor } = await import('@capacitor/core');
      if (!Capacitor.isNativePlatform()) {
        setError('web');
        setContacts([]);
        setLoading(false);
        return;
      }

      const { Contacts } = await import('@capacitor-community/contacts');

      // Una sola llamada: el plugin pide permisos si hacen falta,
      // muestra el diálogo de Android y devuelve los contactos cuando el usuario acepta.
      // Si el usuario niega → rechaza la promesa → bloque catch.
      const result = await Contacts.getContacts({
        projection: {
          name: true,
          phones: true,
          emails: false,
          image: false,
          postalAddresses: false,
          organization: false,
        },
      });

      const mapped = (result.contacts || [])
        .filter(c => (c.name?.display || c.name?.given) && c.phones?.length > 0)
        .map(c => ({
          id:          c.contactId || String(Math.random()),
          name:        c.name?.display ||
                       `${c.name?.given || ''} ${c.name?.family || ''}`.trim() ||
                       tr('Sin nombre'),
          phone:       c.phones?.[0]?.number || '',
          avatar:      null,
          usesOldFace: false,
        }))
        .sort((a, b) => a.name.localeCompare(b.name, 'es'));

      // Marcar cuáles usan OldFace
      if (mapped.length > 0) {
        try {
          const res = await fetch(`${BACKEND}/check-users`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phones: mapped.map(c => c.phone) }),
          });
          if (res.ok) {
            const data = await res.json();
            const registeredSet = new Set(data.registeredPhones || []);
            mapped.forEach(c => { c.usesOldFace = registeredSet.has(normalizePhone(c.phone)); });
          }
        } catch { /* continuar sin marcar */ }
      }

      setContacts(mapped);

    } catch (err) {
      console.warn('[useContacts] error:', err.message);

      const msg = (err.message || '').toLowerCase();
      if (msg.includes('permission') || msg.includes('denied') || msg.includes('required')) {
        setPermDenied(true);
        setError('denied');
      } else if (msg.includes('web') || msg.includes('unavailable') || msg.includes('not implemented')) {
        setError('web');
      } else {
        setError(err.message || tr('Error desconocido'));
      }
      setContacts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Crear contacto en el dispositivo ─────────────────────────────────────
  const saveContact = useCallback(async ({ name, phone }) => {
    try {
      const { Capacitor } = await import('@capacitor/core');
      if (!Capacitor.isNativePlatform()) return { success: false, error: tr('Solo disponible en la app nativa') };

      const { Contacts } = await import('@capacitor-community/contacts');

      await Contacts.createContact({
        contact: {
          name: { given: name },
          phones: [{ type: 'mobile', number: phone }],
        },
      });

      await loadContacts();
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }, [loadContacts]);

  // ── Abrir ajustes del sistema ─────────────────────────────────────────────
  const openSettings = useCallback(async () => {
    try {
      const { Capacitor } = await import('@capacitor/core');
      if (!Capacitor.isNativePlatform()) return;
      // Android: intent para abrir ajustes de la app directamente
      window.location.href = `intent:#Intent;action=android.settings.APPLICATION_DETAILS_SETTINGS;data=package:com.oldface.app;end`;
    } catch { /* silent */ }
  }, []);

  return { contacts, loading, error, permDenied, loadContacts, saveContact, openSettings };
}
