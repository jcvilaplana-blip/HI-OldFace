/**
 * KaraokePage — portada del karaoke (sistema propio, sin servicios externos)
 *   · Cantar:          buscador + catálogo ("Para ti", "Todas") con botón Canta
 *   · Salas:           crear sala + salas en directo (cola de canciones, público, chat)
 *   · Mis grabaciones: escuchar, compartir y borrar lo grabado
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { RTC_HTTP } from '../utils/rtcClient';
import { fmtTime } from '../utils/lrc';

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
const BRAND   = '#000080';
const RED     = '#ef4444';
export const absUrl = (u) => (!u ? null : /^https?:/.test(u) ? u : `${BACKEND}${u}`);

export default function KaraokePage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'cantar';
  const setTab = (t) => setParams({ tab: t }, { replace: true });

  const [songs, setSongs]   = useState(null);
  const [query, setQuery]   = useState('');
  const [rooms, setRooms]   = useState(null);
  const [recs,  setRecs]    = useState(null);
  const [creating, setCreating] = useState(false);
  const [roomTitle, setRoomTitle] = useState('');

  const [genres, setGenres] = useState([]);
  const [genre,  setGenre]  = useState(null);
  useEffect(() => {
    fetch(`${BACKEND}/karaoke/songs`).then(r => r.json()).then(d => setSongs(d.songs || [])).catch(() => setSongs([]));
    fetch(`${BACKEND}/karaoke/genres`).then(r => r.json()).then(d => setGenres(d.genres || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (tab !== 'salas') return;
    const load = () => fetch(`${RTC_HTTP}/karaoke/rooms`).then(r => r.json()).then(d => setRooms(d.rooms || [])).catch(() => setRooms([]));
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [tab]);

  const loadRecs = () => fetch(`${BACKEND}/karaoke/recordings?userId=${encodeURIComponent(user?.id || '')}`)
    .then(r => r.json()).then(d => setRecs(d.recordings || [])).catch(() => setRecs([]));
  useEffect(() => { if (tab === 'grabaciones') loadRecs(); }, [tab]); // eslint-disable-line

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!songs) return [];
    return songs.filter(s => (!q || `${s.title} ${s.artist}`.toLowerCase().includes(q)) && (!genre || s.genre?.id === genre));
  }, [songs, query, genre]);
  // "Para ti": las destacadas por el administrador; si no hay, las más cantadas
  const forYou = useMemo(() => {
    const list = songs || [];
    const feat = list.filter(s => s.featured);
    return (feat.length ? feat : [...list].sort((a, b) => b.recordings - a.recordings)).slice(0, 5);
  }, [songs]);

  const createRoom = () => navigate(`/karaoke/sala/nueva?title=${encodeURIComponent(roomTitle.trim())}`);

  return (
    <div className="bg-gray-50" style={{ display: 'flex', flexDirection: 'column', height: '100dvh' }}>
      {/* Cabecera */}
      <div style={{ background: `linear-gradient(135deg, ${BRAND}, #2d3bb8)`, color: 'white', paddingTop: 'var(--sat)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px 6px' }}>
          <button onClick={() => navigate(-1)} aria-label="Volver" style={{ background: 'none', border: 'none', padding: 4, cursor: 'pointer' }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 19l-7-7 7-7"/></svg>
          </button>
          <span style={{ fontSize: 22 }}>🎤</span>
          <p style={{ margin: 0, fontSize: 19, fontWeight: 900, letterSpacing: 0.3 }}>Karaoke</p>
        </div>
        {tab === 'cantar' && (
          <div style={{ padding: '4px 14px 10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'white', borderRadius: 22, padding: '9px 14px' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.5"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Busca una canción o artista"
                style={{ flex: 1, border: 'none', outline: 'none', fontSize: 14, color: '#1e293b', background: 'transparent' }} />
              {query && <button onClick={() => setQuery('')} style={{ border: 'none', background: 'none', color: '#94a3b8', fontSize: 16 }}>✕</button>}
            </div>
          </div>
        )}
        <div style={{ display: 'flex' }}>
          {[['cantar', 'Cantar'], ['salas', 'Salas'], ['grabaciones', 'Mis grabaciones']].map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)} style={{
              flex: 1, background: 'none', border: 'none', color: 'white', padding: '10px 0 11px', cursor: 'pointer',
              fontSize: 14, fontWeight: tab === id ? 900 : 600, opacity: tab === id ? 1 : 0.7,
              borderBottom: `3px solid ${tab === id ? 'white' : 'transparent'}`,
            }}>{label}</button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 'calc(var(--sab) + 24px)' }}>
        {/* ── CANTAR ── */}
        {tab === 'cantar' && (
          <>
            {!query && (
              <button onClick={() => setTab('salas')} style={{
                display: 'flex', alignItems: 'center', gap: 14, width: 'calc(100% - 28px)', margin: '14px 14px 4px',
                padding: '16px', border: 'none', borderRadius: 18, cursor: 'pointer', textAlign: 'left', color: 'white',
                background: `linear-gradient(120deg, ${BRAND}, #4f46e5 60%, ${RED})`, boxShadow: '0 6px 18px rgba(0,0,128,0.25)',
              }}>
                <span style={{ fontSize: 34 }}>🎙️</span>
                <span style={{ flex: 1 }}>
                  <span style={{ display: 'block', fontSize: 16, fontWeight: 900 }}>Canta en directo</span>
                  <span style={{ display: 'block', fontSize: 12, opacity: 0.85 }}>Crea una sala o únete a una y canta por turnos con tus amigos</span>
                </span>
                <span style={{ fontSize: 20 }}>›</span>
              </button>
            )}

            {genres.length > 0 && (
              <div className="scroll-hide" style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '12px 14px 0' }}>
                {[{ id: null, name: 'Todas', icon: '' }, ...genres].map(g => (
                  <button key={g.id || 'all'} onClick={() => setGenre(g.id)} style={{
                    flexShrink: 0, padding: '7px 14px', borderRadius: 20, fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
                    border: `1px solid ${genre === g.id ? BRAND : 'rgba(148,163,184,0.35)'}`,
                    background: genre === g.id ? BRAND : 'white', color: genre === g.id ? 'white' : '#475569',
                  }}>{g.icon ? `${g.icon} ` : ''}{g.name}</button>
                ))}
              </div>
            )}
            {songs === null && <Spinner />}
            {songs?.length === 0 && (
              <Empty icon="🎵" title="El catálogo está vacío" text="El administrador puede subir canciones (pista instrumental + letra LRC) desde el panel /admin → Karaoke." />
            )}

            {!query && !genre && forYou.length > 0 && (forYou.some(s => s.featured) || songs.length > 4) && (
              <>
                <SectionTitle>Para ti</SectionTitle>
                {forYou.map(s => <SongRow key={s.id} song={s} onSing={() => navigate(`/karaoke/cantar/${s.id}`)} />)}
              </>
            )}
            {songs?.length > 0 && (
              <>
                <SectionTitle>{query || genre ? `Resultados (${filtered.length})` : 'Todas las canciones'}</SectionTitle>
                {filtered.map(s => <SongRow key={s.id} song={s} onSing={() => navigate(`/karaoke/cantar/${s.id}`)} />)}
                {query && filtered.length === 0 && <Empty icon="🔍" title="Sin resultados" text={`No hay canciones que coincidan con "${query}"`} />}
              </>
            )}
          </>
        )}

        {/* ── SALAS ── */}
        {tab === 'salas' && (
          <>
            <div className="bg-white" style={{ margin: 14, borderRadius: 18, padding: 14, boxShadow: '0 1px 6px rgba(0,0,0,0.06)' }}>
              {!creating ? (
                <button onClick={() => setCreating(true)} style={{
                  width: '100%', padding: 15, border: 'none', borderRadius: 14, cursor: 'pointer', color: 'white',
                  background: `linear-gradient(135deg, ${RED}, #ec4899)`, fontSize: 16, fontWeight: 900,
                }}>＋ Crear sala de karaoke</button>
              ) : (
                <div style={{ display: 'flex', gap: 8 }}>
                  <input autoFocus value={roomTitle} onChange={e => setRoomTitle(e.target.value)} maxLength={60}
                    placeholder={`Karaoke de ${user?.name || 'OldFace'}`}
                    onKeyDown={e => e.key === 'Enter' && createRoom()}
                    style={{ flex: 1, minWidth: 0, padding: '12px 14px', borderRadius: 12, border: '1.5px solid #e2e8f0', fontSize: 14, outline: 'none' }} />
                  <button onClick={createRoom} style={{ background: RED, color: 'white', border: 'none', borderRadius: 12, padding: '0 16px', fontWeight: 900 }}>Crear</button>
                </div>
              )}
            </div>

            {rooms === null && <Spinner />}
            {rooms?.length === 0 && <Empty icon="🎤" title="No hay salas abiertas" text="¡Crea la primera y anima a tus amigos a cantar!" />}
            {rooms?.length > 0 && (
              <>
                <div className="scroll-hide" style={{ display: 'flex', gap: 14, overflowX: 'auto', padding: '2px 14px 12px' }}>
                  {rooms.map(r => (
                    <button key={r.roomId} onClick={() => navigate(`/karaoke/sala/${r.roomId}`)} style={{ background: 'none', border: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, cursor: 'pointer', flexShrink: 0 }}>
                      <span style={{ position: 'relative', width: 62, height: 62, borderRadius: '50%', border: `3px solid ${RED}`, padding: 2 }}>
                        <span style={{ display: 'flex', width: '100%', height: '100%', borderRadius: '50%', background: BRAND, color: 'white', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 22 }}>
                          {(r.current?.singer || r.hostName || '?')[0]?.toUpperCase()}
                        </span>
                        <span style={{ position: 'absolute', bottom: -6, left: '50%', transform: 'translateX(-50%)', background: RED, color: 'white', fontSize: 8, fontWeight: 900, padding: '2px 5px', borderRadius: 6, whiteSpace: 'nowrap' }}>EN VIVO</span>
                      </span>
                      <span className="text-gray-600" style={{ fontSize: 11, fontWeight: 700, maxWidth: 70, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 4 }}>{r.hostName}</span>
                    </button>
                  ))}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, padding: '0 14px' }}>
                  {rooms.map(r => <RoomCard key={r.roomId} room={r} onOpen={() => navigate(`/karaoke/sala/${r.roomId}`)} />)}
                </div>
              </>
            )}
          </>
        )}

        {/* ── MIS GRABACIONES ── */}
        {tab === 'grabaciones' && (
          <>
            {recs === null && <Spinner />}
            {recs?.length === 0 && <Empty icon="🎧" title="Aún no tienes grabaciones" text="Elige una canción en Cantar, pulsa Canta y al terminar guarda tu grabación." />}
            {recs?.map(r => <RecordingRow key={r.id} rec={r} userId={user?.id} onDeleted={loadRecs} />)}
          </>
        )}
      </div>
    </div>
  );
}

// ── Componentes ───────────────────────────────────────────────────────────────
export function SongCover({ song, size = 58 }) {
  return song.coverUrl
    ? <img src={absUrl(song.coverUrl)} alt="" style={{ width: size, height: size, borderRadius: 12, objectFit: 'cover', flexShrink: 0 }} />
    : <div style={{ width: size, height: size, borderRadius: 12, flexShrink: 0, background: `linear-gradient(135deg, ${BRAND}, #4f46e5)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.42 }}>🎵</div>;
}

export function SongRow({ song, onSing, cta = 'Canta' }) {
  return (
    <div className="bg-white" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderBottom: '1px solid rgba(148,163,184,0.15)' }}>
      <SongCover song={song} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <p className="text-gray-800" style={{ margin: 0, fontSize: 15, fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{song.title}</p>
        <p className="text-gray-500" style={{ margin: '1px 0 0', fontSize: 12 }}>{song.artist || 'Artista desconocido'}{song.duration ? ` · ${fmtTime(song.duration)}` : ''}</p>
        <p className="text-gray-400" style={{ margin: '2px 0 0', fontSize: 11 }}>🎙 {song.recordings || 0} grabaci{song.recordings === 1 ? 'ón' : 'ones'}</p>
      </div>
      <button onClick={onSing} style={{ background: '#e0e7ff', color: BRAND, border: 'none', borderRadius: 18, padding: '8px 16px', fontWeight: 900, fontSize: 13, cursor: 'pointer', flexShrink: 0 }}>{cta}</button>
    </div>
  );
}

function RoomCard({ room, onOpen }) {
  return (
    <button onClick={onOpen} style={{
      position: 'relative', aspectRatio: '1 / 1.1', border: 'none', borderRadius: 16, overflow: 'hidden', cursor: 'pointer',
      background: `linear-gradient(160deg, ${BRAND}, #4f46e5 55%, #ec4899)`, color: 'white', textAlign: 'left', padding: 12,
      display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
    }}>
      <span style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
        <span style={{ background: RED, fontSize: 9, fontWeight: 900, padding: '3px 6px', borderRadius: 6 }}>● EN VIVO</span>
        <span style={{ background: 'rgba(0,0,0,0.3)', fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 10 }}>👂 {room.listeners}</span>
      </span>
      <span style={{ fontSize: 40, textAlign: 'center' }}>🎤</span>
      <span>
        <span style={{ display: 'block', fontSize: 14, fontWeight: 900, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{room.title}</span>
        <span style={{ display: 'block', fontSize: 11, opacity: 0.85, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>
          {room.current ? `🎵 ${room.current.singer}: ${room.current.title}` : `${room.queue} en cola · ${room.hostName}`}
        </span>
      </span>
    </button>
  );
}

function RecordingRow({ rec, userId, onDeleted }) {
  const share = async () => {
    const text = `🎤 Escucha cómo canto "${rec.songTitle}" en OldFace`;
    const url = absUrl(rec.audioUrl);
    try {
      const { Capacitor } = await import('@capacitor/core');
      if (Capacitor.isNativePlatform()) {
        const { Share } = await import('@capacitor/share');
        await Share.share({ title: rec.songTitle, text, url, dialogTitle: 'Compartir grabación' });
        return;
      }
    } catch { /* web */ }
    try { if (navigator.share) await navigator.share({ title: rec.songTitle, text, url }); else await navigator.clipboard.writeText(`${text}\n${url}`); } catch {}
  };
  const remove = async () => {
    if (!window.confirm?.('¿Borrar esta grabación?')) return;
    await fetch(`${BACKEND}/karaoke/recordings/${rec.id}?userId=${encodeURIComponent(userId)}`, { method: 'DELETE' }).catch(() => {});
    onDeleted();
  };
  return (
    <div className="bg-white" style={{ margin: '10px 14px', borderRadius: 16, padding: 12, boxShadow: '0 1px 6px rgba(0,0,0,0.05)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <SongCover song={{ coverUrl: rec.coverUrl }} size={48} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p className="text-gray-800" style={{ margin: 0, fontWeight: 800, fontSize: 14 }}>{rec.songTitle}</p>
          <p className="text-gray-500" style={{ margin: 0, fontSize: 12 }}>{new Date(rec.createdAt).toLocaleDateString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}{rec.duration ? ` · ${fmtTime(rec.duration)}` : ''}</p>
        </div>
        <button onClick={share} aria-label="Compartir" style={{ background: '#e0e7ff', border: 'none', borderRadius: '50%', width: 36, height: 36, cursor: 'pointer' }}>↗</button>
        <button onClick={remove} aria-label="Borrar" style={{ background: '#fee2e2', border: 'none', borderRadius: '50%', width: 36, height: 36, cursor: 'pointer' }}>🗑</button>
      </div>
      <audio controls preload="none" src={absUrl(rec.audioUrl)} style={{ width: '100%', marginTop: 10, height: 36 }} />
    </div>
  );
}

function SectionTitle({ children }) {
  return <p className="text-gray-800" style={{ margin: '18px 14px 8px', fontSize: 17, fontWeight: 900 }}>{children}</p>;
}

function Empty({ icon, title, text }) {
  return (
    <div style={{ textAlign: 'center', padding: '40px 28px' }}>
      <div style={{ fontSize: 44, marginBottom: 8 }}>{icon}</div>
      <p className="text-gray-700" style={{ margin: '0 0 6px', fontWeight: 800, fontSize: 15 }}>{title}</p>
      <p className="text-gray-500" style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>{text}</p>
    </div>
  );
}

function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
      <div style={{ width: 30, height: 30, border: '3px solid #e2e8f0', borderTopColor: BRAND, borderRadius: '50%', animation: 'kSpin 0.8s linear infinite' }} />
      <style>{'@keyframes kSpin { to { transform: rotate(360deg) } }'}</style>
    </div>
  );
}
