import { useState, useEffect, useCallback } from 'react'
import { socket } from '../socket'
import { getSessions, endSession } from '../api'
import { useCursorGlow } from '../hooks'

const REASON_LABEL = {
  admin_ended:   'ended by admin',
  admin_revoked: 'revoked by admin',
  ttl_expired:   'TTL expired',
}

function ttlLabel(session_expires_at) {
  if (!session_expires_at) return null
  const diff = new Date(session_expires_at) - Date.now()
  if (diff <= 0) return 'Expired'
  const mins = Math.floor(diff / 60000)
  const secs = Math.floor((diff % 60000) / 1000)
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`
}

function ttlColor(label) {
  if (!label || label === 'Expired') return 'var(--danger)'
  if (label.includes('m')) return 'var(--text-muted)'
  return 'var(--warning)'
}

function SessionCard({ session, onEnded }) {
  const [ending, setEnding] = useState(false)
  const [ttl, setTtl]       = useState(() => ttlLabel(session.session_expires_at))
  const { ref, handleMouseMove } = useCursorGlow()

  useEffect(() => {
    const t = setInterval(() => setTtl(ttlLabel(session.session_expires_at)), 1000)
    return () => clearInterval(t)
  }, [session.session_expires_at])

  async function handleEnd() {
    if (ending) return
    setEnding(true)
    try {
      await endSession(session.id)
      onEnded(session.id)
    } catch (e) {
      console.error('[SessionCard] end error', e)
      setEnding(false)
    }
  }

  return (
    <div className="session-card" ref={ref} onMouseMove={handleMouseMove}>
      <div className="session-card__inner">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* Header row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 8 }}>
              <span className="live-dot" />
              <span style={{ fontWeight: 600, fontSize: 15, letterSpacing: '-0.2px', textTransform: 'capitalize' }}>
                {session.service}
              </span>
              <span className="badge badge--success" style={{ fontSize: 10, padding: '1px 7px' }}>LIVE</span>
            </div>

            {/* Agent / tenant */}
            <div style={{ fontSize: 11.5, color: 'var(--text-subtle)', fontFamily: 'JetBrains Mono, monospace', marginBottom: 10 }}>
              agent:{session.agent_id} · tenant:{session.tenant_id?.slice(0, 10)}…
            </div>

            {/* Scope badges */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 12 }}>
              {(session.scope || []).map(a => (
                <span key={a} style={{
                  display: 'inline-block',
                  padding: '2px 9px',
                  borderRadius: 5,
                  fontSize: 10.5,
                  fontWeight: 600,
                  fontFamily: 'JetBrains Mono, monospace',
                  background: 'rgba(129,140,248,0.1)',
                  color: '#A5B4FC',
                  border: '1px solid rgba(129,140,248,0.18)',
                }}>
                  {a}
                </span>
              ))}
            </div>

            {/* Token + TTL row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 11.5, color: 'var(--text-subtle)' }}>
              <span>
                Token:{' '}
                <code style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--text-muted)' }}>
                  {session.token_id ? session.token_id.slice(0, 14) + '…' : 'n/a'}
                </code>
              </span>
              {ttl && (
                <span style={{ fontWeight: 700, fontFamily: 'JetBrains Mono, monospace', color: ttlColor(ttl) }}>
                  ⏱ {ttl}
                </span>
              )}
            </div>

            {/* Task */}
            {session.task && (
              <div style={{
                marginTop: 10,
                fontSize: 12,
                color: 'var(--text-muted)',
                fontStyle: 'italic',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                "{session.task}"
              </div>
            )}
          </div>

          <button
            className="btn btn--end"
            onClick={handleEnd}
            disabled={ending}
          >
            {ending ? <><span className="spinner" /> Ending…</> : 'End Session'}
          </button>
        </div>
      </div>
    </div>
  )
}

function EndedBanner({ event, onDismiss }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 6000)
    return () => clearTimeout(t)
  }, [onDismiss])

  return (
    <div className="session-ended-banner">
      <span style={{ color: 'var(--danger)', fontSize: 13, fontWeight: 600 }}>
        Session ended —{' '}
        <span style={{ textTransform: 'capitalize' }}>{event.service}</span>
        {' '}· agent:{event.agent_id?.slice(0, 12)}
        <span style={{ fontWeight: 400, opacity: 0.7, marginLeft: 6 }}>
          ({REASON_LABEL[event.reason] ?? event.reason})
        </span>
      </span>
      <button
        onClick={onDismiss}
        style={{
          background: 'none', border: 'none',
          color: 'var(--text-subtle)', cursor: 'pointer',
          fontSize: 18, lineHeight: 1, padding: '0 2px',
        }}
      >×</button>
    </div>
  )
}

export default function SessionMonitor() {
  const [sessions, setSessions]       = useState([])
  const [loading, setLoading]         = useState(true)
  const [endedEvents, setEndedEvents] = useState([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await getSessions()
      setSessions(data.sessions ?? [])
    } catch (e) {
      console.error('[SessionMonitor] load error', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    function onStarted({ request }) {
      if (!request || request.state !== 'APPROVED' || !request.token_id) return
      setSessions(prev => prev.find(s => s.id === request.id) ? prev : [request, ...prev])
    }

    function onResolved({ request }) {
      if (!request) return
      if (request.state !== 'APPROVED') {
        setSessions(prev => prev.filter(s => s.id !== request.id))
      } else if (request.token_id) {
        setSessions(prev => {
          const idx = prev.findIndex(s => s.id === request.id)
          if (idx >= 0) { const n = [...prev]; n[idx] = request; return n }
          return [request, ...prev]
        })
      }
    }

    function onEnded(event) {
      setSessions(prev => prev.filter(s => s.id !== event.request_id))
      setEndedEvents(prev => [{ ...event, _id: Date.now() }, ...prev].slice(0, 5))
    }

    function onRevoked({ request_id, state }) {
      if (state === 'EXPIRED' || state === 'DENIED')
        setSessions(prev => prev.filter(s => s.id !== request_id))
    }

    socket.on('session:started',   onStarted)
    socket.on('request:resolved',  onResolved)
    socket.on('session:ended',     onEnded)
    socket.on('token:revoked',     onRevoked)
    return () => {
      socket.off('session:started',   onStarted)
      socket.off('request:resolved',  onResolved)
      socket.off('session:ended',     onEnded)
      socket.off('token:revoked',     onRevoked)
    }
  }, [])

  function handleEnded(id) {
    setSessions(prev => prev.filter(s => s.id !== id))
  }

  return (
    <>
      <div className="page-header">
        <div className="page-header__left">
          <h1>Active Sessions</h1>
          <p>Live token sessions — each expires at TTL or when ended by admin.</p>
        </div>
        <div className="page-header__right">
          <span style={{
            fontSize: 13, fontWeight: 700,
            color: sessions.length ? 'var(--success)' : 'var(--text-subtle)',
            marginRight: 6,
          }}>
            {sessions.length} active
          </span>
          <button className="icon-btn" onClick={load} title="Refresh">↻</button>
        </div>
      </div>

      <div className="page-body">
        {endedEvents.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
            {endedEvents.map(evt => (
              <EndedBanner
                key={evt._id}
                event={evt}
                onDismiss={() => setEndedEvents(prev => prev.filter(e => e._id !== evt._id))}
              />
            ))}
          </div>
        )}

        {loading ? (
          <div className="state-loading"><span className="spinner" /> Loading sessions…</div>
        ) : sessions.length === 0 ? (
          <div className="state-empty">
            <span className="state-empty__icon">◈</span>
            <h3>No active sessions</h3>
            <p>Approve a pending request to start a session. It will appear here live.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {sessions.map(s => (
              <SessionCard key={s.id} session={s} onEnded={handleEnded} />
            ))}
          </div>
        )}
      </div>
    </>
  )
}
