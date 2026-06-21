import { useState, useEffect, useCallback } from 'react'
import { socket } from '../socket'

const API = '/api'

async function _fetch(path, opts = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
  return json
}

const getSessions  = ()   => _fetch(`${API}/sessions`)
const endSession   = (id) => _fetch(`${API}/sessions/${id}/end`, { method: 'POST' })

function ttlLabel(session_expires_at) {
  if (!session_expires_at) return null
  const exp = new Date(session_expires_at)
  const diffMs = exp - Date.now()
  if (diffMs <= 0) return 'Expired'
  const mins = Math.floor(diffMs / 60000)
  const secs = Math.floor((diffMs % 60000) / 1000)
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`
}

function ScopeBadge({ action }) {
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: 12,
      fontSize: 11,
      fontWeight: 600,
      background: 'rgba(99,102,241,0.15)',
      color: '#818cf8',
      marginRight: 4,
      marginBottom: 4,
    }}>
      {action}
    </span>
  )
}

function SessionCard({ session, onEnded }) {
  const [ending, setEnding] = useState(false)
  const [ttl, setTtl] = useState(() => ttlLabel(session.session_expires_at))
  const [flash, setFlash] = useState(false)

  // TTL countdown
  useEffect(() => {
    const t = setInterval(() => {
      setTtl(ttlLabel(session.session_expires_at))
    }, 1000)
    return () => clearInterval(t)
  }, [session.session_expires_at])

  // Flash when session is ended by external event
  useEffect(() => {
    setFlash(true)
    const t = setTimeout(() => setFlash(false), 800)
    return () => clearTimeout(t)
  }, [])

  async function handleEnd() {
    if (ending) return
    setEnding(true)
    try {
      await endSession(session.id)
      onEnded(session.id, 'admin_ended')
    } catch (e) {
      console.error('[SessionCard] end error', e)
      setEnding(false)
    }
  }

  return (
    <div style={{
      background: flash ? 'rgba(99,102,241,0.08)' : 'rgba(255,255,255,0.03)',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: 12,
      padding: '16px 20px',
      transition: 'background 0.4s',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              background: '#22c55e', flexShrink: 0,
              boxShadow: '0 0 6px #22c55e',
              animation: 'pulse 2s infinite',
            }} />
            <span style={{ fontWeight: 700, fontSize: 15 }}>{session.service}</span>
            <span style={{
              fontSize: 11, padding: '2px 8px', borderRadius: 8,
              background: 'rgba(34,197,94,0.15)', color: '#4ade80', fontWeight: 600,
            }}>LIVE</span>
          </div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 8 }}>
            agent: {session.agent_id} · tenant: {session.tenant_id}
          </div>
          <div style={{ marginBottom: 8 }}>
            {(session.scope || []).map(a => <ScopeBadge key={a} action={a} />)}
          </div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>
            Token: <code style={{ fontFamily: 'monospace', fontSize: 11 }}>
              {session.token_id ? session.token_id.slice(0, 14) + '…' : 'n/a'}
            </code>
            {ttl && (
              <span style={{
                marginLeft: 12,
                color: ttl === 'Expired' ? '#f87171' : ttl.includes('m') ? 'rgba(255,255,255,0.5)' : '#fbbf24',
                fontWeight: 600,
              }}>
                ⏱ {ttl}
              </span>
            )}
          </div>
          {session.task && (
            <div style={{
              marginTop: 8, fontSize: 12, color: 'rgba(255,255,255,0.4)',
              fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              "{session.task}"
            </div>
          )}
        </div>
        <button
          onClick={handleEnd}
          disabled={ending}
          style={{
            padding: '7px 14px',
            borderRadius: 8,
            border: '1px solid rgba(239,68,68,0.4)',
            background: ending ? 'rgba(239,68,68,0.05)' : 'rgba(239,68,68,0.12)',
            color: ending ? 'rgba(239,68,68,0.5)' : '#f87171',
            fontSize: 12,
            fontWeight: 600,
            cursor: ending ? 'not-allowed' : 'pointer',
            flexShrink: 0,
            transition: 'all 0.2s',
          }}
        >
          {ending ? 'Ending…' : 'End Session'}
        </button>
      </div>
    </div>
  )
}

function EndedBanner({ event, onDismiss }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 6000)
    return () => clearTimeout(t)
  }, [onDismiss])

  const reasonLabel = {
    admin_ended:  'ended by admin',
    admin_revoked: 'revoked by admin',
    ttl_expired:  'TTL expired',
  }[event.reason] || event.reason

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '12px 16px',
      borderRadius: 10,
      background: 'rgba(239,68,68,0.1)',
      border: '1px solid rgba(239,68,68,0.3)',
      animation: 'fadeIn 0.3s ease',
    }}>
      <span style={{ color: '#f87171', fontSize: 13, fontWeight: 600 }}>
        🔴 Session ended — {event.service} · {event.agent_id?.slice(0, 12)}
        <span style={{ fontWeight: 400, opacity: 0.8 }}> ({reasonLabel})</span>
      </span>
      <button
        onClick={onDismiss}
        style={{
          background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)',
          cursor: 'pointer', fontSize: 16,
        }}
      >×</button>
    </div>
  )
}

export default function SessionMonitor() {
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
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
      setSessions(prev => {
        if (prev.find(s => s.id === request.id)) return prev
        return [request, ...prev]
      })
    }

    function onResolved({ request }) {
      if (!request) return
      if (request.state !== 'APPROVED') {
        setSessions(prev => prev.filter(s => s.id !== request.id))
      } else if (request.token_id) {
        setSessions(prev => {
          const idx = prev.findIndex(s => s.id === request.id)
          if (idx >= 0) {
            const next = [...prev]
            next[idx] = request
            return next
          }
          return [request, ...prev]
        })
      }
    }

    function onEnded(event) {
      setSessions(prev => prev.filter(s => s.id !== event.request_id))
      const id = Date.now()
      setEndedEvents(prev => [{ ...event, _id: id }, ...prev].slice(0, 5))
    }

    function onRevoked({ request_id, state }) {
      if (state === 'EXPIRED' || state === 'DENIED') {
        setSessions(prev => prev.filter(s => s.id !== request_id))
      }
    }

    socket.on('session:started', onStarted)
    socket.on('request:resolved', onResolved)
    socket.on('session:ended', onEnded)
    socket.on('token:revoked', onRevoked)
    return () => {
      socket.off('session:started', onStarted)
      socket.off('request:resolved', onResolved)
      socket.off('session:ended', onEnded)
      socket.off('token:revoked', onRevoked)
    }
  }, [])

  function handleEnded(id, reason) {
    setSessions(prev => prev.filter(s => s.id !== id))
  }

  function dismissBanner(evtId) {
    setEndedEvents(prev => prev.filter(e => e._id !== evtId))
  }

  return (
    <>
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      <div className="page-header">
        <div className="page-header__left">
          <h1>Active Sessions</h1>
          <p>Live token sessions — each expires at TTL or when ended by admin.</p>
        </div>
        <div className="page-header__right">
          <span style={{
            fontSize: 13, fontWeight: 700,
            color: sessions.length ? '#4ade80' : 'rgba(255,255,255,0.3)',
            marginRight: 8,
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
                onDismiss={() => dismissBanner(evt._id)}
              />
            ))}
          </div>
        )}

        {loading ? (
          <div className="state-loading"><span className="spinner" /> Loading sessions…</div>
        ) : sessions.length === 0 ? (
          <div className="state-empty">
            <span className="state-empty__icon">🔐</span>
            <h3>No active sessions</h3>
            <p>Approve a pending request to start a session. It will appear here live.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {sessions.map(s => (
              <SessionCard key={s.id} session={s} onEnded={handleEnded} />
            ))}
          </div>
        )}
      </div>
    </>
  )
}
