/**
 * App — estructura del panel: menú lateral por grupos, barra superior y rutas con hash
 *   #/dashboard · #/r/<sección>?filtros · #/settings/<clave> · #/live
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, session, setOnExpired } from './api';
import { t, setDictionary } from './i18n';
import ResourcePage from './ResourcePage.jsx';
import { Login, Dashboard, SettingsPage, LivePage, SETTINGS } from './Pages.jsx';

const LANG_KEY = 'oldface-taxi-admin-lang';
const readLang = () => { try { return localStorage.getItem(LANG_KEY) || ''; } catch { return ''; } };

function parseHash() {
  const h = window.location.hash.replace(/^#\/?/, '') || 'dashboard';
  const [path, query = ''] = h.split('?');
  return { parts: path.split('/'), params: Object.fromEntries(new URLSearchParams(query)) };
}

export default function App() {
  const [admin, setAdmin] = useState(() => session.get()?.admin || null);
  const [meta, setMeta] = useState(null);
  const [route, setRoute] = useState(parseHash);
  const [toast, setToast] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [lang, setLang] = useState(readLang);

  const notify = useCallback((msg, err = false) => {
    setToast({ msg, err });
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => setToast(null), 3500);
  }, []);
  const go = useCallback((path) => { window.location.hash = `#/${path}`; setMenuOpen(false); }, []);

  useEffect(() => { setOnExpired(() => { setAdmin(null); setMeta(null); }); }, []);
  useEffect(() => {
    const on = () => setRoute(parseHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  // Metadatos (secciones visibles, moneda, color, idioma) y perfil actualizado
  useEffect(() => {
    if (!admin) return;
    api(`/meta${lang ? `?lang=${encodeURIComponent(lang)}` : ''}`).then(m => {
      setDictionary(m.language?.texts);
      setMeta(m);
    }).catch(e => notify(e.message, true));
    api('/me').then(d => d.admin && setAdmin(d.admin)).catch(() => {});
  }, [admin?.id, lang]); // eslint-disable-line

  useEffect(() => {
    const c = meta?.app?.adminPrimaryColor;
    if (c && c.toLowerCase() !== '#000080') document.documentElement.style.setProperty('--primary', c);
    document.title = `${meta?.app?.appName || 'OldFace Taxi'} · ${t('Panel')}`;
  }, [meta]);

  const can = (perm) => !!admin?.is_system || (admin?.permissions || []).includes(perm);

  const groups = useMemo(() => {
    const g = {};
    for (const r of meta?.resources || []) if (!r.hidden) (g[r.group] ||= []).push(r);
    return g;
  }, [meta]);

  if (!admin) return <Login onLogin={(d) => setAdmin(d.admin)} />;
  if (!meta) return <div className="login"><div className="card">{t('Cargando…')}</div></div>;

  const [section, sub] = route.parts;
  const res = section === 'r' ? meta.resources.find(r => r.key === sub) : null;
  const title = section === 'r' ? (res ? t(res.label) : t('Sección no encontrada'))
    : section === 'settings' ? t(SETTINGS[sub]?.title || 'Ajustes')
    : section === 'live' ? t('Mapa en vivo') : t('Dashboard');

  let page;
  if (section === 'r') page = res ? <ResourcePage key={`${res.key}?${JSON.stringify(route.params)}`} res={res} currency={meta.currency} initialFilters={route.params} notify={notify} go={go} />
                                  : <p className="muted">{t('No tienes acceso a esta sección')}</p>;
  else if (section === 'settings') page = can('system_configuration.view') ? <SettingsPage skey={sub} canEdit={can('system_configuration.edit')} notify={notify} />
                                                                            : <p className="muted">{t('No tienes acceso a esta sección')}</p>;
  else if (section === 'live') page = <LivePage notify={notify} />;
  else page = <Dashboard notify={notify} go={go} />;

  const current = window.location.hash.replace(/\?.*/, '') || '#/dashboard';
  const navItem = (path, icon, label) => (
    <button key={path} className={`nav-item ${current === `#/${path}` ? 'active' : ''}`} onClick={() => go(path)}>
      <span>{icon}</span> {t(label)}
    </button>
  );

  const logout = () => { session.clear(); setAdmin(null); setMeta(null); };
  const changeLang = (code) => { try { localStorage.setItem(LANG_KEY, code); } catch { /* sin almacenamiento */ } setLang(code); };

  return (
    <div className="layout">
      <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
        <div className="brand"><span className="brand-logo">🚕</span> {meta.app?.appName || 'OldFace Taxi'}</div>
        {navItem('dashboard', '📈', 'Dashboard')}
        {navItem('live', '📍', 'Mapa en vivo')}
        {Object.entries(groups).map(([g, items]) => (
          <div key={g}>
            <div className="nav-group">{t(g)}</div>
            {items.map(r => navItem(`r/${r.key}`, r.icon, r.label))}
          </div>
        ))}
        {can('system_configuration.view') && <>
          <div className="nav-group">{t('Ajustes')}</div>
          {Object.entries(SETTINGS).map(([k, s]) => navItem(`settings/${k}`, s.icon, s.title))}
        </>}
      </aside>
      <div className="main" onClick={() => menuOpen && setMenuOpen(false)}>
        <header className="topbar">
          <button className="btn small menu-btn" onClick={(e) => { e.stopPropagation(); setMenuOpen(o => !o); }}>☰</button>
          <h1>{title}</h1>
          {meta.languages?.length > 1 && (
            <select className="select" style={{ width: 'auto' }} value={meta.language?.code || ''} onChange={e => changeLang(e.target.value)} title={t('Idioma del panel')}>
              {meta.languages.map(l => <option key={l.code} value={l.code}>{l.name}</option>)}
            </select>
          )}
          <span className="muted" title={admin.email}>{admin.name} · {admin.role}</span>
          <button className="btn small" onClick={logout}>{t('Salir')}</button>
        </header>
        <main className="content">{page}</main>
      </div>
      {toast && <div className={`toast ${toast.err ? 'err' : ''}`}>{toast.msg}</div>}
    </div>
  );
}
