/**
 * PollPage — Encuestas POLL integradas en OldFace
 * /poll           → listado (encuesta actual, en curso, finalizadas, mis votos)
 * /poll/:pollId   → detalle: votar, resultados y datos demográficos
 * Las encuestas se gestionan desde el panel /admin → Encuestas.
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
const BRAND   = '#000080';

const SEX_LABELS = { male: 'Hombre', female: 'Mujer', other: 'Otro', prefer_not_say: 'Prefiero no decirlo' };
const AGE_ORDER  = ['< 18', '18-24', '25-34', '35-44', '45-54', '55+'];

// ── Helpers ──────────────────────────────────────────────────────────────────
function fmtDate(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
}

function timeLeft(endsAt) {
  if (!endsAt) return null;
  const ms = endsAt - Date.now();
  if (ms <= 0) return null;
  const h = Math.floor(ms / 3_600_000);
  if (h >= 48) return `Quedan ${Math.floor(h / 24)} días`;
  if (h >= 1)  return `Quedan ${h} h`;
  return `Quedan ${Math.max(1, Math.floor(ms / 60_000))} min`;
}

function videoEmbedUrl(url) {
  if (!url) return null;
  const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/);
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`;
  const vm = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vm) return `https://player.vimeo.com/video/${vm[1]}`;
  return null;
}

async function api(path, opts) {
  const res  = await fetch(`${BACKEND}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts?.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || 'Error de conexión'); e.data = data; throw e; }
  return data;
}

// ── Página ───────────────────────────────────────────────────────────────────
export default function PollPage() {
  const { pollId } = useParams();
  return pollId ? <PollDetail pollId={pollId} /> : <PollList />;
}

// ── Cabecera común ───────────────────────────────────────────────────────────
function Header({ title, subtitle, onBack, children }) {
  return (
    <div style={{ background: BRAND, color: 'white', flexShrink: 0, paddingTop: 'var(--sat)', boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px 12px' }}>
        <button onClick={onBack} aria-label="Volver" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 19l-7-7 7-7"/>
          </svg>
        </button>
        <div style={{ minWidth: 0 }}>
          <p style={{ fontSize: 18, fontWeight: 900, margin: 0, letterSpacing: 0.5 }}>{title}</p>
          {subtitle && <p style={{ fontSize: 12, margin: 0, opacity: 0.75 }}>{subtitle}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}

// ── Listado ──────────────────────────────────────────────────────────────────
function PollList() {
  const navigate  = useNavigate();
  const { user }  = useAuthStore();
  const [tab, setTab]           = useState('polls'); // polls | history
  const [data, setData]         = useState(null);
  const [history, setHistory]   = useState(null);
  const [categories, setCats]   = useState([]);
  const [catFilter, setCatFilter] = useState(null);
  const [error, setError]       = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const [polls, meta] = await Promise.all([
        api(`/poll/polls?userId=${encodeURIComponent(user?.id || '')}`),
        api('/poll/meta'),
      ]);
      setData(polls);
      setCats(meta.categories || []);
    } catch (e) { setError(e.message); }
  }, [user?.id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (tab !== 'history' || history) return;
    api(`/poll/history?userId=${encodeURIComponent(user?.id || '')}`)
      .then(d => setHistory(d.polls || []))
      .catch(e => setError(e.message));
  }, [tab]);

  const byCat = (list) => catFilter ? list.filter(p => p.category?.id === catFilter) : list;
  const current  = data?.current && (!catFilter || data.current.category?.id === catFilter) ? data.current : null;
  const active   = byCat(data?.active || []);
  const finished = byCat(data?.finished || []);

  const open = (p) => navigate(`/poll/${p.id}`);

  return (
    <div className="bg-gray-50" style={{ display: 'flex', flexDirection: 'column', height: '100dvh' }}>
      <Header title="POLL" subtitle="Tu voz importa. Participa en encuestas." onBack={() => navigate(-1)}>
        <div style={{ display: 'flex', padding: '0 14px' }}>
          {[['polls', 'Encuestas'], ['history', 'Mis votos']].map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)} style={{
              flex: 1, background: 'none', border: 'none', cursor: 'pointer', color: 'white',
              padding: '10px 0', fontSize: 14, fontWeight: tab === id ? 800 : 500,
              opacity: tab === id ? 1 : 0.7,
              borderBottom: tab === id ? '3px solid white' : '3px solid transparent',
            }}>{label}</button>
          ))}
        </div>
      </Header>

      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 14px calc(var(--sab) + 24px)' }}>
        {error && <ErrorBox msg={error} onRetry={load} />}

        {tab === 'polls' && !data && !error && <Spinner />}

        {tab === 'polls' && data && (
          <>
            {categories.length > 0 && (
              <div className="scroll-hide" style={{ display: 'flex', gap: 8, overflowX: 'auto', marginBottom: 14, paddingBottom: 2 }}>
                <Chip active={!catFilter} onClick={() => setCatFilter(null)}>Todas</Chip>
                {categories.map(c => (
                  <Chip key={c.id} active={catFilter === c.id} onClick={() => setCatFilter(c.id)}>
                    {c.icon ? `${c.icon} ` : ''}{c.name}
                  </Chip>
                ))}
              </div>
            )}

            {current && <CurrentPollCard poll={current} onOpen={() => open(current)} />}

            <Section title="En curso" count={active.length} />
            {active.length === 0 && !current && <Empty text="No hay encuestas activas ahora mismo." />}
            {active.length === 0 && current && <Empty text="No hay más encuestas en curso." />}
            {active.map(p => <PollRow key={p.id} poll={p} onOpen={() => open(p)} />)}

            <Section title="Finalizadas" count={finished.length} />
            {finished.length === 0 && <Empty text="Todavía no hay encuestas finalizadas." />}
            {finished.map(p => <PollRow key={p.id} poll={p} onOpen={() => open(p)} />)}
          </>
        )}

        {tab === 'history' && (
          history === null ? <Spinner /> :
          history.length === 0
            ? <Empty text="Aún no has votado en ninguna encuesta." />
            : history.map(p => <PollRow key={p.id} poll={p} onOpen={() => open(p)} />)
        )}
      </div>
    </div>
  );
}

function CurrentPollCard({ poll, onOpen }) {
  const left = timeLeft(poll.endsAt);
  return (
    <button onClick={onOpen} style={{
      width: '100%', textAlign: 'left', border: 'none', cursor: 'pointer',
      background: `linear-gradient(135deg, ${BRAND} 0%, #1e3a8a 100%)`, color: 'white',
      borderRadius: 20, padding: 18, marginBottom: 18, boxShadow: '0 8px 24px rgba(0,0,128,0.3)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ background: '#ef4444', fontSize: 10, fontWeight: 900, padding: '3px 8px', borderRadius: 20, letterSpacing: 0.6 }}>
          ● ENCUESTA ACTUAL
        </span>
        {poll.category && <span style={{ fontSize: 11, opacity: 0.8 }}>{poll.category.icon} {poll.category.name}</span>}
      </div>
      <p style={{ fontSize: 19, fontWeight: 900, margin: '0 0 6px', lineHeight: 1.25 }}>{poll.title}</p>
      {poll.description && <p style={{ fontSize: 13, opacity: 0.85, margin: '0 0 12px', lineHeight: 1.45 }}>{poll.description}</p>}
      {poll.options.slice(0, 4).map(o => (
        <div key={o.id} style={{ marginBottom: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
            <span style={{ fontWeight: poll.myVote === o.id ? 800 : 500 }}>{poll.myVote === o.id ? '✓ ' : ''}{o.text}</span>
            <span style={{ fontWeight: 700 }}>{o.percentage}%</span>
          </div>
          <div style={{ height: 6, background: 'rgba(255,255,255,0.2)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ width: `${o.percentage}%`, height: '100%', background: 'white', borderRadius: 3 }} />
          </div>
        </div>
      ))}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, fontSize: 12 }}>
        <span style={{ opacity: 0.8 }}>{poll.totalVotes} {poll.totalVotes === 1 ? 'voto' : 'votos'}{left ? ` · ${left}` : ''}</span>
        <span style={{ background: 'white', color: BRAND, fontWeight: 900, padding: '7px 14px', borderRadius: 20 }}>
          {poll.myVote ? 'Ver resultados' : 'Votar ahora →'}
        </span>
      </div>
    </button>
  );
}

function PollRow({ poll, onOpen }) {
  const closed = poll.status === 'closed';
  const left   = timeLeft(poll.endsAt);
  const winner = closed && poll.totalVotes ? [...poll.options].sort((a, b) => b.count - a.count)[0] : null;
  return (
    <button onClick={onOpen} className="bg-white" style={{
      width: '100%', textAlign: 'left', border: '1px solid rgba(148,163,184,0.25)', cursor: 'pointer',
      borderRadius: 16, padding: '14px 16px', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 12,
      boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
    }}>
      <div style={{
        width: 42, height: 42, borderRadius: 12, flexShrink: 0, fontSize: 20,
        background: closed ? '#f1f5f9' : '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {poll.category?.icon || '📊'}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p className="text-gray-800" style={{ fontSize: 14, fontWeight: 800, margin: '0 0 3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {poll.title}
        </p>
        <p className="text-gray-500" style={{ fontSize: 12, margin: 0 }}>
          {poll.totalVotes} {poll.totalVotes === 1 ? 'voto' : 'votos'}
          {winner ? ` · Ganó: ${winner.text} (${winner.percentage}%)` : left ? ` · ${left}` : ''}
        </p>
      </div>
      {poll.myVote
        ? <Badge color="#16a34a" bg="#dcfce7">Votado</Badge>
        : closed ? <Badge color="#64748b" bg="#f1f5f9">Cerrada</Badge>
        : <Badge color={BRAND} bg="#e0e7ff">Votar</Badge>}
    </button>
  );
}

// ── Detalle ──────────────────────────────────────────────────────────────────
function PollDetail({ pollId }) {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [poll, setPoll]         = useState(null);
  const [error, setError]       = useState('');
  const [selected, setSelected] = useState(null);
  const [voting, setVoting]     = useState(false);
  const [voteError, setVoteError] = useState('');
  const [showProfile, setShowProfile] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const d = await api(`/poll/polls/${pollId}?userId=${encodeURIComponent(user?.id || '')}`);
      setPoll(d.poll);
    } catch (e) { setError(e.message); }
  }, [pollId, user?.id]);

  useEffect(() => { load(); }, [load]);

  const vote = async () => {
    if (!selected) return;
    setVoting(true); setVoteError('');
    try {
      const d = await api(`/poll/polls/${pollId}/vote`, {
        method: 'POST', body: JSON.stringify({ userId: user?.id, optionId: selected }),
      });
      setPoll(d.poll);
    } catch (e) {
      if (e.data?.needsProfile) setShowProfile(true);
      else setVoteError(e.message);
    } finally { setVoting(false); }
  };

  const embed     = videoEmbedUrl(poll?.videoUrl);
  const canVote   = poll?.status === 'active' && !poll?.myVote;
  const left      = timeLeft(poll?.endsAt);

  return (
    <div className="bg-gray-50" style={{ display: 'flex', flexDirection: 'column', height: '100dvh' }}>
      <Header title="POLL" subtitle={poll?.category ? `${poll.category.icon || ''} ${poll.category.name}` : 'Encuesta'} onBack={() => navigate(-1)} />

      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 14px calc(var(--sab) + 24px)' }}>
        {error && <ErrorBox msg={error} onRetry={load} />}
        {!poll && !error && <Spinner />}

        {poll && (
          <>
            <Card>
              <p className="text-gray-800" style={{ fontSize: 20, fontWeight: 900, margin: '0 0 6px', lineHeight: 1.25 }}>{poll.title}</p>
              {poll.description && <p className="text-gray-600" style={{ fontSize: 14, margin: '0 0 10px', lineHeight: 1.5 }}>{poll.description}</p>}
              <div className="text-gray-500" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 12 }}>
                <span>📅 {fmtDate(poll.startsAt)}</span>
                <span>👥 {poll.totalVotes} {poll.totalVotes === 1 ? 'participante' : 'participantes'}</span>
                {poll.country && <span>🌍 {poll.country}</span>}
                {left && <span>⏳ {left}</span>}
              </div>

              {embed && (
                <div style={{ position: 'relative', paddingTop: '56.25%', marginTop: 14, borderRadius: 12, overflow: 'hidden', background: '#000' }}>
                  <iframe
                    src={embed} title="Vídeo de la encuesta" allowFullScreen
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }}
                  />
                </div>
              )}

              {poll.status === 'closed' && <Notice color="#64748b" bg="#f1f5f9">Esta encuesta está cerrada y ya no acepta votos.</Notice>}
              {poll.myVote && <Notice color="#15803d" bg="#dcfce7">¡Gracias por participar! Tu voto ha sido registrado.</Notice>}
            </Card>

            {canVote && (
              <Card>
                <p className="text-gray-800" style={{ fontSize: 15, fontWeight: 800, margin: '0 0 12px' }}>Participa con tu voto</p>
                {poll.options.map(o => {
                  const on = selected === o.id;
                  return (
                    <button key={o.id} onClick={() => setSelected(o.id)} className={on ? '' : 'bg-white text-gray-800'} style={{
                      width: '100%', textAlign: 'left', cursor: 'pointer', marginBottom: 8,
                      padding: '13px 14px', borderRadius: 12, fontSize: 14, fontWeight: 700,
                      border: `2px solid ${on ? BRAND : 'rgba(148,163,184,0.35)'}`,
                      background: on ? '#e0e7ff' : undefined, color: on ? BRAND : undefined,
                      display: 'flex', alignItems: 'center', gap: 10,
                    }}>
                      <span style={{
                        width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
                        border: `2px solid ${on ? BRAND : '#94a3b8'}`, background: on ? BRAND : 'transparent',
                        boxShadow: on ? 'inset 0 0 0 3px white' : 'none',
                      }} />
                      {o.text}
                    </button>
                  );
                })}
                {voteError && <p style={{ color: '#dc2626', fontSize: 13, fontWeight: 600, margin: '4px 0 8px' }}>{voteError}</p>}
                <button onClick={vote} disabled={!selected || voting} style={{
                  width: '100%', marginTop: 6, padding: 14, border: 'none', borderRadius: 14,
                  background: selected ? BRAND : '#cbd5e1', color: 'white', fontSize: 15, fontWeight: 900,
                  cursor: selected && !voting ? 'pointer' : 'default',
                }}>
                  {voting ? 'Enviando…' : 'Votar'}
                </button>
                <p className="text-gray-500" style={{ fontSize: 11, textAlign: 'center', margin: '8px 0 0' }}>
                  Solo se permite un voto por persona. No se puede cambiar.
                </p>
              </Card>
            )}

            <Card>
              <p className="text-gray-800" style={{ fontSize: 15, fontWeight: 800, margin: '0 0 12px' }}>
                {poll.status === 'closed' ? 'Resultados finales' : 'Resultados actuales'}
              </p>
              <Results poll={poll} />
            </Card>

            {poll.demographics?.totalVoters > 0 && <Demographics data={poll.demographics} />}
          </>
        )}
      </div>

      {showProfile && (
        <ProfileModal
          userId={user?.id}
          onClose={() => setShowProfile(false)}
          onSaved={() => { setShowProfile(false); vote(); }}
        />
      )}
    </div>
  );
}

function Results({ poll }) {
  const max = Math.max(...poll.options.map(o => o.count), 0);
  return poll.options.map(o => {
    const mine = poll.myVote === o.id;
    const lead = max > 0 && o.count === max;
    return (
      <div key={o.id} style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13, marginBottom: 5 }}>
          <span className="text-gray-800" style={{ fontWeight: mine || lead ? 800 : 600 }}>
            {lead && poll.status === 'closed' ? '🏆 ' : ''}{o.text}{mine ? '  ✓ Tu voto' : ''}
          </span>
          <span className="text-gray-500" style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{o.percentage}% · {o.count}</span>
        </div>
        <div className="bg-gray-200" style={{ height: 10, borderRadius: 5, overflow: 'hidden' }}>
          <div style={{ width: `${o.percentage}%`, height: '100%', borderRadius: 5, background: lead ? BRAND : '#6366f1', transition: 'width 0.6s' }} />
        </div>
      </div>
    );
  });
}

function Demographics({ data }) {
  const sex = useMemo(() => Object.entries(data.sex).map(([k, v]) => [SEX_LABELS[k] || k, v]), [data]);
  const age = useMemo(() => AGE_ORDER.filter(k => data.age[k]).map(k => [k, data.age[k]]), [data]);
  const nat = useMemo(() => Object.entries(data.nationality).sort((a, b) => b[1] - a[1]).slice(0, 6), [data]);
  return (
    <Card>
      <p className="text-gray-800" style={{ fontSize: 15, fontWeight: 800, margin: '0 0 2px' }}>¿Quién ha votado?</p>
      <p className="text-gray-500" style={{ fontSize: 12, margin: '0 0 14px' }}>Datos anónimos de {data.totalVoters} {data.totalVoters === 1 ? 'participante' : 'participantes'}</p>
      <BarGroup title="Sexo" rows={sex} total={data.totalVoters} />
      <BarGroup title="Edad" rows={age} total={data.totalVoters} />
      <BarGroup title="Nacionalidad" rows={nat} total={data.totalVoters} />
    </Card>
  );
}

function BarGroup({ title, rows, total }) {
  if (!rows.length) return null;
  return (
    <div style={{ marginBottom: 14 }}>
      <p className="text-gray-600" style={{ fontSize: 12, fontWeight: 800, margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: 0.5 }}>{title}</p>
      {rows.map(([label, n]) => {
        const pct = Math.round((n / total) * 100);
        return (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
            <span className="text-gray-700" style={{ fontSize: 12, width: 110, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
            <div className="bg-gray-200" style={{ flex: 1, height: 8, borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: '#3b82f6', borderRadius: 4 }} />
            </div>
            <span className="text-gray-500" style={{ fontSize: 11, width: 34, textAlign: 'right', fontWeight: 700 }}>{pct}%</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Modal de perfil demográfico ──────────────────────────────────────────────
function ProfileModal({ userId, onClose, onSaved }) {
  const [countries, setCountries] = useState([]);
  const [form, setForm]   = useState({ age: '', sex: '', postalCode: '', nationality: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/poll/meta').then(d => setCountries(d.countries || [])).catch(() => {});
    api(`/poll/profile/${encodeURIComponent(userId || '')}`).then(d => {
      if (d.profile) setForm({ age: String(d.profile.age), sex: d.profile.sex, postalCode: d.profile.postalCode, nationality: d.profile.nationality });
    }).catch(() => {});
  }, [userId]);

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const save = async (e) => {
    e.preventDefault();
    if (!form.age || !form.sex || !form.postalCode || !form.nationality) { setError('Completa todos los campos'); return; }
    setSaving(true); setError('');
    try {
      await api('/poll/profile', { method: 'POST', body: JSON.stringify({ userId, ...form }) });
      onSaved();
    } catch (err) { setError(err.message); setSaving(false); }
  };

  const input = { width: '100%', padding: '12px 14px', borderRadius: 12, border: '1px solid #cbd5e1', fontSize: 15, outline: 'none', background: 'white', color: '#1e293b' };
  const label = { display: 'block', fontSize: 12, fontWeight: 800, color: '#475569', margin: '0 0 6px' };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={onClose}>
      <form onSubmit={save} onClick={e => e.stopPropagation()} style={{
        background: 'white', width: '100%', maxWidth: 480, borderRadius: '24px 24px 0 0',
        padding: '22px 20px calc(var(--sab) + 22px)', maxHeight: '92dvh', overflowY: 'auto',
      }}>
        <p style={{ fontSize: 19, fontWeight: 900, color: '#1e293b', margin: '0 0 8px' }}>Completa tu perfil</p>
        <p style={{ fontSize: 13, color: '#1e40af', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 12, padding: 12, margin: '0 0 16px', lineHeight: 1.5 }}>
          Para mostrar resultados claros necesitamos tu sexo, edad, código postal y nacionalidad.
          Se muestran solo de forma agregada y anónima. Solo se pide una vez.
        </p>

        <div style={{ marginBottom: 12 }}>
          <label style={label} htmlFor="pp-age">Edad</label>
          <input id="pp-age" type="number" inputMode="numeric" min="16" max="120" placeholder="Ej: 25" value={form.age} onChange={set('age')} style={input} />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={label} htmlFor="pp-sex">Sexo</label>
          <select id="pp-sex" value={form.sex} onChange={set('sex')} style={input}>
            <option value="">Selecciona…</option>
            {Object.entries(SEX_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={label} htmlFor="pp-cp">Código postal</label>
          <input id="pp-cp" type="text" placeholder="Ej: 28001" value={form.postalCode} onChange={set('postalCode')} style={input} />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={label} htmlFor="pp-nat">Nacionalidad</label>
          <select id="pp-nat" value={form.nationality} onChange={set('nationality')} style={input}>
            <option value="">Selecciona…</option>
            {countries.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        {error && <p style={{ color: '#dc2626', fontSize: 13, fontWeight: 600, margin: '0 0 10px' }}>{error}</p>}

        <div style={{ display: 'flex', gap: 10 }}>
          <button type="button" onClick={onClose} style={{ flex: 1, padding: 14, borderRadius: 14, border: '1px solid #cbd5e1', background: 'white', color: '#475569', fontWeight: 800, fontSize: 15, cursor: 'pointer' }}>
            Cancelar
          </button>
          <button type="submit" disabled={saving} style={{ flex: 2, padding: 14, borderRadius: 14, border: 'none', background: BRAND, color: 'white', fontWeight: 900, fontSize: 15, cursor: 'pointer' }}>
            {saving ? 'Guardando…' : 'Guardar y votar'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── UI pequeña ───────────────────────────────────────────────────────────────
function Card({ children }) {
  return (
    <div className="bg-white" style={{ borderRadius: 18, padding: 16, marginBottom: 14, border: '1px solid rgba(148,163,184,0.2)', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
      {children}
    </div>
  );
}

function Section({ title, count }) {
  return (
    <p className="text-gray-500" style={{ fontSize: 12, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 0.8, margin: '18px 4px 10px' }}>
      {title} {count > 0 && <span style={{ opacity: 0.7 }}>({count})</span>}
    </p>
  );
}

function Chip({ active, onClick, children }) {
  return (
    <button onClick={onClick} className={active ? '' : 'bg-white text-gray-600'} style={{
      flexShrink: 0, padding: '7px 14px', borderRadius: 20, fontSize: 13, fontWeight: 700, cursor: 'pointer',
      border: `1px solid ${active ? BRAND : 'rgba(148,163,184,0.35)'}`,
      background: active ? BRAND : undefined, color: active ? 'white' : undefined, whiteSpace: 'nowrap',
    }}>{children}</button>
  );
}

function Badge({ color, bg, children }) {
  return <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 800, color, background: bg, padding: '4px 10px', borderRadius: 20 }}>{children}</span>;
}

function Notice({ color, bg, children }) {
  return <p style={{ margin: '14px 0 0', padding: '10px 12px', borderRadius: 12, fontSize: 13, fontWeight: 700, color, background: bg }}>{children}</p>;
}

function Empty({ text }) {
  return <p className="text-gray-500" style={{ textAlign: 'center', fontSize: 13, padding: '18px 10px' }}>{text}</p>;
}

function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
      <div style={{ width: 30, height: 30, border: '3px solid #e2e8f0', borderTopColor: BRAND, borderRadius: '50%', animation: 'pollSpin 0.8s linear infinite' }} />
      <style>{'@keyframes pollSpin { to { transform: rotate(360deg) } }'}</style>
    </div>
  );
}

function ErrorBox({ msg, onRetry }) {
  return (
    <div style={{ background: '#fee2e2', color: '#b91c1c', borderRadius: 14, padding: 14, marginBottom: 14, fontSize: 13, fontWeight: 600, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
      <span>{msg}</span>
      <button onClick={onRetry} style={{ background: '#b91c1c', color: 'white', border: 'none', borderRadius: 10, padding: '6px 12px', fontWeight: 800, cursor: 'pointer' }}>Reintentar</button>
    </div>
  );
}
