/**
 * GroupCallPage — llamada o videollamada de grupo (servidor RTC propio, mediasoup).
 *
 *   /group-call/:groupId   state: { roomId, callType: 'voice'|'video', groupName, isIncoming }
 *
 *  · Cuadrícula con todos los participantes (yo incluido); sin cámara se ve su foto o inicial.
 *  · Controles: micrófono, cámara (también en llamadas de voz), altavoz, añadir participantes, salir.
 *  · Salir NO termina la llamada para los demás: sigue mientras quede alguien en la sala.
 *  · "Participantes": quién está en la llamada, y llamar a miembros del grupo o a otros contactos.
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { useCallStore } from '../store/callStore';
import { useChatStore } from '../store/chatStore';
import { RtcCall } from '../utils/rtcCall';
import { ensureRtcConnected } from '../utils/rtcClient';
import { playRingSound } from '../utils/sounds';
import { fetchGroup, fetchGroupCall, inviteToGroupCall, leaveGroupCall } from '../utils/groupsApi';
import { tr } from '../i18n';
import { useUserAvatar } from '../utils/userAvatar';

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
const RING_MAX_MS = 45_000;   // el tono de "llamando" suena mientras estoy solo, como mucho esto

const fmtDuration = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

export default function GroupCallPage() {
  const { groupId } = useParams();
  const { state } = useLocation();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { setActiveGroupRoom, setCallError, callError } = useCallStore();
  const { chats } = useChatStore();

  const [roomId, setRoomId]       = useState(state?.roomId || null);
  const [callType]                = useState(state?.callType === 'video' ? 'video' : 'voice');
  const [groupName, setGroupName] = useState(state?.groupName || 'Grupo');
  const isIncoming                = state?.isIncoming === true;

  const [status, setStatus]       = useState('connecting');   // connecting | waiting | active | ended | error
  const [peers, setPeers]         = useState([]);             // [{ id, name, stream, videoOff, micOff }]
  const [localStream, setLocalStream] = useState(null);
  const [micOn, setMicOn]         = useState(true);
  const [camOn, setCamOn]         = useState(callType === 'video');
  const [speakerOn, setSpeakerOn] = useState(callType === 'video');
  const [duration, setDuration]   = useState(0);
  const [showPeople, setShowPeople] = useState(false);
  const [group, setGroup]         = useState(null);
  const [invited, setInvited]     = useState({});             // userId → 'sending' | 'sent' | 'error'
  const [everJoined, setEverJoined] = useState(false);        // alguien más llegó a entrar

  const callRef      = useRef(null);
  const leftRef      = useRef(false);
  const timerRef     = useRef(null);
  const keepAliveRef = useRef(null);
  const speakerRef   = useRef(callType === 'video');
  const earTimers    = useRef([]);

  // ── Audio: auricular en voz, altavoz en vídeo (con reintentos: el WebView abre el audio tarde) ──
  const applyAudioRoute = useCallback(() => {
    earTimers.current.forEach(clearTimeout);
    earTimers.current = [0, 400, 1200, 2500, 5000].map(ms => setTimeout(() => {
      if (speakerRef.current) window.OldFaceAudio?.enableSpeaker(); else window.OldFaceAudio?.setEarpiece();
    }, ms));
  }, []);

  const upsertPeer = (id, patch) => setPeers(prev => {
    const old = prev.find(p => p.id === id);
    if (old) return prev.map(p => p.id === id ? { ...p, ...patch } : p);
    return [...prev, { id, name: patch.name || id, stream: null, videoOff: false, micOff: false, ...patch }];
  });

  const onSomeoneJoined = () => {
    setEverJoined(true);
    setStatus(s => (s === 'waiting' || s === 'connecting') ? 'active' : s);
    if (!timerRef.current) timerRef.current = setInterval(() => setDuration(d => d + 1), 1000);
  };

  // ── Entrar en la sala ────────────────────────────────────────────────────
  const join = async () => {
    let room = roomId;
    if (!room) {
      // Abierto sin datos (p. ej. recarga): unirse a la llamada en curso si la hay
      const c = await fetchGroupCall(groupId, user.id).catch(() => null);
      if (!c) { setStatus('ended'); return; }
      room = c.roomId;
      setRoomId(room);
    }
    await ensureRtcConnected(user);
    setActiveGroupRoom(room);
    window.OldFaceAudio?.setCallActive(true);
    applyAudioRoute();
    if (!keepAliveRef.current) {
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator(), gain = ctx.createGain();
        gain.gain.value = 0.001; osc.connect(gain); gain.connect(ctx.destination); osc.start();
        keepAliveRef.current = { ctx, osc };   // evita que Android congele el WebView con la pantalla apagada
      } catch { /* sin AudioContext */ }
    }

    const make = (video) => new RtcCall({
      roomId: room, video,
      onPeerJoined: (id, { name }) => { upsertPeer(id, { name }); onSomeoneJoined(); },
      onPeerStream: (id, stream, { name }) => { upsertPeer(id, { name, stream }); onSomeoneJoined(); },
      onPeerMedia: (id, { kind, paused }) => upsertPeer(id, kind === 'video' ? { videoOff: paused } : { micOff: paused }),
      onPeerLeft: (id) => setPeers(prev => prev.filter(p => p.id !== id)),
    });

    let call = make(callType === 'video');
    callRef.current = call;
    try {
      await call.join();
    } catch (err) {
      // Sin permiso de cámara: entrar solo con voz
      if (callType === 'video' && /Permission|NotAllowed|NotFound|NotReadable/i.test(`${err?.name} ${err?.message}`)) {
        call.leave();
        call = make(false);
        callRef.current = call;
        await call.join();
        setCamOn(false);
        setCallError(tr('No se pudo usar la cámara: entras solo con voz'));
      } else throw err;
    }
    if (leftRef.current) { call.leave(); return; }
    // Llamada en curso: micro (y cámara) siguen funcionando con la app minimizada
    window.OldFaceAudio?.startCallService?.(!!call.producers.video, state?.groupName || 'Grupo');
    setLocalStream(call.localStream);
    setStatus(s => s === 'connecting' ? (call.remoteCount > 0 ? 'active' : 'waiting') : s);
    if (call.remoteCount > 0) onSomeoneJoined();
  };

  // ── Salir de la sala (la llamada sigue para los demás) ────────────────────
  const cleanup = useCallback(() => {
    if (leftRef.current) return;
    leftRef.current = true;
    clearInterval(timerRef.current);
    timerRef.current = null;
    earTimers.current.forEach(clearTimeout);
    try { keepAliveRef.current?.osc?.stop(); keepAliveRef.current?.ctx?.close(); } catch { /* nada */ }
    keepAliveRef.current = null;
    callRef.current?.leave();
    callRef.current = null;
    window.OldFaceAudio?.setSpeaker();
    window.OldFaceAudio?.setCallActive(false);
    setActiveGroupRoom(null);
    if (user?.id) leaveGroupCall(groupId, user.id);
  }, [groupId, user?.id]); // eslint-disable-line

  const start = () => join().catch(err => { console.error('[GroupCall] error:', err?.message); setStatus('error'); });

  useEffect(() => {
    start();
    return () => cleanup();
  }, []); // eslint-disable-line

  // Datos del grupo (miembros para invitar, nombre actualizado)
  useEffect(() => {
    if (!user?.id) return;
    fetchGroup(groupId, user.id).then(g => { setGroup(g); setGroupName(g.name); })
      // Invitado a la llamada sin ser del grupo: ve quién está, pero no puede llamar a más gente
      .catch(() => setGroup({ members: [], memberNames: {}, guest: true }));
  }, [groupId, user?.id]);

  // Tono de "llamando" mientras estoy solo al empezar yo la llamada
  useEffect(() => {
    if (isIncoming || everJoined || status !== 'waiting') return;
    playRingSound();
    const iv = setInterval(playRingSound, 3000);
    const stop = setTimeout(() => clearInterval(iv), RING_MAX_MS);
    return () => { clearInterval(iv); clearTimeout(stop); };
  }, [status, everJoined, isIncoming]);

  // Volver al primer plano: reanudar vídeos y la salida de audio
  useEffect(() => {
    const onVis = async () => {
      if (document.hidden) return;
      applyAudioRoute();
      // Si Android cortó el micro o la cámara al minimizar, abrirlos otra vez (los demás me veían congelado)
      const call = callRef.current;
      if (call) { const s = await call.recoverMedia(); if (s) setLocalStream(s); }
      document.querySelectorAll('video[data-gc]').forEach(v => v.play().catch(() => {}));
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [applyAudioRoute]);

  const exit = () => {
    cleanup();
    if (window.history.length > 1) navigate(-1); else navigate('/', { replace: true });
  };

  const retry = () => {
    callRef.current?.leave();
    callRef.current = null;
    leftRef.current = false;
    setPeers([]);
    setStatus('connecting');
    start();
  };

  // ── Controles ────────────────────────────────────────────────────────────
  const toggleMic = () => {
    const next = !micOn;
    setMicOn(next);
    callRef.current?.setMic(next);
  };

  const toggleCam = async () => {
    const call = callRef.current;
    if (!call) return;
    if (camOn) { setCamOn(false); call.setCamera(false); return; }
    try {
      const s = await call.enableVideo();
      setLocalStream(s);
      setCamOn(true);
      window.OldFaceAudio?.startCallService?.(true, groupName);   // la cámara también sigue al minimizar
    } catch {
      setCallError(tr('No se pudo encender la cámara'));
    }
  };

  const flipCam = async () => {
    try { setLocalStream(await callRef.current?.switchCamera()); } catch { setLocalStream(callRef.current?.localStream); /* sin cámara trasera */ }
  };

  const toggleSpeaker = () => {
    const next = !speakerOn;
    speakerRef.current = next;
    setSpeakerOn(next);
    applyAudioRoute();
  };

  const invite = async (ids) => {
    if (!ids.length) return;
    setInvited(prev => ({ ...prev, ...Object.fromEntries(ids.map(id => [id, 'sending'])) }));
    try {
      await inviteToGroupCall(groupId, user.id, ids);
      setInvited(prev => ({ ...prev, ...Object.fromEntries(ids.map(id => [id, 'sent'])) }));
    } catch (err) {
      setInvited(prev => ({ ...prev, ...Object.fromEntries(ids.map(id => [id, 'error'])) }));
      setCallError(err.message);
    }
  };

  // ── Cuadrícula ───────────────────────────────────────────────────────────
  const tiles = [
    { id: user?.id, name: tr('Tú'), stream: localStream, videoOff: !camOn, micOff: !micOn, local: true },
    ...peers,
  ];
  const n = tiles.length;
  const cols = n <= 2 ? 1 : n <= 6 ? 2 : 3;
  const rows = Math.ceil(n / cols);

  const statusText = status === 'connecting' ? tr('Conectando…')
    : status === 'waiting' ? (isIncoming ? tr('Esperando a los demás…') : tr('Llamando al grupo…'))
    : status === 'active' ? (peers.length === 0 ? tr('Te has quedado solo · {p0}', { p0: fmtDuration(duration) }) : fmtDuration(duration))
    : '';

  if (status === 'ended' || status === 'error') {
    return (
      <div style={{ position: 'fixed', inset: 0, background: '#111827', zIndex: 50, display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24, textAlign: 'center' }}>
        <p style={{ color: status === 'error' ? '#f87171' : 'white', fontWeight: 800, fontSize: 17, margin: 0 }}>
          {status === 'error' ? tr('No se pudo conectar con la llamada') : tr('La llamada del grupo ya ha terminado')}
        </p>
        {status === 'error' && (
          <button onClick={retry}
            style={{ background: '#3D5A80', color: 'white', border: 'none', borderRadius: 18, padding: '12px 28px', fontWeight: 800, fontSize: 15, cursor: 'pointer' }}>{tr('Reintentar')}</button>
        )}
        <button onClick={exit} style={{ color: '#9ca3af', background: 'none', border: 'none', cursor: 'pointer', fontSize: 15, fontWeight: 600 }}>{tr('Volver')}</button>
      </div>
    );
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0b1220', zIndex: 50, display: 'flex', flexDirection: 'column' }}>
      {/* Cabecera */}
      <div style={{ padding: '0 16px 6px', paddingTop: 'calc(var(--sat, 0px) + 10px)', flexShrink: 0,
                    display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, color: 'white', fontWeight: 800, fontSize: 17, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {groupName}
          </p>
          <p style={{ margin: 0, color: 'rgba(255,255,255,0.65)', fontSize: 12, fontWeight: 600 }}>
            {callType === 'video' ? tr('Videollamada de grupo') : tr('Llamada de grupo')}{statusText ? ` · ${statusText}` : ''}
          </p>
        </div>
        <button onClick={() => setShowPeople(true)} aria-label={tr('Participantes')}
          style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,0.14)', border: 'none',
                   borderRadius: 18, padding: '7px 12px', color: 'white', fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>
          <PeopleIcon /> {n}
        </button>
      </div>

      {/* Participantes */}
      <div style={{ flex: 1, minHeight: 0, padding: 6, display: 'grid', gap: 6, overflowY: 'auto',
                    gridTemplateColumns: `repeat(${cols}, 1fr)`,
                    gridAutoRows: rows <= 3 ? `calc((100% - ${(rows - 1) * 6}px) / ${rows})` : '32vh' }}>
        {tiles.map(t => (
          <Tile key={t.id} tile={t} onFlip={t.local && camOn ? flipCam : null} />
        ))}
      </div>

      {/* Controles */}
      <div style={{ flexShrink: 0, padding: '14px 6px', paddingBottom: 'calc(var(--sab, 0px) + 18px)',
                    display: 'flex', justifyContent: 'space-evenly', alignItems: 'flex-start' }}>
        <Ctrl label={micOn ? tr('Silenciar') : tr('Activar mic')} off={!micOn} onPress={toggleMic}>{micOn ? <MicIcon /> : <MicOffIcon />}</Ctrl>
        <Ctrl label={camOn ? tr('Apagar cám.') : tr('Cámara')} off={!camOn} onPress={toggleCam}>{camOn ? <CamIcon /> : <CamOffIcon />}</Ctrl>
        <Ctrl label={speakerOn ? tr('Altavoz') : tr('Auricular')} on={speakerOn} onPress={toggleSpeaker}><SpeakerIcon /></Ctrl>
        {!group?.guest && <Ctrl label={tr('Añadir')} onPress={() => setShowPeople(true)}><AddPersonIcon /></Ctrl>}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, width: 62 }}>
          <button onClick={exit} aria-label={tr('Salir de la llamada')}
            style={{ width: 52, height: 52, borderRadius: '50%', background: '#ef4444', border: 'none', cursor: 'pointer',
                     display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 6px 22px rgba(239,68,68,0.55)' }}>
            <HangIcon />
          </button>
          <span style={{ color: 'rgba(255,255,255,0.75)', fontSize: 11, fontWeight: 700 }}>{tr('Salir')}</span>
        </div>
      </div>

      {showPeople && (
        <PeopleSheet
          me={user} tiles={tiles} group={group} chats={chats} invited={invited}
          onInvite={invite} onClose={() => setShowPeople(false)}
        />
      )}

      {callError && (
        <div style={{ position: 'fixed', bottom: 'calc(var(--sab, 0px) + 120px)', left: '50%', transform: 'translateX(-50%)', zIndex: 400,
                      background: 'rgba(15,15,25,0.92)', color: 'white', padding: '10px 18px', borderRadius: 20, fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' }}>
          {callError}
        </div>
      )}
    </div>
  );
}

// ── Recuadro de un participante ─────────────────────────────────────────────
function Tile({ tile, onFlip }) {
  const ref = useRef(null);
  const me = useAuthStore(s => s.user);
  const peerAvatar = useUserAvatar(tile.local ? null : tile.id);
  const hasVideo = !!tile.stream?.getVideoTracks().length && !tile.videoOff;

  useEffect(() => {
    const el = ref.current;
    if (el && el.srcObject !== tile.stream) {
      el.srcObject = tile.stream || null;
      el.play().catch(() => {});
    }
  }, [tile.stream]);

  const pic = tile.local ? me?.avatar : peerAvatar;
  const initial = ((tile.local ? me?.name : tile.name) || '?')[0].toUpperCase();
  return (
    <div style={{ position: 'relative', borderRadius: 16, overflow: 'hidden', background: '#1f2a44', minHeight: 0 }}>
      {/* También reproduce el audio del participante (el mío va silenciado) */}
      <video ref={ref} data-gc="1" autoPlay playsInline muted={!!tile.local}
        style={{ width: '100%', height: '100%', objectFit: 'cover', visibility: hasVideo ? 'visible' : 'hidden',
                 transform: tile.local ? 'scaleX(-1)' : undefined }} />
      {!hasVideo && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {pic ? (
            <img src={pic} alt="" style={{ width: '42%', maxWidth: 120, aspectRatio: '1', borderRadius: '50%', objectFit: 'cover' }} />
          ) : (
            <div style={{ width: '42%', maxWidth: 120, aspectRatio: '1', borderRadius: '50%', background: '#3D5A80',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 900, fontSize: 'clamp(24px, 8vw, 44px)' }}>
              {initial}
            </div>
          )}
        </div>
      )}
      <div style={{ position: 'absolute', left: 8, bottom: 8, right: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ background: 'rgba(0,0,0,0.55)', color: 'white', fontSize: 12, fontWeight: 700, padding: '3px 8px', borderRadius: 8,
                       overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>
          {tile.name}
        </span>
        {tile.micOff && (
          <span style={{ background: 'rgba(239,68,68,0.9)', borderRadius: '50%', width: 22, height: 22, flexShrink: 0,
                         display: 'flex', alignItems: 'center', justifyContent: 'center' }}><MicOffIcon size={13} color="white" /></span>
        )}
      </div>
      {onFlip && (
        <button onClick={onFlip} aria-label={tr('Cambiar de cámara')}
          style={{ position: 'absolute', top: 8, right: 8, width: 34, height: 34, borderRadius: '50%', border: 'none', cursor: 'pointer',
                   background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <FlipIcon />
        </button>
      )}
    </div>
  );
}

// ── Hoja de participantes: quién está + llamar a más gente ──────────────────
function PeopleSheet({ me, tiles, group, chats, invited, onInvite, onClose }) {
  const inCall = new Set(tiles.map(t => t.id));
  const memberNames = group?.memberNames || {};
  const missingMembers = (group?.members || []).filter(id => !inCall.has(id));
  const memberSet = new Set(group?.members || []);
  // Otros contactos (chats 1 a 1) que no son del grupo
  const others = [];
  const seen = new Set();
  for (const c of (group && !group.guest ? chats : []) || []) {
    if (c.isGroup || String(c.id).startsWith('group_')) continue;
    const id = c.participants?.find(p => p !== me?.id);
    if (!id || seen.has(id) || memberSet.has(id) || inCall.has(id)) continue;
    seen.add(id);
    others.push({ id, name: c.name || id });
  }

  const row = (id, name, right) => (
    <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 20px' }}>
      <SmallAvatar userId={id} name={name} />
      <p style={{ flex: 1, minWidth: 0, margin: 0, color: 'white', fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</p>
      {right}
    </div>
  );

  const inviteBtn = (id) => {
    const st = invited[id];
    return (
      <button onClick={() => onInvite([id])} disabled={st === 'sending' || st === 'sent'}
        style={{ border: 'none', borderRadius: 16, padding: '7px 14px', fontWeight: 800, fontSize: 12, cursor: st === 'sending' || st === 'sent' ? 'default' : 'pointer',
                 background: st === 'sent' ? 'rgba(34,197,94,0.22)' : '#3D5A80', color: st === 'sent' ? '#4ade80' : st === 'error' ? '#fecaca' : 'white' }}>
        {st === 'sent' ? tr('Llamando…') : st === 'sending' ? '…' : st === 'error' ? tr('Reintentar') : tr('Llamar')}
      </button>
    );
  };

  const section = (title) => (
    <p style={{ margin: '14px 20px 4px', fontSize: 11, fontWeight: 800, letterSpacing: '0.6px', color: '#98C1D9' }}>{title}</p>
  );

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'flex-end' }}>
      <div onClick={e => e.stopPropagation()}
        style={{ width: '100%', maxHeight: '75vh', background: '#1a2340', borderRadius: '22px 22px 0 0', display: 'flex', flexDirection: 'column',
                 paddingBottom: 'calc(var(--sab, 0px) + 12px)' }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '16px 20px 6px' }}>
          <p style={{ flex: 1, margin: 0, color: 'white', fontWeight: 800, fontSize: 16 }}>{tr('Participantes')}</p>
          <button onClick={onClose} aria-label={tr('Cerrar')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {section(tr('EN LA LLAMADA ({length})', { length: tiles.length }))}
          {tiles.map(t => row(t.id, t.local ? tr('{p0} (tú)', { p0: me?.name || 'Tú' }) : t.name, (
            <span style={{ display: 'flex', gap: 8 }}>
              {t.micOff && <MicOffIcon size={16} color="#f87171" />}
              {!t.videoOff && t.stream?.getVideoTracks().length > 0 && <CamIcon size={16} color="#98C1D9" />}
            </span>
          )))}

          {missingMembers.length > 0 && <>
            <div style={{ display: 'flex', alignItems: 'center', paddingRight: 20 }}>
              <div style={{ flex: 1 }}>{section(tr('DEL GRUPO, FUERA DE LA LLAMADA'))}</div>
              {missingMembers.length > 1 && (
                <button onClick={() => onInvite(missingMembers.filter(id => invited[id] !== 'sent'))}
                  style={{ marginTop: 10, background: 'none', border: 'none', color: '#98C1D9', fontWeight: 800, fontSize: 12, cursor: 'pointer' }}>{tr('Llamar a todos')}</button>
              )}
            </div>
            {missingMembers.map(id => row(id, memberNames[id] || id, inviteBtn(id)))}
          </>}

          {others.length > 0 && <>
            {section(tr('INVITAR A OTROS CONTACTOS'))}
            {others.map(o => row(o.id, o.name, inviteBtn(o.id)))}
          </>}

          {!group && <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, textAlign: 'center', margin: '16px 0' }}>{tr('Cargando miembros…')}</p>}
        </div>
      </div>
    </div>
  );
}

function SmallAvatar({ userId, name }) {
  const src = useUserAvatar(userId);
  if (src) return <img src={src} alt="" style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />;
  return (
    <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#3D5A80', flexShrink: 0, display: 'flex', alignItems: 'center',
                  justifyContent: 'center', color: 'white', fontWeight: 900, fontSize: 16 }}>
      {name?.[0]?.toUpperCase() || '?'}
    </div>
  );
}

function Ctrl({ children, label, onPress, off, on }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, width: 62 }}>
      <button onClick={onPress} aria-label={label}
        style={{ width: 52, height: 52, borderRadius: '50%', border: 'none', cursor: 'pointer',
                 background: off ? 'rgba(255,255,255,0.9)' : on ? '#3D5A80' : 'rgba(255,255,255,0.16)',
                 display: 'flex', alignItems: 'center', justifyContent: 'center', color: off ? '#111827' : 'white' }}>
        {children}
      </button>
      <span style={{ color: 'rgba(255,255,255,0.75)', fontSize: 11, fontWeight: 700, textAlign: 'center', lineHeight: 1.15 }}>{label}</span>
    </div>
  );
}

// ── Iconos ───────────────────────────────────────────────────────────────────
const svgProps = (size, color) => ({ width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: color, strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' });
const MicIcon = ({ size = 22, color = 'currentColor' }) => <svg {...svgProps(size, color)}><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/><path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8"/></svg>;
const MicOffIcon = ({ size = 22, color = 'currentColor' }) => <svg {...svgProps(size, color)}><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 005.12 2.12M15 9.34V4a3 3 0 00-5.94-.6"/><path d="M17 16.95A7 7 0 015 12v-2m14 0v2a7 7 0 01-.11 1.23M12 19v4M8 23h8"/></svg>;
const CamIcon = ({ size = 22, color = 'currentColor' }) => <svg {...svgProps(size, color)}><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>;
const CamOffIcon = ({ size = 22, color = 'currentColor' }) => <svg {...svgProps(size, color)}><path d="M16 16v1a2 2 0 01-2 2H3a2 2 0 01-2-2V7a2 2 0 012-2h2m5.66 0H14a2 2 0 012 2v3.34l1 1L23 7v10"/><line x1="1" y1="1" x2="23" y2="23"/></svg>;
const SpeakerIcon = ({ size = 22, color = 'currentColor' }) => <svg {...svgProps(size, color)}><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 010 7.07M19.07 4.93a10 10 0 010 14.14"/></svg>;
const AddPersonIcon = ({ size = 22, color = 'currentColor' }) => <svg {...svgProps(size, color)}><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>;
const PeopleIcon = () => <svg {...svgProps(16, 'white')}><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>;
const FlipIcon = () => <svg {...svgProps(18, 'white')}><path d="M20 7h-3l-2-3H9L7 7H4a2 2 0 00-2 2v9a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2z"/><path d="M9 13a3 3 0 015-2.2M15 13a3 3 0 01-5 2.2"/></svg>;
const HangIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="white" style={{ transform: 'rotate(135deg)' }}>
    <path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/>
  </svg>
);
