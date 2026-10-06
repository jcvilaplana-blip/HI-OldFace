/**
 * ResourcePage — sección CRUD genérica (generada desde resources.js del servidor)
 *   listado con búsqueda, filtros, orden y paginación · ver / crear / editar / borrar según permisos
 *   + acciones propias: traducciones (idiomas), conversación (tickets), ajuste de saldo (monederos), preguntas (FAQ)
 */
import React, { useCallback, useEffect, useState } from 'react';
import { api, qs } from './api';
import { t, money, dateTime } from './i18n';
import { Cell, FieldInput, isWide, clearOptionsCache } from './Fields';

export default function ResourcePage({ res, currency, initialFilters = {}, notify, go }) {
  const [rows, setRows] = useState([]), [total, setTotal] = useState(0), [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(''), [page, setPage] = useState(1), [sort, setSort] = useState({ col: '', dir: 'desc' });
  const [filters, setFilters] = useState(initialFilters);
  const [editing, setEditing] = useState(null);   // { mode: 'create'|'edit'|'view', row }
  const [extra, setExtra] = useState(null);       // { kind, row }
  const can = (op) => res.ops.includes(op);
  const listFields = res.fields.filter(f => f.list);
  const filterFields = (res.filters || []).map(n => res.fields.find(f => f.name === n)).filter(f => f && ['select', 'bool', 'ref'].includes(f.type));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const fq = Object.fromEntries(Object.entries(filters).map(([k, v]) => [`f_${k}`, v]));
      const d = await api(`/r/${res.key}${qs({ search, page, limit: 25, sort: sort.col, dir: sort.dir, ...fq })}`);
      setRows(d.rows); setTotal(d.total);
    } catch (e) { notify(e.message, true); }
    finally { setLoading(false); }
  }, [res.key, search, page, sort, filters]); // eslint-disable-line

  useEffect(() => { const h = setTimeout(load, search ? 250 : 0); return () => clearTimeout(h); }, [load]); // eslint-disable-line
  useEffect(() => { setPage(1); }, [search, filters]);

  const open = async (mode, row) => {
    if (mode === 'create') {
      const def = Object.fromEntries(res.fields.filter(f => f.default !== undefined).map(f => [f.name, f.default]));
      return setEditing({ mode, row: { ...def, ...initialFilters } });
    }
    try { setEditing({ mode, row: (await api(`/r/${res.key}/${row.id}`)).row }); } catch (e) { notify(e.message, true); }
  };

  const remove = async (row) => {
    if (!window.confirm(t('¿Borrar este registro? No se puede deshacer.'))) return;
    try { await api(`/r/${res.key}/${row.id}`, { method: 'DELETE' }); notify(t('Borrado')); clearOptionsCache(res.key); load(); }
    catch (e) { notify(e.message, true); }
  };

  const pages = Math.max(1, Math.ceil(total / 25));
  const toggleSort = (col) => setSort(s => ({ col, dir: s.col === col && s.dir === 'desc' ? 'asc' : 'desc' }));

  return (
    <div className="card">
      <div className="toolbar">
        {res.search?.length > 0 && <input className="input search" placeholder={t('Buscar…')} value={search} onChange={e => setSearch(e.target.value)} />}
        {filterFields.map(f => <FilterSelect key={f.name} field={f} value={filters[f.name] ?? ''} onChange={v => setFilters(x => ({ ...x, [f.name]: v }))} />)}
        <span className="muted" style={{ flex: 1 }}>{total} {t('registros')}</span>
        {can('create') && <button className="btn primary" onClick={() => open('create')}>＋ {t('Nuevo')}</button>}
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {listFields.map(f => <th key={f.name} onClick={() => !f.virtual && f.type !== 'permissions' && toggleSort(f.name)}>
                {t(f.label)}{sort.col === f.name ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</th>)}
              <th />
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 && <tr><td colSpan={listFields.length + 1} className="muted">{t('Cargando…')}</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={listFields.length + 1} className="muted">{t('No hay registros')}</td></tr>}
            {rows.map(row => (
              <tr key={row.id}>
                {listFields.map(f => <td key={f.name}><Cell field={f} row={row} currency={currency} /></td>)}
                <td className="actions">
                  <RowExtras res={res} row={row} setExtra={setExtra} go={go} />
                  {can('edit') ? <button className="btn small" onClick={() => open('edit', row)}>{t('Editar')}</button>
                               : <button className="btn small" onClick={() => open('view', row)}>{t('Ver')}</button>}
                  {can('delete') && <button className="btn small danger" onClick={() => remove(row)}>{t('Borrar')}</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="pager">
          <button className="btn small" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>‹</button>
          <span>{t('Página {p} de {n}', { p: page, n: pages })}</span>
          <button className="btn small" disabled={page >= pages} onClick={() => setPage(p => p + 1)}>›</button>
        </div>
      )}

      {editing && <EditModal res={res} editing={editing} close={() => setEditing(null)}
                             saved={() => { setEditing(null); clearOptionsCache(res.key); load(); notify(t('Guardado')); }} />}
      {extra?.kind === 'translations' && <TranslationsModal row={extra.row} kind={extra.kindOf} close={() => setExtra(null)} notify={notify} />}
      {extra?.kind === 'ticket' && <TicketModal row={extra.row} close={() => { setExtra(null); load(); }} notify={notify} canReply={can('edit')} />}
      {extra?.kind === 'wallet' && <WalletModal row={extra.row} currency={currency} close={() => setExtra(null)} done={() => { setExtra(null); load(); }} notify={notify} />}
    </div>
  );
}

function FilterSelect({ field: f, value, onChange }) {
  if (f.type === 'ref') return <RefFilter field={f} value={value} onChange={onChange} />;
  const options = f.type === 'bool' ? [{ value: '1', label: 'Sí' }, { value: '0', label: 'No' }] : f.options;
  return (
    <select className="select" style={{ width: 'auto' }} value={value} onChange={e => onChange(e.target.value)}>
      <option value="">{t(f.label)}: {t('todos')}</option>
      {options.map(o => <option key={o.value} value={o.value}>{t(o.label)}</option>)}
    </select>
  );
}
function RefFilter({ field: f, value, onChange }) {
  const [opts, setOpts] = useState([]);
  useEffect(() => { api(`/options/${f.ref}`).then(d => setOpts(d.options)).catch(() => {}); }, [f.ref]);
  return (
    <select className="select" style={{ width: 'auto', maxWidth: 220 }} value={value} onChange={e => onChange(e.target.value)}>
      <option value="">{t(f.label)}: {t('todos')}</option>
      {opts.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
    </select>
  );
}

/** Acciones extra de algunas secciones */
function RowExtras({ res, row, setExtra, go }) {
  if (res.key === 'languages') return <>
    <button className="btn small" onClick={() => setExtra({ kind: 'translations', kindOf: 'app', row })}>{t('Textos app')}</button>
    <button className="btn small" onClick={() => setExtra({ kind: 'translations', kindOf: 'panel', row })}>{t('Textos panel')}</button>
  </>;
  if (res.key === 'support_tickets') return <button className="btn small primary" onClick={() => setExtra({ kind: 'ticket', row })}>{t('Conversación')}</button>;
  if (res.key === 'wallets' && res.ops.includes('edit')) return <button className="btn small" onClick={() => setExtra({ kind: 'wallet', row })}>{t('Ajustar saldo')}</button>;
  if (res.key === 'faq_categories') return <button className="btn small" onClick={() => go(`r/faqs?category_id=${row.id}`)}>{t('Preguntas')}</button>;
  return null;
}

/** Formulario de creación / edición / consulta */
function EditModal({ res, editing, close, saved }) {
  const [data, setData] = useState(editing.row);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const readOnly = editing.mode === 'view';
  const fields = res.fields.filter(f => !f.virtual && !(editing.mode === 'create' && (f.readonly || f.type === 'readonly')));
  const title = { create: t('Nuevo'), edit: t('Editar'), view: t('Ver') }[editing.mode] + ' · ' + t(res.label);

  const save = async () => {
    setBusy(true); setError('');
    try {
      const body = {};
      for (const f of fields) {
        if (f.readonly || f.type === 'readonly' || f.type === 'owner') continue;
        if (f.type === 'password' && !data[f.name]) continue;
        if (f.name in data) body[f.name] = data[f.name];
      }
      if (editing.mode === 'create') await api(`/r/${res.key}`, { method: 'POST', body });
      else await api(`/r/${res.key}/${editing.row.id}`, { method: 'PUT', body });
      saved();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="overlay" onMouseDown={e => e.target === e.currentTarget && close()}>
      <div className="modal">
        <div className="modal-head"><h2>{title}</h2><button className="btn small" onClick={close}>✕</button></div>
        <div className="modal-body">
          <div className="form-grid">
            {fields.map(f => (
              <div key={f.name} className={`field ${isWide(f) ? 'wide' : ''}`}>
                <label>{t(f.label)}{f.required && !readOnly ? ' *' : ''}</label>
                {(f.type === 'ref' || f.type === 'owner') && (f.readonly || readOnly)
                  ? <input className="input" disabled value={data[`${f.name}__label`] ?? data[f.name] ?? '—'} />
                  : <FieldInput field={f} value={data[f.name]} readOnly={readOnly} onChange={v => setData(d => ({ ...d, [f.name]: v }))} />}
                {f.help && <div className="help">{t(f.help)}</div>}
              </div>
            ))}
          </div>
          {error && <p className="error">{error}</p>}
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={close}>{readOnly ? t('Cerrar') : t('Cancelar')}</button>
          {!readOnly && <button className="btn primary" disabled={busy} onClick={save}>{busy ? t('Guardando…') : t('Guardar')}</button>}
        </div>
      </div>
    </div>
  );
}

/** Traducciones de un idioma (clave → texto), para la app o el panel */
function TranslationsModal({ row, kind, close, notify }) {
  const [rowsT, setRowsT] = useState(null), [busy, setBusy] = useState(false);
  useEffect(() => {
    api(`/languages/${row.id}/json?kind=${kind}`).then(d => setRowsT(Object.entries(d.json).map(([k, v]) => ({ k, v })))).catch(e => notify(e.message, true));
  }, [row.id, kind]); // eslint-disable-line
  const save = async () => {
    setBusy(true);
    try {
      const json = Object.fromEntries(rowsT.filter(r => r.k.trim()).map(r => [r.k.trim(), r.v]));
      await api(`/languages/${row.id}/json?kind=${kind}`, { method: 'PUT', body: { json } });
      notify(t('Traducciones guardadas')); close();
    } catch (e) { notify(e.message, true); } finally { setBusy(false); }
  };
  return (
    <div className="overlay" onMouseDown={e => e.target === e.currentTarget && close()}>
      <div className="modal">
        <div className="modal-head"><h2>{t('Traducciones')} · {row.name} · {kind === 'app' ? t('App') : t('Panel')}</h2><button className="btn small" onClick={close}>✕</button></div>
        <div className="modal-body">
          <p className="muted" style={{ marginTop: 0 }}>{t('Clave: el texto original en español. Valor: cómo se muestra en este idioma.')}</p>
          {!rowsT ? <p className="muted">{t('Cargando…')}</p> : (
            <div style={{ maxHeight: 420, overflowY: 'auto' }}>
              {rowsT.map((r, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                  <input className="input" value={r.k} placeholder={t('Texto original')} onChange={e => setRowsT(x => x.map((y, j) => j === i ? { ...y, k: e.target.value } : y))} />
                  <input className="input" value={r.v} placeholder={t('Traducción')} onChange={e => setRowsT(x => x.map((y, j) => j === i ? { ...y, v: e.target.value } : y))} />
                  <button className="btn small danger" onClick={() => setRowsT(x => x.filter((_, j) => j !== i))}>✕</button>
                </div>
              ))}
              <button className="btn small" onClick={() => setRowsT(x => [...x, { k: '', v: '' }])}>＋ {t('Añadir texto')}</button>
            </div>
          )}
        </div>
        <div className="modal-foot"><button className="btn" onClick={close}>{t('Cancelar')}</button><button className="btn primary" disabled={busy || !rowsT} onClick={save}>{t('Guardar')}</button></div>
      </div>
    </div>
  );
}

/** Conversación de un ticket de soporte */
function TicketModal({ row, close, notify, canReply }) {
  const [data, setData] = useState(null), [text, setText] = useState(''), [busy, setBusy] = useState(false);
  const load = () => api(`/tickets/${row.id}/messages`).then(setData).catch(e => notify(e.message, true));
  useEffect(() => { load(); }, [row.id]); // eslint-disable-line
  const send = async (closeTicket) => {
    if (!text.trim()) return;
    setBusy(true);
    try { await api(`/tickets/${row.id}/messages`, { method: 'POST', body: { message: text, close: closeTicket } }); setText(''); load(); notify(t('Respuesta enviada')); }
    catch (e) { notify(e.message, true); } finally { setBusy(false); }
  };
  return (
    <div className="overlay" onMouseDown={e => e.target === e.currentTarget && close()}>
      <div className="modal">
        <div className="modal-head"><h2>{t('Ticket')} {row.number} · {row.subject}</h2><button className="btn small" onClick={close}>✕</button></div>
        <div className="modal-body">
          {data && <p className="muted" style={{ marginTop: 0 }}>{data.owner?.name} · {data.ticket.owner_type === 'driver' ? t('Conductor') : t('Cliente')}</p>}
          <div className="chat">
            {data?.messages.map(m => (
              <div key={m.id} className={`msg ${m.sender_type === 'admin' ? 'admin' : ''}`}>
                <div style={{ fontSize: 11, fontWeight: 800 }} className="muted">{m.sender_type === 'admin' ? (m.admin_name || t('Soporte')) : data.owner?.name} · {dateTime(m.created_at)}</div>
                {m.message}
              </div>
            ))}
          </div>
          {canReply && <textarea className="input" rows={3} style={{ marginTop: 12 }} placeholder={t('Escribe una respuesta…')} value={text} onChange={e => setText(e.target.value)} />}
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={close}>{t('Cerrar')}</button>
          {canReply && <><button className="btn" disabled={busy} onClick={() => send(true)}>{t('Responder y cerrar')}</button>
          <button className="btn primary" disabled={busy} onClick={() => send(false)}>{t('Responder')}</button></>}
        </div>
      </div>
    </div>
  );
}

/** Ajuste manual del saldo de un monedero */
function WalletModal({ row, currency, close, done, notify }) {
  const [type, setType] = useState('credit'), [amount, setAmount] = useState(''), [description, setDescription] = useState(''), [settles, setSettles] = useState(false);
  const isDriver = row.owner_type === 'driver';
  const save = async () => {
    try {
      await api(`/wallets/${row.id}/adjust`, { method: 'POST', body: { type, amount: Number(amount), description, settlesDebt: settles } });
      notify(t('Saldo actualizado')); done();
    } catch (e) { notify(e.message, true); }
  };
  return (
    <div className="overlay" onMouseDown={e => e.target === e.currentTarget && close()}>
      <div className="modal" style={{ maxWidth: 480 }}>
        <div className="modal-head"><h2>{t('Ajustar saldo')} · {row.owner_id__label}</h2><button className="btn small" onClick={close}>✕</button></div>
        <div className="modal-body">
          <p style={{ marginTop: 0 }}>{t('Saldo actual')}: <b>{money(row.balance, currency?.symbol)}</b></p>
          <div className="form-grid">
            <div className="field"><label>{t('Tipo')}</label>
              <select className="select" value={type} onChange={e => setType(e.target.value)}>
                <option value="credit">{t('Abono (sumar)')}</option><option value="debit">{t('Cargo (restar)')}</option>
              </select></div>
            <div className="field"><label>{t('Importe')}</label><input className="input" type="number" step="0.01" min="0" value={amount} onChange={e => setAmount(e.target.value)} /></div>
            <div className="field wide"><label>{t('Motivo')}</label><input className="input" value={description} onChange={e => setDescription(e.target.value)} placeholder={t('p. ej. Pago en punto de cobro')} /></div>
            {isDriver && type === 'credit' && <div className="field wide"><label className="switch"><input type="checkbox" checked={settles} onChange={e => setSettles(e.target.checked)} /> {t('Salda deuda de viajes en efectivo')}</label></div>}
          </div>
        </div>
        <div className="modal-foot"><button className="btn" onClick={close}>{t('Cancelar')}</button><button className="btn primary" onClick={save}>{t('Aplicar')}</button></div>
      </div>
    </div>
  );
}
