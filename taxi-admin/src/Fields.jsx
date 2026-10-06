/**
 * Fields — editor y celda de cada tipo de campo de resources.js
 *   text · textarea · number · money · percent · bool · select · ref · image · file · date · datetime ·
 *   json · polygon · color · email · phone · password · readonly · owner · permissions
 */
import React, { useEffect, useMemo, useState } from 'react';
import { api, upload } from './api';
import { t, money, dateTime } from './i18n';

// ── Opciones de los selectores de referencia (con caché) ─────────────────────
const optCache = {};
export function useOptions(res, key) {
  const cacheKey = `${res}|${key || 'id'}`;
  const [opts, setOpts] = useState(optCache[cacheKey] || null);
  useEffect(() => {
    if (optCache[cacheKey]) return;
    api(`/options/${res}${key ? `?key=${key}` : ''}`).then(d => { optCache[cacheKey] = d.options; setOpts(d.options); }).catch(() => setOpts([]));
  }, [cacheKey]); // eslint-disable-line
  return opts || [];
}
export const clearOptionsCache = (res) => { for (const k of Object.keys(optCache)) if (k.startsWith(`${res}|`)) delete optCache[k]; };

const BADGE = {
  active: 'green', completed: 'green', paid: 'green', approved: 'green', running: 'green', open: 'amber',
  pending: 'amber', searching: 'amber', accepted: 'amber', arrived: 'amber', started: 'amber', scheduled: 'gray', inactive: 'gray',
  blocked: 'red', cancelled: 'red', expired: 'gray', rejected: 'red', failed: 'red', refunded: 'gray', closed: 'gray', finished: 'gray',
  urgent: 'red', high: 'amber',
};

/** Valor tal y como se ve en la tabla */
export function Cell({ field: f, row, currency }) {
  const v = row[f.name];
  if (f.type === 'ref' || f.type === 'owner') return <span>{row[`${f.name}__label`] ?? (v ?? '—')}</span>;
  if (f.type === 'permissions') return <span className="badge">{row.permissions__count ?? 0} {t('permisos')}</span>;
  if (v === null || v === undefined || v === '') return <span className="muted">—</span>;
  switch (f.type) {
    case 'bool': return v ? <span className="badge green">{t('Sí')}</span> : <span className="badge gray">{t('No')}</span>;
    case 'select': {
      const o = f.options?.find(x => x.value === v);
      return <span className={`badge ${BADGE[v] || ''}`}>{t(o?.label || v)}</span>;
    }
    case 'money': return <span>{money(v, currency?.symbol)}</span>;
    case 'percent': return <span>{v} %</span>;
    case 'image': return <img className="thumb" src={v} alt="" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />;
    case 'file': return <a href={v} target="_blank" rel="noreferrer">{t('Ver archivo')}</a>;
    case 'datetime': return <span>{typeof v === 'number' ? dateTime(v) : String(v).replace('T', ' ')}</span>;
    case 'json': case 'polygon': return <span className="muted">{String(v).length > 40 ? String(v).slice(0, 40) + '…' : String(v)}</span>;
    case 'color': return <span><span style={{ display: 'inline-block', width: 14, height: 14, borderRadius: 4, background: v, verticalAlign: 'middle' }} /> {v}</span>;
    default: return <span>{String(v)}</span>;
  }
}

/** Selector de referencia (ciudad, conductor, rol…) */
function RefSelect({ field: f, value, onChange, disabled }) {
  const opts = useOptions(f.ref, f.refKey);
  return (
    <select className="select" value={value ?? ''} disabled={disabled} onChange={e => onChange(e.target.value === '' ? null : (f.refKey ? e.target.value : Number(e.target.value)))}>
      <option value="">{f.required ? t('— Elige —') : t('— Ninguno —')}</option>
      {opts.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
    </select>
  );
}

/** Subida de imagen o archivo con vista previa */
function UploadField({ field: f, value, onChange, disabled }) {
  const [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const pick = async (file) => {
    if (!file) return;
    setBusy(true); setErr('');
    try { onChange((await upload(file)).url); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      {value && f.type === 'image' && <img className="thumb" src={value} alt="" style={{ width: 54, height: 54 }} />}
      {value && f.type === 'file' && <a href={value} target="_blank" rel="noreferrer">{t('Ver archivo')}</a>}
      {!disabled && <label className="btn small">{busy ? t('Subiendo…') : value ? t('Cambiar') : t('Subir')}
        <input type="file" hidden accept={f.type === 'image' ? 'image/*' : 'image/*,application/pdf'} onChange={e => pick(e.target.files?.[0])} /></label>}
      {value && !disabled && <button type="button" className="btn small danger" onClick={() => onChange(null)}>{t('Quitar')}</button>}
      {err && <span className="error">{err}</span>}
    </div>
  );
}

/** Matriz de permisos de un rol: módulo × ver/crear/editar/borrar */
function PermissionMatrix({ value, onChange, disabled }) {
  const [perms, setPerms] = useState(null);
  useEffect(() => { api('/r/permissions?limit=200&sort=module&dir=asc').then(d => setPerms(d.rows)).catch(() => setPerms([])); }, []);
  const selected = useMemo(() => new Set(value || []), [value]);
  const modules = useMemo(() => {
    const m = {};
    for (const p of perms || []) (m[p.module] ||= {})[p.action] = p.id;
    return m;
  }, [perms]);
  if (!perms) return <span className="muted">{t('Cargando permisos…')}</span>;
  const toggle = (ids, on) => {
    const s = new Set(selected);
    ids.filter(Boolean).forEach(id => (on ? s.add(id) : s.delete(id)));
    onChange([...s]);
  };
  const ACT = [['view', 'Ver'], ['create', 'Crear'], ['edit', 'Editar'], ['delete', 'Borrar']];
  const allIds = perms.map(p => p.id);
  return (
    <div>
      <div className="toolbar">
        <button type="button" className="btn small" disabled={disabled} onClick={() => toggle(allIds, true)}>{t('Marcar todo')}</button>
        <button type="button" className="btn small" disabled={disabled} onClick={() => toggle(allIds, false)}>{t('Desmarcar todo')}</button>
        <span className="muted">{selected.size} / {allIds.length}</span>
      </div>
      <div className="table-wrap" style={{ maxHeight: 380, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 10 }}>
        <table className="perm-matrix">
          <thead><tr><th>{t('Módulo')}</th>{ACT.map(([a, l]) => <th key={a}>{t(l)}</th>)}<th>{t('Todo')}</th></tr></thead>
          <tbody>
            {Object.entries(modules).map(([mod, acts]) => {
              const ids = ACT.map(([a]) => acts[a]);
              const all = ids.filter(Boolean).every(id => selected.has(id));
              return (
                <tr key={mod}>
                  <td><b>{mod}</b></td>
                  {ACT.map(([a]) => <td key={a}>{acts[a] ? <input type="checkbox" disabled={disabled} checked={selected.has(acts[a])} onChange={e => toggle([acts[a]], e.target.checked)} /> : '—'}</td>)}
                  <td><input type="checkbox" disabled={disabled} checked={all} onChange={e => toggle(ids, e.target.checked)} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Editor de un campo en el formulario */
export function FieldInput({ field: f, value, onChange, readOnly }) {
  const disabled = readOnly || f.readonly || f.type === 'readonly' || f.type === 'owner';
  const common = { className: 'input', disabled, value: value ?? '', onChange: e => onChange(e.target.value) };
  switch (f.type) {
    case 'textarea': return <textarea {...common} rows={4} />;
    case 'number': case 'money': case 'percent':
      return <input {...common} type="number" step={f.type === 'number' ? 'any' : '0.01'} onChange={e => onChange(e.target.value === '' ? null : e.target.value)} />;
    case 'bool': return <label className="switch"><input type="checkbox" disabled={disabled} checked={!!Number(value)} onChange={e => onChange(e.target.checked ? 1 : 0)} /> {value ? t('Sí') : t('No')}</label>;
    case 'select':
      return <select {...common} className="select">
        <option value="">{t('— Elige —')}</option>
        {f.options.map(o => <option key={o.value} value={o.value}>{t(o.label)}</option>)}
      </select>;
    case 'ref': return <RefSelect field={f} value={value} onChange={onChange} disabled={disabled} />;
    case 'image': case 'file': return <UploadField field={f} value={value} onChange={onChange} disabled={disabled} />;
    case 'date': return <input {...common} type="date" />;
    case 'datetime':
      if (typeof value === 'number' || disabled) return <input className="input" disabled value={typeof value === 'number' ? dateTime(value) : (value || '—')} />;
      return <input {...common} type="datetime-local" />;
    case 'json': case 'polygon':
      return <textarea {...common} rows={4} style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}
        value={typeof value === 'string' ? value : value ? JSON.stringify(value) : ''} />;
    case 'color': return <input {...common} type="color" style={{ height: 38, padding: 3 }} value={value || '#3D5A80'} />;
    case 'email': return <input {...common} type="email" />;
    case 'phone': return <input {...common} type="tel" />;
    case 'password': return <input {...common} type="password" autoComplete="new-password" placeholder={t('Nueva contraseña')} />;
    case 'permissions': return <PermissionMatrix value={value} onChange={onChange} disabled={disabled} />;
    case 'readonly': case 'owner': return <input className="input" disabled value={value ?? '—'} />;
    default: return <input {...common} type="text" />;
  }
}

/** Campos que ocupan toda la fila del formulario */
export const isWide = (f) => ['textarea', 'json', 'polygon', 'permissions'].includes(f.type);
