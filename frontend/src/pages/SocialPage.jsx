/**
 * SocialPage — la red social de OldFace (/social).
 *   · Arriba: logo, buscador, avisos y mi canal. Pestañas Para ti · Reels · Siguiendo · Directos.
 *   · Historias: los estados de siempre (con su privacidad), en fila.
 *   · Para ti / Siguiendo: muro de publicaciones. Reels: vídeos verticales a pantalla completa.
 *   · Directos: en vivo ahora y grabaciones (los que puedo ver; se emiten desde la pantalla Directo).
 *   · Explorar (barra de abajo): categorías, en vivo, grabaciones, vídeos y fotos, cada uno con Público / Privado.
 * Público = cualquier usuario de OldFace · Privado = de mis contactos. Todo lo filtra el servidor.
 * /social?post=ID abre una publicación (enlaces compartidos y avisos).
 */
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { useThemeStore, DARK, LIGHT } from '../store/themeStore';
import { useBackClose } from '../utils/backHandler';
import { onRtc } from '../utils/rtcClient';
import * as api from '../utils/social';
import { listDirectos, listRecordings } from '../utils/directos';
import StatusList from '../components/StatusList.jsx';
import { RecordingFeed } from '../components/LiveRecordings';
import { PaySheet } from '../components/LivePay';
import {
  useSocialTheme, useToast, Toast, Icon, ChannelAvatar, Verified, Segmented, BottomBar, PostCard, PostMenu, MediaViewer,
  ReelsViewer, CommentsSheet, ComposerSheet, NotificationsSheet, VideoTile, PhotoTile, PostDetail, postTitle, chip, RED,
} from '../components/SocialUI.jsx';
import { tr } from '../i18n';

const EMPTY = { posts: [], authors: {}, next: 0, loading: false, loaded: false };
const SCOPES = [{ id: 'public', label: tr('Público') }, { id: 'contacts', label: tr('Privado') }];

export default function SocialPage() {
  const S = useSocialTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuthStore();
  const { isDark } = useThemeStore();
  const T = isDark ? DARK : LIGHT;
  const [toastText, toast] = useToast();

  const [view, setView] = useState(new URLSearchParams(location.search).get('view') === 'explore' ? 'explore' : 'home');
  const [tab, setTab] = useState('foryou');            // foryou | following | directos
  const [me, setMe] = useState(null);
  const [lists, setLists] = useState({ foryou: EMPTY, following: EMPTY });

  // Hojas y visores
  const [composer, setComposer] = useState(false);
  const [commentsFor, setCommentsFor] = useState(null);
  const [menuFor, setMenuFor] = useState(null);
  const [media, setMedia] = useState(null);             // { post, index }
  const [reels, setReels] = useState(null);             // { posts, authors, index }
  const [notesOpen, setNotesOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [detail, setDetail] = useState(null);           // { post, authors }

  useBackClose(view === 'explore', () => setView('home'));

  const openChannel = useCallback((uid) => uid && navigate(`/social/canal/${encodeURIComponent(uid)}`), [navigate]);
  const openLive = useCallback((id) => id && navigate(`/directo/${encodeURIComponent(id)}/live`), [navigate]);

  // Mi canal (se crea la primera vez) y avisos sin leer
  const loadMe = useCallback(() => api.getMe().then(setMe).catch(e => toast(e.message)), [toast]);
  useEffect(() => { loadMe(); }, [loadMe]);
  useEffect(() => onRtc('social:notification', (d) => setMe(m => (m ? { ...m, unread: d?.unread ?? (m.unread || 0) + 1 } : m))), []);

  // Enlace a una publicación
  const openPost = useCallback(async (id) => {
    try { const d = await api.getPost(id); setDetail(d); } catch (e) { toast(e.message); }
  }, [toast]);
  useEffect(() => {
    const id = new URLSearchParams(location.search).get('post');
    if (id) openPost(id);
  }, [location.search, openPost]);

  // ── Muro ──
  const listsRef = useRef(lists);
  listsRef.current = lists;
  const load = useCallback(async (which, reset = false) => {
    const page = reset ? 0 : listsRef.current[which].next ?? 0;
    setLists(l => ({ ...l, [which]: { ...l[which], loading: true } }));
    try {
      const d = await api.feed(which, page);
      setLists(l => {
        const prev = reset ? EMPTY : l[which];
        const seen = new Set(prev.posts.map(p => p.id));
        return { ...l, [which]: { posts: [...prev.posts, ...d.posts.filter(p => !seen.has(p.id))], authors: { ...prev.authors, ...d.authors },
                                  next: d.next, loading: false, loaded: true } };
      });
    } catch (e) {
      toast(e.message);
      setLists(l => ({ ...l, [which]: { ...l[which], loading: false, loaded: true } }));
    }
  }, [toast]);
  useEffect(() => { if ((tab === 'foryou' || tab === 'following') && !lists[tab].loaded) load(tab, true); }, [tab]); // eslint-disable-line

  const replacePost = useCallback((p) => setLists(l => Object.fromEntries(Object.entries(l).map(([k, v]) =>
    [k, { ...v, posts: v.posts.map(x => (x.id === p.id ? { ...x, ...p } : x)) }]))), []);
  const removePost = useCallback((id) => setLists(l => Object.fromEntries(Object.entries(l).map(([k, v]) =>
    [k, { ...v, posts: v.posts.filter(x => x.id !== id) }]))), []);
  const removeAuthor = useCallback((uid) => setLists(l => Object.fromEntries(Object.entries(l).map(([k, v]) =>
    [k, { ...v, posts: v.posts.filter(x => x.userId !== uid) }]))), []);

  const openReels = async () => {
    try {
      const d = await api.feed('reels');
      setReels({ posts: d.posts, authors: d.authors, index: 0 });
    } catch (e) { toast(e.message); }
  };
  const openVideo = (p, list, authors) => {
    const vids = list.filter(x => x.media?.[0]?.type === 'video');
    setReels({ posts: vids, authors, index: Math.max(0, vids.findIndex(x => x.id === p.id)) });
  };

  const current = lists[tab] || EMPTY;
  const cardProps = (authors, list) => ({
    S, toast, onOpenChannel: openChannel, onChanged: replacePost, onMenu: setMenuFor, onOpenComments: setCommentsFor,
    onOpenMedia: (post, index) => setMedia({ post, index }), onOpenVideo: (post) => openVideo(post, list, authors),
  });
  const authorsAll = useMemo(() => ({ ...lists.foryou.authors, ...lists.following.authors, ...(detail?.authors || {}), ...(reels?.authors || {}) }),
    [lists, detail, reels]);

  // Cargar más al llegar al final
  const sentinel = useRef(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || view !== 'home' || tab === 'directos') return undefined;
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && current.next != null && !current.loading && current.loaded) load(tab);
    }, { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [view, tab, current.next, current.loading, current.loaded, load]);

  return (
    <div style={{ minHeight: '100vh', background: S.bg, color: S.text, paddingBottom: 'calc(80px + env(safe-area-inset-bottom, 0px))', '--social-bg': S.bg }}>
      {/* Cabecera */}
      <div style={{ position: 'sticky', top: 0, zIndex: 50, background: S.surface, paddingTop: 'var(--sat, 0px)', borderBottom: `1px solid ${S.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px 6px' }}>
          <button onClick={() => navigate('/')} aria-label={tr('Volver a OldFace')} style={{ width: 46, height: 46, borderRadius: '50%', border: 'none', padding: 0, cursor: 'pointer',
                   background: '#fff', boxShadow: '0 2px 10px rgba(0,0,0,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <img src="/logo-oldface.png" alt="OldFace" style={{ width: 34, height: 34, objectFit: 'contain' }} />
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 22, fontWeight: 900, letterSpacing: -0.4, lineHeight: 1.1 }}>OldFace</p>
            <p style={{ margin: 0, fontSize: 12.5, color: S.sub }}>{tr('Tu red social y directos')}</p>
          </div>
          <RoundIcon S={S} label={tr('Buscar')} onClick={() => setSearchOpen(true)}><Icon name="search" size={21} /></RoundIcon>
          <RoundIcon S={S} label={tr('Avisos')} onClick={() => { setNotesOpen(true); setMe(m => (m ? { ...m, unread: 0 } : m)); }}>
            <Icon name="bell" size={21} />
            {me?.unread > 0 && <span style={{ position: 'absolute', top: 6, right: 7, minWidth: 9, height: 9, borderRadius: 9, background: RED, border: `2px solid ${S.surface}` }} />}
          </RoundIcon>
          <button onClick={() => openChannel(user?.id)} aria-label={tr('Mi canal')} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
            <ChannelAvatar author={me ? { ...me, avatar: me.avatar || user?.avatar || null } : { name: user?.name }} size={38} ring ringBg={S.surface} />
            <span style={{ fontSize: 10.5, color: S.sub, fontWeight: 700 }}>{tr('Tú')}</span>
          </button>
        </div>
        <div style={{ display: 'flex', padding: '0 4px' }}>
          {[['foryou', 'home', tr('Para ti')], ['reels', 'reels', tr('Reels')], ['following', 'users', tr('Siguiendo')], ['directos', 'live', tr('Directos')]].map(([id, icon, text]) => {
            const on = view === 'home' && tab === id;
            return (
              <button key={id} onClick={() => { setView('home'); if (id === 'reels') openReels(); else setTab(id); }}
                      style={{ flex: 1, background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                               padding: '10px 2px 11px', color: on ? S.red : S.text, fontWeight: on ? 800 : 600, fontSize: 14, position: 'relative' }}>
                <Icon name={icon} size={19} fill={on && id === 'foryou' ? S.red : 'none'} />{text}
                {on && <span style={{ position: 'absolute', bottom: 0, left: '12%', right: '12%', height: 3, borderRadius: 3, background: S.red }} />}
              </button>
            );
          })}
        </div>
      </div>

      {view === 'home' && tab !== 'directos' && (
        <>
          <div style={{ background: S.surface, borderBottom: `1px solid ${S.border}`, padding: '10px 0 8px' }}>
            <StatusList row user={user} T={T} isDark={isDark} accent={RED} />
          </div>
          {current.posts.map(p => (
            <PostCard key={p.id} post={p} author={current.authors[p.userId]} {...cardProps(current.authors, current.posts)} />
          ))}
          {current.loaded && !current.posts.length && (
            <Empty S={S} icon={tab === 'following' ? 'users' : 'image'}
              title={tab === 'following' ? tr('Todavía no sigues a nadie') : tr('Aún no hay publicaciones')}
              text={tab === 'following' ? tr('Busca canales en Explorar y pulsa Seguir para ver aquí lo que publican.') : tr('Sé el primero: pulsa Publicar y comparte una foto o un vídeo.')}
              action={tab === 'following' ? [tr('Explorar'), () => setView('explore')] : [tr('Publicar'), () => setComposer(true)]} />
          )}
          {current.loading && <p style={{ textAlign: 'center', color: S.muted, padding: 20 }}>{tr('Cargando…')}</p>}
          <div ref={sentinel} style={{ height: 1 }} />
        </>
      )}

      {view === 'home' && tab === 'directos' && <DirectosTab S={S} toast={toast} onOpenChannel={openChannel} onOpenLive={openLive} onGoDirecto={() => navigate('/directo')} />}

      {view === 'explore' && (
        <ExploreView S={S} toast={toast} onOpenChannel={openChannel} onOpenLive={openLive}
          onOpenPost={(post, authors) => setDetail({ post, authors })}
          onOpenVideo={(post, list, authors) => openVideo(post, list, authors)}
          onSeeDirectos={() => { setView('home'); setTab('directos'); }} />
      )}

      <BottomBar S={S} active={view === 'explore' ? 'explore' : null} onExplore={() => setView('explore')} onPublish={() => setComposer(true)}
        onMessages={() => navigate('/')} onChannel={() => openChannel(user?.id)} />

      {composer && <ComposerSheet S={S} toast={toast} onClose={() => setComposer(false)}
        onPosted={(post, authors) => setLists(l => ({ ...l, foryou: { ...l.foryou, posts: [post, ...l.foryou.posts], authors: { ...l.foryou.authors, ...authors } } }))} />}
      {commentsFor && <CommentsSheet S={S} post={commentsFor} toast={toast} onClose={() => setCommentsFor(null)} onOpenChannel={openChannel}
        onCount={(n) => replacePost({ id: commentsFor.id, comments: n })} />}
      {menuFor && <PostMenu S={S} post={menuFor} author={authorsAll[menuFor.userId]} toast={toast} onClose={() => setMenuFor(null)}
        onChanged={(p) => { replacePost(p); if (detail?.post.id === p.id) setDetail(d => ({ ...d, post: { ...d.post, ...p } })); }}
        onDeleted={(id) => { removePost(id); if (detail?.post.id === id) setDetail(null); }}
        onBlocked={(uid) => { removeAuthor(uid); setDetail(null); }} onOpenChannel={openChannel} />}
      {media && <MediaViewer post={media.post} start={media.index} onClose={() => setMedia(null)} />}
      {reels && <ReelsViewer posts={reels.posts} authors={reels.authors} startIndex={reels.index} toast={toast} onClose={() => setReels(null)}
        onOpenChannel={(uid) => { setReels(null); openChannel(uid); }} onOpenComments={setCommentsFor} onChanged={replacePost}
        emptyText={tr('Todavía no hay vídeos. ¡Publica el primero!')} />}
      {notesOpen && <NotificationsSheet S={S} onClose={() => setNotesOpen(false)} onOpenChannel={openChannel} onOpenPost={openPost} onOpenLive={openLive} />}
      {searchOpen && <SearchOverlay S={S} toast={toast} onClose={() => setSearchOpen(false)} onOpenChannel={openChannel}
        onOpenPost={(post, authors) => setDetail({ post, authors })} />}
      {detail && <PostDetail S={S} detail={detail} onClose={() => { setDetail(null); if (location.search.includes('post=')) navigate('/social', { replace: true }); }}
        cardProps={cardProps(detail.authors, [detail.post])} />}
      <Toast text={toastText} />
    </div>
  );
}

function RoundIcon({ S, label, onClick, children }) {
  return (
    <button onClick={onClick} aria-label={label} style={{ position: 'relative', width: 40, height: 40, borderRadius: '50%', border: 'none', cursor: 'pointer', flexShrink: 0,
             background: S.chip, color: S.text, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{children}</button>
  );
}

function Empty({ S, icon, title, text, action }) {
  return (
    <div style={{ textAlign: 'center', padding: '44px 28px', color: S.sub }}>
      <span style={{ display: 'inline-flex', width: 70, height: 70, borderRadius: '50%', background: S.redSoft, color: S.red, alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
        <Icon name={icon} size={32} />
      </span>
      <p style={{ margin: '0 0 6px', fontWeight: 800, fontSize: 17, color: S.text }}>{title}</p>
      <p style={{ margin: '0 0 16px', fontSize: 14, lineHeight: 1.5 }}>{text}</p>
      {action && <button onClick={action[1]} style={{ ...chip(S, true), padding: '10px 22px', fontSize: 14 }}>{action[0]}</button>}
    </div>
  );
}

function SectionHead({ S, icon, title, right, onAll }) {
  return (
    <div style={{ padding: '18px 14px 10px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ color: icon === 'live' ? S.red : S.text, display: 'flex' }}><Icon name={icon} size={22} /></span>
        <p style={{ margin: 0, flex: 1, fontSize: 18, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</p>
        {onAll && <button onClick={onAll} style={{ background: 'none', border: 'none', color: S.red, fontWeight: 800, fontSize: 13.5, cursor: 'pointer', whiteSpace: 'nowrap', padding: 0 }}>{tr('Ver todas')} ›</button>}
      </div>
      {right && <div style={{ marginTop: 10 }}>{right}</div>}
    </div>
  );
}

const Row = ({ children }) => (
  <div style={{ display: 'flex', gap: 10, overflowX: 'auto', padding: '0 14px 4px', scrollbarWidth: 'none' }}>{children}</div>
);

const liveMeta = (d) => d.description || (d.status === 'live' ? tr('En vivo ahora') : tr('Programado'));
const recMeta = (r) => `${tr('{n} vistas', { n: api.compact(r.views || 0) })} · ${api.ago(r.createdAt)}`;
const postMeta = (p) => `${tr('{n} vistas', { n: api.compact(p.views || 0) })} · ${api.ago(p.createdAt)}`;

/** Pestaña Directos: en vivo ahora y grabaciones */
function DirectosTab({ S, toast, onOpenChannel, onOpenLive, onGoDirecto }) {
  const [live, setLive] = useState(null);
  const [recs, setRecs] = useState(null);
  const [scope, setScope] = useState('public');
  const [feed, setFeed] = useState(null);
  const [paying, setPaying] = useState(null);
  const load = useCallback(() => {
    listDirectos().then(l => setLive(l.filter(d => d.status === 'live'))).catch(e => { setLive([]); toast(e.message); });
    listRecordings().then(d => setRecs(d.recordings || [])).catch(() => setRecs([]));
  }, [toast]);
  useEffect(() => { load(); const off = onRtc('live:started', load); return off; }, [load]);
  const shown = (recs || []).filter(r => (scope === 'public' ? r.visibility === 'public' : r.visibility !== 'public'));
  const watch = (d) => (d.locked ? setPaying(d) : onOpenLive(d.id));
  return (
    <>
      <SectionHead S={S} icon="live" title={tr('En vivo ahora')} />
      {live === null && <p style={{ padding: '0 14px', color: S.muted }}>{tr('Cargando…')}</p>}
      {live?.length === 0 && <p style={{ padding: '0 14px', color: S.muted, fontSize: 14 }}>{tr('Ahora mismo no hay nadie en directo')}</p>}
      <Grid>
        {(live || []).map(d => (
          <VideoTile key={d.id} S={S} title={d.title} meta={d.creatorName} badgeText={tr('EN VIVO')} locked={d.locked}
                     avatar={{ name: d.creatorName }} onClick={() => watch(d)} />
        ))}
      </Grid>
      <SectionHead S={S} icon="play" title={tr('Grabaciones de directos')}
        right={<Segmented S={S} small value={scope} options={SCOPES} onChange={setScope} />} />
      <Grid>
        {shown.map((r) => (
          <VideoTile key={r.id} S={S} thumb={r.poster} duration={r.duration} title={r.title} meta={`${r.ownerName} · ${recMeta(r)}`} locked={r.locked}
                     onClick={() => setFeed({ list: shown, index: shown.indexOf(r) })} />
        ))}
      </Grid>
      {recs && !shown.length && <p style={{ padding: '0 14px', color: S.muted, fontSize: 14 }}>{scope === 'public' ? tr('Todavía no hay grabaciones públicas') : tr('Tus contactos no tienen grabaciones')}</p>}
      <div style={{ padding: 20, textAlign: 'center' }}>
        <button onClick={onGoDirecto} style={{ ...chip(S, true), padding: '11px 22px', fontSize: 14 }}>🔴 {tr('Ir a Directo (emitir y mis grabaciones)')}</button>
      </div>
      {feed && <RecordingFeed recordings={feed.list} startIndex={feed.index} onClose={() => setFeed(null)}
        onOpenChannel={(id) => { setFeed(null); onOpenChannel(id); }} onChanged={(r) => setRecs(l => l.map(x => (x.id === r.id ? r : x)))} />}
      {paying && <PaySheet kind="directo" id={paying.id} price={paying.price} title={paying.title} ownerName={paying.creatorName}
        onClose={() => setPaying(null)} onUnlocked={() => { const d = paying; setPaying(null); onOpenLive(d.id); }} />}
    </>
  );
}

const Grid = ({ children }) => (
  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '14px 10px', padding: '0 14px' }}>{children}</div>
);

/** Explorar: categorías, en vivo, grabaciones, vídeos y fotos */
function ExploreView({ S, toast, onOpenChannel, onOpenLive, onOpenPost, onOpenVideo, onSeeDirectos }) {
  const [category, setCategory] = useState('');
  const [live, setLive] = useState([]);
  const [recs, setRecs] = useState([]);
  const [recScope, setRecScope] = useState('public');
  const [vidScope, setVidScope] = useState('public');
  const [photoScope, setPhotoScope] = useState('public');
  const [videos, setVideos] = useState(null);
  const [photos, setPhotos] = useState(null);
  const [feed, setFeed] = useState(null);
  const [all, setAll] = useState(null);         // { type, scope } cuadrícula completa
  useEffect(() => {
    listDirectos().then(l => setLive(l.filter(d => d.status === 'live'))).catch(() => {});
    listRecordings().then(d => setRecs(d.recordings || [])).catch(() => {});
  }, []);
  useEffect(() => { api.explore({ scope: vidScope, category }).then(d => setVideos(d)).catch(e => toast(e.message)); }, [vidScope, category, toast]);
  useEffect(() => { api.explore({ scope: photoScope, category }).then(d => setPhotos(d)).catch(() => {}); }, [photoScope, category]);
  const shownRecs = recs.filter(r => (recScope === 'public' ? r.visibility === 'public' : r.visibility !== 'public'));
  const W = 'min(44vw, 210px)';
  return (
    <div>
      <SectionHead S={S} icon="grid" title={tr('Categorías')} />
      <Row>
        <button onClick={() => setCategory('')} style={chip(S, !category)}>▦ {tr('Todas')}</button>
        {api.CATEGORIES.map(c => <button key={c.id} onClick={() => setCategory(c.id === category ? '' : c.id)} style={chip(S, category === c.id)}>{c.icon} {c.label}</button>)}
      </Row>

      <SectionHead S={S} icon="live" title={tr('En vivo ahora')} onAll={onSeeDirectos} />
      {!live.length && <p style={{ padding: '0 14px', margin: 0, color: S.muted, fontSize: 14 }}>{tr('Ahora mismo no hay nadie en directo')}</p>}
      <Row>
        {live.map(d => (
          <VideoTile key={d.id} S={S} width={W} title={d.title} meta={liveMeta(d)} badgeText={tr('EN VIVO')} locked={d.locked}
                     avatar={{ name: d.creatorName }} onClick={() => (d.locked ? onSeeDirectos() : onOpenLive(d.id))} />
        ))}
      </Row>

      <SectionHead S={S} icon="play" title={tr('Grabaciones de directos')} onAll={onSeeDirectos}
        right={<Segmented S={S} small value={recScope} options={SCOPES} onChange={setRecScope} />} />
      {!shownRecs.length && <p style={{ padding: '0 14px', margin: 0, color: S.muted, fontSize: 14 }}>{tr('Nada por aquí todavía')}</p>}
      <Row>
        {shownRecs.slice(0, 12).map(r => (
          <VideoTile key={r.id} S={S} width={W} thumb={r.poster} duration={r.duration} title={r.title} meta={recMeta(r)} locked={r.locked}
                     onClick={() => setFeed({ list: shownRecs, index: shownRecs.indexOf(r) })} />
        ))}
      </Row>

      <SectionHead S={S} icon="play" title={tr('Vídeos recientes')} onAll={() => setAll({ type: 'video', scope: vidScope })}
        right={<Segmented S={S} small value={vidScope} options={SCOPES} onChange={setVidScope} />} />
      {videos && !videos.videos.length && <p style={{ padding: '0 14px', margin: 0, color: S.muted, fontSize: 14 }}>{tr('Nada por aquí todavía')}</p>}
      <Row>
        {(videos?.videos || []).map(p => (
          <VideoTile key={p.id} S={S} width={W} thumb={p.media[0].thumb} duration={p.media[0].duration} title={postTitle(p) || videos.authors[p.userId]?.name}
                     meta={postMeta(p)} onClick={() => onOpenVideo(p, videos.videos, videos.authors)} />
        ))}
      </Row>

      <SectionHead S={S} icon="image" title={tr('Fotos recientes')} onAll={() => setAll({ type: 'photo', scope: photoScope })}
        right={<Segmented S={S} small value={photoScope} options={SCOPES} onChange={setPhotoScope} />} />
      {photos && !photos.photos.length && <p style={{ padding: '0 14px', margin: 0, color: S.muted, fontSize: 14 }}>{tr('Nada por aquí todavía')}</p>}
      <Row>
        {(photos?.photos || []).map(p => <PhotoTile key={p.id} S={S} post={p} width="min(30vw, 150px)" onClick={() => onOpenPost(p, photos.authors)} />)}
      </Row>
      <div style={{ height: 20 }} />

      {feed && <RecordingFeed recordings={feed.list} startIndex={feed.index} onClose={() => setFeed(null)}
        onOpenChannel={(id) => { setFeed(null); onOpenChannel(id); }} onChanged={(r) => setRecs(l => l.map(x => (x.id === r.id ? r : x)))} />}
      {all && <AllGrid S={S} toast={toast} type={all.type} scope={all.scope} category={category} onClose={() => setAll(null)}
        onOpenPost={onOpenPost} onOpenVideo={onOpenVideo} />}
    </div>
  );
}

/** "Ver todas": cuadrícula completa de vídeos o fotos con más al bajar */
function AllGrid({ S, toast, type, scope, category, onClose, onOpenPost, onOpenVideo }) {
  useBackClose(true, onClose);
  const [data, setData] = useState({ posts: [], authors: {}, next: 0 });
  const [busy, setBusy] = useState(false);
  const more = useCallback(async () => {
    if (busy || data.next == null) return;
    setBusy(true);
    try {
      const d = await api.explore({ scope, category, type, page: data.next });
      setData(x => ({ posts: [...x.posts, ...d.posts], authors: { ...x.authors, ...d.authors }, next: d.next }));
    } catch (e) { toast(e.message); }
    finally { setBusy(false); }
  }, [busy, data.next, scope, category, type, toast]);
  useEffect(() => { more(); }, []); // eslint-disable-line
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 600, background: S.bg, overflowY: 'auto', paddingTop: 'var(--sat, 0px)' }}
         onScroll={(e) => { const el = e.currentTarget; if (el.scrollTop + el.clientHeight > el.scrollHeight - 400) more(); }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', position: 'sticky', top: 0, background: S.bg, zIndex: 2 }}>
        <button onClick={onClose} aria-label={tr('Atrás')} style={{ background: 'none', border: 'none', color: S.text, cursor: 'pointer' }}><Icon name="back" size={26} /></button>
        <p style={{ margin: 0, fontWeight: 800, fontSize: 18 }}>{type === 'video' ? tr('Vídeos recientes') : tr('Fotos recientes')} · {scope === 'public' ? tr('Público') : tr('Privado')}</p>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: type === 'video' ? 'repeat(2, minmax(0,1fr))' : 'repeat(3, minmax(0,1fr))', gap: type === 'video' ? '14px 10px' : 4, padding: '0 14px 30px' }}>
        {data.posts.map(p => (type === 'video'
          ? <VideoTile key={p.id} S={S} thumb={p.media[0].thumb} duration={p.media[0].duration} title={postTitle(p) || data.authors[p.userId]?.name} meta={postMeta(p)}
                       onClick={() => onOpenVideo(p, data.posts, data.authors)} />
          : <PhotoTile key={p.id} S={S} post={p} onClick={() => onOpenPost(p, data.authors)} />))}
      </div>
      {!busy && !data.posts.length && <p style={{ textAlign: 'center', color: S.muted }}>{tr('Nada por aquí todavía')}</p>}
      {busy && <p style={{ textAlign: 'center', color: S.muted }}>{tr('Cargando…')}</p>}
    </div>
  );
}

/** Buscador: canales (nombre o @usuario) y publicaciones */
function SearchOverlay({ S, toast, onClose, onOpenChannel, onOpenPost }) {
  useBackClose(true, onClose);
  const [text, setText] = useState('');
  const [res, setRes] = useState(null);
  useEffect(() => {
    const t = text.trim();
    if (t.length < 2) { setRes(null); return undefined; }
    const id = setTimeout(() => api.search(t).then(setRes).catch(e => toast(e.message)), 300);
    return () => clearTimeout(id);
  }, [text, toast]);
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 650, background: S.bg, overflowY: 'auto', paddingTop: 'var(--sat, 0px)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', position: 'sticky', top: 0, background: S.surface, borderBottom: `1px solid ${S.border}` }}>
        <button onClick={onClose} aria-label={tr('Atrás')} style={{ background: 'none', border: 'none', color: S.text, cursor: 'pointer' }}><Icon name="back" size={26} /></button>
        <input autoFocus value={text} onChange={e => setText(e.target.value)} placeholder={tr('Buscar canales o publicaciones')}
               style={{ flex: 1, minWidth: 0, padding: '11px 16px', borderRadius: 999, border: 'none', background: S.chip, color: S.text, fontSize: 15, outline: 'none' }} />
      </div>
      {!res && <p style={{ padding: 24, textAlign: 'center', color: S.muted }}>{tr('Escribe al menos 2 letras')}</p>}
      {res && !res.channels.length && !res.posts.length && <p style={{ padding: 24, textAlign: 'center', color: S.muted }}>{tr('Sin resultados')}</p>}
      {res?.channels.map(c => (
        <button key={c.userId} onClick={() => { onClose(); onOpenChannel(c.userId); }} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px',
                 background: 'none', border: 'none', borderBottom: `1px solid ${S.border}`, color: S.text, cursor: 'pointer', textAlign: 'left' }}>
          <ChannelAvatar author={c} size={46} />
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontWeight: 800 }}>{c.name}{c.verified && <Verified size={15} />}</span>
            <span style={{ fontSize: 12.5, color: S.sub }}>@{c.handle} · {tr('{n} seguidores', { n: api.compact(c.followers) })}</span>
          </span>
          {c.followed && <span style={{ fontSize: 12, color: S.red, fontWeight: 800 }}>{tr('Siguiendo')}</span>}
        </button>
      ))}
      {res?.posts.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 4, padding: 12 }}>
          {res.posts.map(p => (p.media.length
            ? <PhotoTile key={p.id} S={S} post={p} onClick={() => onOpenPost(p, res.authors)} />
            : <button key={p.id} onClick={() => onOpenPost(p, res.authors)} style={{ aspectRatio: '1 / 1', borderRadius: 12, border: 'none', background: S.card, color: S.text, padding: 8, fontSize: 12, overflow: 'hidden', cursor: 'pointer', textAlign: 'left' }}>{p.text}</button>))}
        </div>
      )}
    </div>
  );
}