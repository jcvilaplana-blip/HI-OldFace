/**
 * SocialChannelPage — canal de un usuario (/social/canal/:key, key = userId o @usuario).
 *   · Portada, foto, nombre (insignia de verificado), @usuario, descripción, Seguir y campana (o Editar canal si es el mío).
 *   · Seguidores · Vídeos · Visualizaciones (las grabaciones de directos también cuentan).
 *   · Pestañas: Vídeos (filtros Todos / Públicos / De pago y Más recientes / Más vistos) · Publicaciones · En vivo · Información.
 * Solo se ve lo que el servidor deja ver (públicos y, si soy su contacto, lo de "Solo mis contactos").
 */
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { useBackClose } from '../utils/backHandler';
import * as api from '../utils/social';
import { listDirectos, listRecordings } from '../utils/directos';
import { RecordingFeed } from '../components/LiveRecordings';
import { PaySheet } from '../components/LivePay';
import {
  useSocialTheme, useToast, Toast, Icon, ChannelAvatar, Verified, BottomBar, PostCard, PostMenu, MediaViewer, ReelsViewer, CommentsSheet,
  ComposerSheet, VideoTile, PostDetail, Sheet, Confirm, PrimaryBtn, postTitle, shareText, chip, SHARE_BASE, RED,
} from '../components/SocialUI.jsx';
import { tr, LOCALE } from '../i18n';

export default function SocialChannelPage() {
  const S = useSocialTheme();
  const navigate = useNavigate();
  const { key } = useParams();
  const { user } = useAuthStore();
  const [toastText, toast] = useToast();

  const [ch, setCh] = useState(null);
  const [missing, setMissing] = useState(false);
  const [tab, setTab] = useState('videos');           // videos | posts | live | info
  const [filter, setFilter] = useState('all');        // all | public | paid
  const [sort, setSort] = useState('recent');         // recent | popular
  const [posts, setPosts] = useState(null);           // todas las publicaciones que puedo ver
  const [authors, setAuthors] = useState({});
  const [recs, setRecs] = useState([]);
  const [lives, setLives] = useState([]);

  const [menuOpen, setMenuOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [composer, setComposer] = useState(false);
  const [savedOpen, setSavedOpen] = useState(false);
  const [listOf, setListOf] = useState(null);         // 'followers' | 'following'
  const [postMenu, setPostMenu] = useState(null);
  const [commentsFor, setCommentsFor] = useState(null);
  const [media, setMedia] = useState(null);
  const [reels, setReels] = useState(null);
  const [recFeed, setRecFeed] = useState(null);
  const [detail, setDetail] = useState(null);
  const [paying, setPaying] = useState(null);

  const loadChannel = useCallback(async () => {
    try {
      const c = key === user?.id ? await api.getMe() : await api.getChannel(key);
      setCh(c); setMissing(false);
      return c;
    } catch { setMissing(true); return null; }
  }, [key, user?.id]);

  const loadContent = useCallback(async (c) => {
    if (!c || c.blockedByMe) { setPosts([]); setRecs([]); setLives([]); return; }
    const all = [];
    let auth = {};
    for (let page = 0; page != null && page < 10;) {
      const d = await api.channelPosts(c.userId, { page }).catch(() => ({ posts: [], authors: {}, next: null }));
      all.push(...d.posts); auth = { ...auth, ...d.authors }; page = d.next;
    }
    setPosts(all); setAuthors(auth);
    listRecordings(c.userId).then(d => setRecs(d.recordings || [])).catch(() => setRecs([]));
    listDirectos().then(l => setLives(l.filter(d => d.creatorId === c.userId && d.status !== 'ended'))).catch(() => setLives([]));
  }, []);

  useEffect(() => {
    setCh(null); setPosts(null);
    loadChannel().then(loadContent);
  }, [loadChannel, loadContent]);

  const isMe = !!ch?.isMe;
  const back = () => (window.history.length > 1 ? navigate(-1) : navigate('/social'));
  const openChannel = (uid) => uid && uid !== ch?.userId && navigate(`/social/canal/${encodeURIComponent(uid)}`);

  // ── Seguir y campana ──
  const [busy, setBusy] = useState(false);
  const follow = async (bell) => {
    if (busy) return;
    setBusy(true);
    try {
      if (ch.followed && bell === undefined) { const r = await api.unfollow(ch.userId); setCh(c => ({ ...c, followed: false, bell: false, followers: r.followers })); }
      else { const r = await api.follow(ch.userId, bell); setCh(c => ({ ...c, followed: true, bell: r.bell, followers: r.followers }));
             if (bell !== undefined) toast(r.bell ? tr('Te avisaremos de lo que publique y de sus directos') : tr('Avisos desactivados')); }
    } catch (e) { toast(e.message); }
    finally { setBusy(false); }
  };

  // ── Vídeos: publicaciones de vídeo + grabaciones de directos ──
  const videos = useMemo(() => {
    const vp = (posts || []).filter(p => p.media?.[0]?.type === 'video').map(p => ({
      kind: 'post', id: p.id, at: p.createdAt, views: p.views || 0, public: p.visibility === 'public', paid: false, post: p }));
    const vr = recs.map(r => ({ kind: 'rec', id: r.id, at: r.createdAt, views: r.views || 0, public: r.visibility === 'public', paid: r.price > 0, rec: r }));
    return [...vp, ...vr]
      .filter(v => (filter === 'public' ? v.public : filter === 'paid' ? v.paid : true))
      .sort((a, b) => (sort === 'popular' ? b.views - a.views : b.at - a.at));
  }, [posts, recs, filter, sort]);
  const openVideo = (v) => {
    if (v.kind === 'rec') { const list = videos.filter(x => x.kind === 'rec').map(x => x.rec); setRecFeed({ list, index: list.indexOf(v.rec) }); return; }
    const list = videos.filter(x => x.kind === 'post').map(x => x.post);
    setReels({ posts: list, index: list.indexOf(v.post) });
  };

  const replacePost = (p) => setPosts(l => (l || []).map(x => (x.id === p.id ? { ...x, ...p } : x)));
  const cardProps = {
    S, toast, onOpenChannel: openChannel, onChanged: replacePost, onMenu: setPostMenu, onOpenComments: setCommentsFor,
    onOpenMedia: (post, index) => setMedia({ post, index }),
    onOpenVideo: (post) => { const list = (posts || []).filter(x => x.media?.[0]?.type === 'video'); setReels({ posts: list, index: list.indexOf(post) }); },
  };

  if (missing) {
    return (
      <div style={{ minHeight: '100vh', background: S.bg, color: S.text, paddingTop: 'var(--sat, 0px)' }}>
        <button onClick={back} aria-label={tr('Atrás')} style={{ margin: 12, background: 'none', border: 'none', color: S.text, cursor: 'pointer' }}><Icon name="back" size={26} /></button>
        <p style={{ textAlign: 'center', marginTop: 80, color: S.sub }}>{tr('Este canal no existe o no está disponible')}</p>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: S.bg, color: S.text, paddingBottom: 'calc(84px + env(safe-area-inset-bottom, 0px))' }}>
      {/* Portada */}
      <div style={{ position: 'relative', height: 'calc(170px + var(--sat, 0px))', background: ch?.cover ? `url("${ch.cover}") center/cover` : `linear-gradient(135deg, ${RED}, #7C3AED)` }}>
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(rgba(0,0,0,0.35), transparent 45%)' }} />
        <button onClick={back} aria-label={tr('Atrás')} style={coverBtn({ left: 12 })}><Icon name="back" size={22} color="#fff" /></button>
        <button onClick={() => setMenuOpen(true)} aria-label={tr('Opciones')} style={coverBtn({ right: 12 })}><Icon name="dots" size={22} color="#fff" stroke={3} /></button>
      </div>

      {/* Datos del canal */}
      <div style={{ position: 'relative', zIndex: 1, background: S.surface, padding: '0 16px 14px', borderBottom: `1px solid ${S.border}` }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, marginTop: -46 }}>
          <ChannelAvatar author={ch ? { ...ch, avatar: ch.avatar || (isMe ? user?.avatar : null) } : null} size={104} ring ringBg={S.surface} />
          <div style={{ flex: 1 }} />
          {ch && isMe && (
            <button onClick={() => setEditOpen(true)} style={{ ...chip(S, false), padding: '9px 16px', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <Icon name="edit" size={16} />{tr('Editar canal')}
            </button>
          )}
          {ch && !isMe && !ch.blockedByMe && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
              <button onClick={() => follow()} disabled={busy} style={{ border: ch.followed ? `1px solid ${S.border}` : 'none', background: ch.followed ? S.chip : S.red,
                       color: ch.followed ? S.text : '#fff', borderRadius: 999, padding: '10px 22px', fontWeight: 800, fontSize: 14.5, cursor: 'pointer',
                       boxShadow: ch.followed ? 'none' : '0 6px 18px rgba(240,23,75,0.4)' }}>{ch.followed ? tr('Siguiendo') : tr('Seguir')}</button>
              <button onClick={() => follow(!ch.bell)} disabled={busy} aria-label={tr('Avisos de este canal')}
                      style={{ width: 42, height: 42, borderRadius: '50%', border: `1.5px solid ${ch.bell ? S.red : S.border}`, background: ch.bell ? S.redSoft : 'transparent',
                               color: ch.bell ? S.red : S.text, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="bell" size={19} fill={ch.bell ? S.red : 'none'} />
              </button>
            </div>
          )}
        </div>
        {ch && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
              <h1 style={{ margin: 0, fontSize: 24, fontWeight: 900, letterSpacing: -0.4 }}>{ch.name}</h1>
              {ch.verified && <Verified size={20} />}
            </div>
            <p style={{ margin: '2px 0 0', color: S.sub, fontSize: 14 }}>@{ch.handle}</p>
            {ch.bio && <p style={{ margin: '8px 0 0', fontSize: 14, lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>{ch.bio}</p>}
            <div style={{ display: 'flex', marginTop: 14 }}>
              <Stat S={S} n={ch.followers} text={tr('Seguidores')} onClick={() => setListOf('followers')} />
              <Stat S={S} n={ch.videos} text={tr('Vídeos')} border />
              <Stat S={S} n={ch.views} text={tr('Visualizaciones')} border />
            </div>
          </>
        )}
      </div>

      {ch?.blockedByMe && (
        <div style={{ padding: 30, textAlign: 'center' }}>
          <p style={{ color: S.sub, marginBottom: 14 }}>{tr('Has bloqueado este canal. No veis vuestras publicaciones ni directos.')}</p>
          <button onClick={async () => { try { await api.unblock(ch.userId); const c = await loadChannel(); loadContent(c); toast(tr('Desbloqueado')); } catch (e) { toast(e.message); } }}
                  style={{ ...chip(S, true), padding: '10px 22px' }}>{tr('Desbloquear')}</button>
        </div>
      )}

      {ch && !ch.blockedByMe && (
        <>
          {/* Pestañas */}
          <div style={{ padding: '12px 14px 4px' }}>
            <div style={{ display: 'flex', background: S.isDark ? S.chip : S.redSoft, borderRadius: 999, padding: 4 }}>
              {[['videos', tr('Vídeos')], ['posts', tr('Publicaciones')], ['live', tr('En vivo')], ['info', tr('Información')]].map(([id, text]) => (
                <button key={id} onClick={() => setTab(id)} style={{ flex: 1, border: 'none', cursor: 'pointer', borderRadius: 999, padding: '9px 4px', fontSize: 13.5, fontWeight: 800,
                         background: tab === id ? S.red : 'transparent', color: tab === id ? '#fff' : S.text, boxShadow: tab === id ? '0 4px 14px rgba(240,23,75,0.4)' : 'none' }}>{text}</button>
              ))}
            </div>
          </div>

          {tab === 'videos' && (
            <>
              <div style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '10px 14px', scrollbarWidth: 'none' }}>
                <button onClick={() => setFilter('all')} style={chip(S, filter === 'all')}>▶ {tr('Todos')}</button>
                <button onClick={() => setFilter('public')} style={chip(S, filter === 'public')}>🌐 {tr('Públicos')}</button>
                <button onClick={() => setFilter('paid')} style={chip(S, filter === 'paid')}>🔒 {tr('De pago')}</button>
                <button onClick={() => setSort(s => (s === 'recent' ? 'popular' : 'recent'))} style={{ ...chip(S, false), display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Icon name="sort" size={15} />{sort === 'recent' ? tr('Más recientes') : tr('Más vistos')}
                </button>
              </div>
              {posts === null && <p style={{ textAlign: 'center', color: S.muted }}>{tr('Cargando…')}</p>}
              {posts !== null && !videos.length && <p style={{ textAlign: 'center', color: S.muted, padding: 24 }}>{isMe ? tr('Publica tu primer vídeo con el botón Publicar') : tr('Este canal todavía no tiene vídeos')}</p>}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '14px 10px', padding: '4px 14px 10px' }}>
                {videos.map(v => (v.kind === 'post'
                  ? <VideoTile key={v.id} S={S} thumb={v.post.media[0].thumb} duration={v.post.media[0].duration} title={postTitle(v.post) || tr('Vídeo')}
                               meta={`${tr('{n} vistas', { n: api.compact(v.views) })} · ${api.ago(v.at)}`} onClick={() => openVideo(v)} />
                  : <VideoTile key={v.id} S={S} thumb={v.rec.poster} duration={v.rec.duration} title={v.rec.title} locked={v.rec.locked}
                               badgeText={v.paid ? `🔒 ${String(v.rec.price).replace('.', ',')} €` : tr('Directo')}
                               meta={`${tr('{n} vistas', { n: api.compact(v.views) })} · ${api.ago(v.at)}`} onClick={() => openVideo(v)} />))}
              </div>
            </>
          )}

          {tab === 'posts' && (
            <div style={{ marginTop: 8 }}>
              {posts?.map(p => <PostCard key={p.id} post={p} author={authors[p.userId] || ch} {...cardProps} />)}
              {posts?.length === 0 && <p style={{ textAlign: 'center', color: S.muted, padding: 24 }}>{isMe ? tr('Todavía no has publicado nada') : tr('Este canal todavía no ha publicado nada')}</p>}
            </div>
          )}

          {tab === 'live' && (
            <div style={{ padding: '8px 14px' }}>
              {!lives.length && <p style={{ textAlign: 'center', color: S.muted, padding: 20 }}>{tr('Ahora no está en directo ni tiene directos programados')}</p>}
              {lives.map(d => (
                <button key={d.id} onClick={() => (d.status === 'live' ? (d.locked ? setPaying(d) : navigate(`/directo/${d.id}/live`)) : null)}
                        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: 12, marginBottom: 10, borderRadius: 16, border: `1px solid ${S.border}`,
                                 background: S.card, color: S.text, cursor: d.status === 'live' ? 'pointer' : 'default', textAlign: 'left' }}>
                  <span style={{ background: d.status === 'live' ? RED : S.chip, color: d.status === 'live' ? '#fff' : S.sub, fontWeight: 800, fontSize: 11, padding: '4px 8px', borderRadius: 6 }}>
                    {d.status === 'live' ? tr('EN VIVO') : tr('Programado')}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontWeight: 800 }}>{d.title}</span>
                    <span style={{ fontSize: 12.5, color: S.sub }}>{d.status === 'live' ? tr('Toca para verlo') : d.scheduledAt ? new Date(d.scheduledAt).toLocaleString(LOCALE, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : tr('Sin programar')}
                      {d.price > 0 ? ` · ${String(d.price).replace('.', ',')} €` : ''}</span>
                  </span>
                </button>
              ))}
              {isMe && <div style={{ textAlign: 'center', paddingTop: 6 }}><button onClick={() => navigate('/directo')} style={{ ...chip(S, true), padding: '10px 20px' }}>🔴 {tr('Ir a Directo')}</button></div>}
            </div>
          )}

          {tab === 'info' && (
            <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              {ch.bio ? <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{ch.bio}</p>
                : <p style={{ margin: 0, color: S.muted }}>{isMe ? tr('Añade una descripción en Editar canal') : tr('Sin descripción')}</p>}
              <InfoRow S={S} icon="user" text={`@${ch.handle}`} />
              <InfoRow S={S} icon="users" text={tr('{a} seguidores · {b} siguiendo', { a: api.compact(ch.followers), b: api.compact(ch.following) })} onClick={() => setListOf('followers')} />
              <InfoRow S={S} icon="image" text={tr('{n} publicaciones', { n: ch.posts })} />
              <InfoRow S={S} icon="live" text={tr('En OldFace desde {d}', { d: new Date(ch.createdAt).toLocaleDateString(LOCALE, { month: 'long', year: 'numeric' }) })} />
              {ch.isContact && <InfoRow S={S} icon="check" text={tr('Está en tus contactos')} />}
            </div>
          )}
        </>
      )}

      <BottomBar S={S} active={isMe ? 'channel' : null} onExplore={() => navigate('/social?view=explore')} onPublish={() => setComposer(true)}
        onMessages={() => navigate('/')} onChannel={() => (isMe ? window.scrollTo({ top: 0, behavior: 'smooth' }) : navigate(`/social/canal/${encodeURIComponent(user?.id)}`))} />

      {menuOpen && ch && <ChannelMenu S={S} ch={ch} toast={toast} onClose={() => setMenuOpen(false)} onEdit={() => setEditOpen(true)} onSaved={() => setSavedOpen(true)}
        onBlocked={async () => { const c = await loadChannel(); loadContent(c); }} />}
      {editOpen && ch && <EditChannelSheet S={S} ch={ch} user={user} toast={toast} onClose={() => setEditOpen(false)} onSaved={(c) => setCh(x => ({ ...x, ...c }))} />}
      {composer && <ComposerSheet S={S} toast={toast} onClose={() => setComposer(false)}
        onPosted={(post, a) => { if (isMe) { setPosts(l => [post, ...(l || [])]); setAuthors(x => ({ ...x, ...a })); } }} />}
      {savedOpen && <SavedSheet S={S} toast={toast} onClose={() => setSavedOpen(false)} onOpenPost={(post, a) => { setSavedOpen(false); setDetail({ post, authors: a }); }} />}
      {listOf && ch && <FollowListSheet S={S} ch={ch} initial={listOf} onClose={() => setListOf(null)} onOpenChannel={(uid) => { setListOf(null); openChannel(uid); }} />}
      {postMenu && <PostMenu S={S} post={postMenu} author={authors[postMenu.userId] || ch} toast={toast} onClose={() => setPostMenu(null)}
        onChanged={replacePost} onDeleted={(id) => setPosts(l => l.filter(x => x.id !== id))} onOpenChannel={openChannel}
        onBlocked={async () => { const c = await loadChannel(); loadContent(c); }} />}
      {commentsFor && <CommentsSheet S={S} post={commentsFor} toast={toast} onClose={() => setCommentsFor(null)} onOpenChannel={openChannel}
        onCount={(n) => replacePost({ id: commentsFor.id, comments: n })} />}
      {media && <MediaViewer post={media.post} start={media.index} onClose={() => setMedia(null)} />}
      {reels && <ReelsViewer posts={reels.posts} authors={{ ...authors, [ch.userId]: authors[ch.userId] || ch }} startIndex={Math.max(0, reels.index)} toast={toast}
        onClose={() => setReels(null)} onOpenChannel={(uid) => { setReels(null); openChannel(uid); }} onOpenComments={setCommentsFor} onChanged={replacePost} />}
      {recFeed && <RecordingFeed recordings={recFeed.list} startIndex={Math.max(0, recFeed.index)} onClose={() => setRecFeed(null)}
        onOpenChannel={() => setRecFeed(null)} onChanged={(r) => setRecs(l => l.map(x => (x.id === r.id ? r : x)))} />}
      {detail && <PostDetail S={S} detail={detail} onClose={() => setDetail(null)} cardProps={{ ...cardProps, onChanged: () => {} }} />}
      {paying && <PaySheet kind="directo" id={paying.id} price={paying.price} title={paying.title} ownerName={paying.creatorName}
        onClose={() => setPaying(null)} onUnlocked={() => { const d = paying; setPaying(null); navigate(`/directo/${d.id}/live`); }} />}
      <Toast text={toastText} />
    </div>
  );
}

const coverBtn = (pos) => ({ position: 'absolute', top: 'calc(var(--sat, 0px) + 12px)', ...pos, width: 40, height: 40, borderRadius: '50%', border: 'none',
                             background: 'rgba(0,0,0,0.35)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' });

function Stat({ S, n, text, border, onClick }) {
  return (
    <button onClick={onClick} style={{ flex: 1, background: 'none', border: 'none', borderLeft: border ? `1px solid ${S.border}` : 'none', color: S.text,
             cursor: onClick ? 'pointer' : 'default', padding: '2px 0' }}>
      <span style={{ display: 'block', fontSize: 20, fontWeight: 900 }}>{api.compact(n)}</span>
      <span style={{ fontSize: 12.5, color: S.sub }}>{text}</span>
    </button>
  );
}

function InfoRow({ S, icon, text, onClick }) {
  return (
    <button onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'none', border: 'none', color: S.text, padding: 0, cursor: onClick ? 'pointer' : 'default', fontSize: 14.5, textAlign: 'left' }}>
      <span style={{ color: S.red, display: 'flex' }}><Icon name={icon} size={19} /></span>{text}
    </button>
  );
}

/** ⋮ del canal: mío → editar, guardados, compartir; de otro → compartir, denunciar, bloquear */
function ChannelMenu({ S, ch, toast, onClose, onEdit, onSaved, onBlocked }) {
  const [step, setStep] = useState('menu');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const share = async () => { const r = await shareText(`${ch.name} (@${ch.handle}) en OldFace\n${SHARE_BASE}/canal/${ch.handle}`); if (r === 'copied') toast(tr('Enlace copiado')); onClose(); };
  const row = (icon, text, onClick, danger) => (
    <button key={text} onClick={onClick} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px', background: 'none', border: 'none',
             borderBottom: `1px solid ${S.border}`, color: danger ? S.red : S.text, fontSize: 15, fontWeight: 600, cursor: 'pointer', textAlign: 'left' }}>
      <Icon name={icon} size={20} />{text}
    </button>
  );
  const run = async (fn) => { setBusy(true); try { await fn(); } catch (e) { toast(e.message); } finally { setBusy(false); } };
  const REASONS = [tr('Spam'), tr('Suplanta a otra persona'), tr('Contenido inapropiado'), tr('Otro motivo')];
  return (
    <Sheet S={S} onClose={onClose} title={step === 'report' ? tr('Denunciar canal') : ch.name}>
      {step === 'menu' && ch.isMe && <>
        {row('edit', tr('Editar canal'), () => { onClose(); onEdit(); })}
        {row('bookmark', tr('Mis guardados'), () => { onClose(); onSaved(); })}
        {row('share', tr('Compartir canal'), share)}
      </>}
      {step === 'menu' && !ch.isMe && <>
        {row('share', tr('Compartir canal'), share)}
        {row('flag', tr('Denunciar canal'), () => setStep('report'), true)}
        {ch.blockedByMe
          ? row('block', tr('Desbloquear'), () => run(async () => { await api.unblock(ch.userId); toast(tr('Desbloqueado')); onClose(); onBlocked(); }))
          : row('block', tr('Bloquear a {name}', { name: ch.name }), () => setStep('block'), true)}
      </>}
      {step === 'block' && (
        <Confirm S={S} busy={busy} ok={tr('Bloquear')} onCancel={() => setStep('menu')}
          text={tr('No veréis vuestras publicaciones, canales ni directos públicos, y dejaréis de seguiros. Puedes desbloquear cuando quieras desde su canal.')}
          onOk={() => run(async () => { await api.block(ch.userId); toast(tr('Usuario bloqueado')); onClose(); onBlocked(); })} />
      )}
      {step === 'report' && (
        <div style={{ padding: 16 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
            {REASONS.map(r => <button key={r} onClick={() => setReason(r)} style={chip(S, reason === r)}>{r}</button>)}
          </div>
          <PrimaryBtn S={S} disabled={!reason || busy} onClick={() => run(async () => { await api.report('channel', ch.userId, reason); toast(tr('Gracias. Lo revisaremos.')); onClose(); })}>
            {tr('Enviar denuncia')}
          </PrimaryBtn>
        </div>
      )}
    </Sheet>
  );
}

/** Editar mi canal: foto, portada, nombre, @usuario y descripción */
function EditChannelSheet({ S, ch, user, toast, onClose, onSaved }) {
  const [name, setName] = useState(ch.name);
  const [handle, setHandle] = useState(ch.handle);
  const [bio, setBio] = useState(ch.bio || '');
  const [avatar, setAvatar] = useState(undefined);   // undefined = sin cambios · string = nueva · null = quitar
  const [cover, setCover] = useState(undefined);
  const [busy, setBusy] = useState('');
  const avatarInput = useRef(null), coverInput = useRef(null);
  const upload = async (file, set) => {
    if (!file) return;
    setBusy(tr('Subiendo…'));
    try { set(await api.uploadMedia(file)); } catch (e) { toast(e.message); } finally { setBusy(''); }
  };
  const save = async () => {
    setBusy(tr('Guardando…'));
    try {
      const fields = {};
      if (name.trim() !== ch.name) fields.name = name.trim();
      if (handle.trim().replace(/^@/, '').toLowerCase() !== ch.handle) fields.handle = handle.trim();
      if (bio.trim() !== (ch.bio || '')) fields.bio = bio.trim();
      if (avatar !== undefined) fields.avatar = avatar;
      if (cover !== undefined) fields.cover = cover;
      if (Object.keys(fields).length) onSaved(await api.saveMe(fields));
      toast(tr('Guardado'));
      onClose();
    } catch (e) { toast(e.message); setBusy(''); }
  };
  const shownAvatar = avatar === undefined ? ch.avatar : avatar;
  const shownCover = cover === undefined ? ch.cover : cover;
  const field = { width: '100%', boxSizing: 'border-box', padding: '12px 14px', borderRadius: 12, border: `1px solid ${S.border}`, background: S.chip, color: S.text, fontSize: 15, outline: 'none', fontFamily: 'inherit' };
  return (
    <Sheet S={S} onClose={() => !busy && onClose()} title={tr('Editar canal')} full
      footer={<div style={{ padding: 12, borderTop: `1px solid ${S.border}` }}><PrimaryBtn S={S} disabled={!!busy || !name.trim()} onClick={save}>{busy || tr('Guardar')}</PrimaryBtn></div>}>
      <div onClick={() => coverInput.current?.click()} style={{ height: 120, margin: 16, borderRadius: 16, cursor: 'pointer', position: 'relative', overflow: 'hidden',
           background: shownCover ? `url("${shownCover}") center/cover` : `linear-gradient(135deg, ${RED}, #7C3AED)` }}>
        <span style={{ position: 'absolute', right: 10, bottom: 10, background: 'rgba(0,0,0,0.55)', color: '#fff', borderRadius: 999, padding: '6px 12px', fontSize: 12.5, fontWeight: 700, display: 'flex', gap: 6, alignItems: 'center' }}>
          <Icon name="camera" size={15} color="#fff" />{tr('Cambiar portada')}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '0 16px 12px' }}>
        <ChannelAvatar author={{ name, avatar: shownAvatar }} size={80} onClick={() => avatarInput.current?.click()} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
          <button onClick={() => avatarInput.current?.click()} style={chip(S, true)}>{tr('Cambiar foto del canal')}</button>
          {user?.avatar && <button onClick={() => setAvatar(user.avatar)} style={chip(S, false)}>{tr('Usar mi foto de perfil')}</button>}
          {shownAvatar && <button onClick={() => setAvatar(null)} style={{ background: 'none', border: 'none', color: S.muted, fontSize: 12.5, cursor: 'pointer', padding: 0 }}>{tr('Quitar foto')}</button>}
        </div>
      </div>
      <p style={{ margin: '0 16px 12px', fontSize: 12.5, color: S.sub, lineHeight: 1.45 }}>{tr('La foto y la portada del canal las puede ver cualquier usuario de OldFace. Tu foto de perfil del chat sigue con su privacidad.')}</p>
      <input ref={avatarInput} type="file" accept="image/*" hidden onChange={e => { upload(e.target.files?.[0], setAvatar); e.target.value = ''; }} />
      <input ref={coverInput} type="file" accept="image/*" hidden onChange={e => { upload(e.target.files?.[0], setCover); e.target.value = ''; }} />
      <div style={{ padding: '0 16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label style={{ fontSize: 12, fontWeight: 800, color: S.sub }}>{tr('NOMBRE')}<input value={name} onChange={e => setName(e.target.value)} maxLength={60} style={{ ...field, marginTop: 6 }} /></label>
        <label style={{ fontSize: 12, fontWeight: 800, color: S.sub }}>{tr('NOMBRE DE USUARIO')}
          <input value={handle} onChange={e => setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9._@]/g, ''))} maxLength={25} style={{ ...field, marginTop: 6 }} />
        </label>
        <label style={{ fontSize: 12, fontWeight: 800, color: S.sub }}>{tr('DESCRIPCIÓN')}
          <textarea value={bio} onChange={e => setBio(e.target.value)} maxLength={300} rows={3} style={{ ...field, marginTop: 6, resize: 'none' }}
                    placeholder={tr('Ej.: Música · Fitness · Buena vibra')} />
        </label>
      </div>
    </Sheet>
  );
}

/** Mis guardados */
function SavedSheet({ S, toast, onClose, onOpenPost }) {
  const [data, setData] = useState(null);
  useEffect(() => { api.saved().then(setData).catch(e => { toast(e.message); setData({ posts: [], authors: {} }); }); }, [toast]);
  return (
    <Sheet S={S} onClose={onClose} title={tr('Mis guardados')} full>
      {!data && <p style={{ padding: 20, color: S.muted }}>{tr('Cargando…')}</p>}
      {data && !data.posts.length && <p style={{ padding: 30, textAlign: 'center', color: S.muted }}>{tr('Pulsa el marcador de una publicación para guardarla aquí')}</p>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 4, padding: 8 }}>
        {data?.posts.map(p => {
          const m = p.media[0];
          return (
            <button key={p.id} onClick={() => onOpenPost(p, data.authors)} style={{ aspectRatio: '1 / 1', border: 'none', borderRadius: 10, overflow: 'hidden', padding: 0, cursor: 'pointer',
                     background: m ? `#000 url("${m.thumb || m.url}") center/cover` : S.chip, color: S.text, fontSize: 12, textAlign: 'left' }}>
              {!m && <span style={{ display: 'block', padding: 8 }}>{p.text.slice(0, 80)}</span>}
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}

/** Seguidores / Siguiendo */
function FollowListSheet({ S, ch, initial, onClose, onOpenChannel }) {
  const [which, setWhich] = useState(initial);
  const [list, setList] = useState(null);
  useEffect(() => {
    setList(null);
    (which === 'followers' ? api.followers(ch.userId) : api.following(ch.userId)).then(d => setList(d.channels)).catch(() => setList([]));
  }, [which, ch.userId]);
  return (
    <Sheet S={S} onClose={onClose} title={ch.name} full>
      <div style={{ display: 'flex', borderBottom: `1px solid ${S.border}` }}>
        {[['followers', tr('Seguidores')], ['following', tr('Siguiendo')]].map(([id, text]) => (
          <button key={id} onClick={() => setWhich(id)} style={{ flex: 1, background: 'none', border: 'none', padding: 12, cursor: 'pointer', fontWeight: 800, fontSize: 14,
                   color: which === id ? S.red : S.sub, borderBottom: `3px solid ${which === id ? S.red : 'transparent'}` }}>{text}</button>
        ))}
      </div>
      {!list && <p style={{ padding: 20, color: S.muted }}>{tr('Cargando…')}</p>}
      {list?.length === 0 && <p style={{ padding: 30, textAlign: 'center', color: S.muted }}>{tr('Nadie todavía')}</p>}
      {list?.map(c => (
        <button key={c.userId} onClick={() => onOpenChannel(c.userId)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', background: 'none',
                 border: 'none', borderBottom: `1px solid ${S.border}`, color: S.text, cursor: 'pointer', textAlign: 'left' }}>
          <ChannelAvatar author={c} size={44} />
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontWeight: 800 }}>{c.name}{c.verified && <Verified size={15} />}</span>
            <span style={{ fontSize: 12.5, color: S.sub }}>@{c.handle}</span>
          </span>
          {c.followed && <span style={{ fontSize: 12, color: S.red, fontWeight: 800 }}>{tr('Siguiendo')}</span>}
        </button>
      ))}
    </Sheet>
  );
}
