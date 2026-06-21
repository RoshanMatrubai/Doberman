import { useState, useEffect, useCallback, useRef } from 'react'
import { getSessions, endSession, demoAction } from '../api'
import { socket } from '../socket'
import { useCursorGlow } from '../hooks'

const REASON = { admin_ended:'ended by admin', admin_revoked:'revoked by admin', ttl_expired:'TTL expired' }

// Realistic agent actions per service — label shown in UI, action = canonical scope name
const SERVICE_ACTIONS = {
  amazon: [
    { label: 'Search products',   action: 'search'   },
    { label: 'View listing',      action: 'read'     },
    { label: 'Write review',      action: 'write'    },
    { label: 'Add to cart',       action: 'purchase' },
    { label: 'Checkout',          action: 'purchase' },
    { label: 'Cancel order',      action: 'delete'   },
  ],
  google: [
    { label: 'Search web',        action: 'search'   },
    { label: 'Read emails',       action: 'read'     },
    { label: 'Send email',        action: 'write'    },
    { label: 'Edit document',     action: 'write'    },
    { label: 'Delete email',      action: 'delete'   },
  ],
  github: [
    { label: 'Search repos',      action: 'search'   },
    { label: 'View issues',       action: 'read'     },
    { label: 'Create issue',      action: 'write'    },
    { label: 'Push commit',       action: 'write'    },
    { label: 'Delete branch',     action: 'delete'   },
  ],
  slack: [
    { label: 'Search messages',   action: 'search'   },
    { label: 'Read channel',      action: 'read'     },
    { label: 'Send message',      action: 'write'    },
    { label: 'Create channel',    action: 'write'    },
    { label: 'Delete message',    action: 'delete'   },
  ],
  jira: [
    { label: 'Search tickets',    action: 'search'   },
    { label: 'View ticket',       action: 'read'     },
    { label: 'Create ticket',     action: 'write'    },
    { label: 'Update status',     action: 'write'    },
    { label: 'Delete issue',      action: 'delete'   },
  ],
}

function ttl(exp) {
  if (!exp) return null
  const d = new Date(exp) - Date.now()
  if (d <= 0) return 'Expired'
  const m = Math.floor(d / 60000), s = Math.floor((d % 60000) / 1000)
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

function ActionButtons({ session }) {
  const actions = SERVICE_ACTIONS[session.service?.toLowerCase()] ?? []
  const [results, setResults] = useState({})   // { label: 'allowed'|'denied' }
  const [loading, setLoading] = useState(null)

  async function tryAction(label, action) {
    setLoading(label)
    try {
      const data = await demoAction(action, session.id)
      setResults(r => ({ ...r, [label]: data.allowed ? 'allowed' : 'denied' }))
      setTimeout(() => setResults(r => { const n = { ...r }; delete n[label]; return n }), 3000)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(null)
    }
  }

  if (!actions.length) return null

  return (
    <div style={{ marginTop:10, paddingTop:10, borderTop:'1px solid var(--border)' }}>
      <div style={{ fontSize:9, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.8px',
                    color:'var(--text-subtle)', marginBottom:7 }}>Try an action</div>
      <div style={{ display:'flex', flexWrap:'wrap', gap:5 }}>
        {actions.map(({ label, action }) => {
          const res = results[label]
          const isLoading = loading === label
          return (
            <button
              key={label}
              onClick={() => tryAction(label, action)}
              disabled={!!loading}
              style={{
                padding: '3px 10px', borderRadius: 5, fontSize: 11, fontWeight: 600,
                fontFamily: 'Inter, sans-serif', cursor: 'pointer', transition: 'all 0.14s',
                border: `1px solid ${
                  res === 'allowed' ? 'rgba(34,197,94,0.35)' :
                  res === 'denied'  ? 'rgba(239,68,68,0.35)' :
                  'rgba(255,255,255,0.09)'}`,
                background: res === 'allowed' ? 'rgba(34,197,94,0.1)' :
                            res === 'denied'  ? 'rgba(239,68,68,0.1)' :
                            'rgba(255,255,255,0.04)',
                color: res === 'allowed' ? 'var(--success)' :
                       res === 'denied'  ? 'var(--danger)'  : 'var(--text-muted)',
                opacity: !!loading && !isLoading ? 0.4 : 1,
              }}
            >
              {isLoading ? <span className="spinner" style={{ display:'inline-block' }} /> :
               res === 'allowed' ? `✓ ${label}` :
               res === 'denied'  ? `✕ ${label}` :
               label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function SessionCard({ session, onEnded }) {
  const [ending, setEnding] = useState(false)
  const [ttlVal, setTtlVal] = useState(() => ttl(session.session_expires_at))
  const { ref, handleMouseMove } = useCursorGlow()

  useEffect(() => {
    const t = setInterval(() => setTtlVal(ttl(session.session_expires_at)), 1000)
    return () => clearInterval(t)
  }, [session.session_expires_at])

  async function handleEnd() {
    if (ending) return
    setEnding(true)
    try { await endSession(session.id); onEnded(session.id) }
    catch (e) { console.error(e); setEnding(false) }
  }

  const ttlColor = !ttlVal || ttlVal === 'Expired' ? 'var(--danger)'
    : ttlVal.includes('m') ? 'var(--text-muted)' : 'var(--warning)'

  return (
    <div className="session-card" ref={ref} onMouseMove={handleMouseMove}>
      <div className="session-card__inner">
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12 }}>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6 }}>
              <span className="live-dot"/>
              <span style={{ fontWeight:700, fontSize:14, letterSpacing:'-0.2px', textTransform:'capitalize' }}>
                {session.service}
              </span>
              <span className="badge badge--success" style={{ fontSize:9, padding:'1px 6px' }}>LIVE</span>
            </div>
            <div style={{ fontSize:10.5, color:'var(--text-subtle)', fontFamily:'JetBrains Mono,monospace', marginBottom:8 }}>
              agent:{session.agent_id?.slice(0,12)} · {session.tenant_id?.slice(0,10)}…
            </div>
            <div style={{ display:'flex', flexWrap:'wrap', gap:4, marginBottom:4 }}>
              {(session.scope||[]).map(a => (
                <span key={a} style={{
                  padding:'2px 8px', borderRadius:4, fontSize:10.5, fontWeight:600,
                  fontFamily:'JetBrains Mono,monospace',
                  background:'rgba(129,140,248,0.1)', color:'#A5B4FC',
                  border:'1px solid rgba(129,140,248,0.18)',
                }}>{a}</span>
              ))}
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:12, fontSize:10.5, color:'var(--text-subtle)', marginTop:6 }}>
              <code style={{ fontFamily:'JetBrains Mono,monospace', fontSize:10 }}>
                {session.token_id ? session.token_id.slice(0,14)+'…' : 'n/a'}
              </code>
              {ttlVal && (
                <span style={{ fontWeight:700, fontFamily:'JetBrains Mono,monospace', color: ttlColor }}>
                  ⏱ {ttlVal}
                </span>
              )}
            </div>
          </div>
          <button className="btn btn--end" onClick={handleEnd} disabled={ending}>
            {ending ? <><span className="spinner"/>Ending…</> : 'End Session'}
          </button>
        </div>
        <ActionButtons session={session} />
      </div>
    </div>
  )
}

function EndedBanner({ event, onDismiss }) {
  useEffect(() => { const t = setTimeout(onDismiss, 5000); return () => clearTimeout(t) }, [onDismiss])
  return (
    <div className="session-ended-banner">
      <span style={{ color:'var(--danger)', fontSize:12.5, fontWeight:600 }}>
        Session ended — <span style={{ textTransform:'capitalize' }}>{event.service}</span>
        <span style={{ fontWeight:400, opacity:0.7, marginLeft:6 }}>
          ({REASON[event.reason] ?? event.reason})
        </span>
      </span>
      <button onClick={onDismiss} style={{ background:'none', border:'none', color:'var(--text-subtle)', cursor:'pointer', fontSize:16 }}>×</button>
    </div>
  )
}

export default function SessionsTile({ onCountChange }) {
  const [sessions, setSessions]       = useState([])
  const [loading, setLoading]         = useState(true)
  const [endedEvents, setEndedEvents] = useState([])
  const tileBodyRef = useRef(null)

  const load = useCallback(async () => {
    setLoading(true)
    try { const d = await getSessions(); setSessions(d.sessions ?? []) }
    catch (e) { console.error('[SessionsTile] load error', e) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    function onStarted({ request }) {
      if (!request || request.state !== 'APPROVED' || !request.token_id) return
      setSessions(prev => prev.find(s => s.id === request.id) ? prev : [request, ...prev])
      onCountChange?.(c => c + 1)
      // Flash tile border green
      tileBodyRef.current?.parentElement?.classList.add('tile--flash-session')
      setTimeout(() => tileBodyRef.current?.parentElement?.classList.remove('tile--flash-session'), 800)
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
      setEndedEvents(prev => [{ ...event, _id: Date.now() }, ...prev].slice(0, 3))
      onCountChange?.(c => Math.max(0, c - 1))
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
      socket.off('session:started',  onStarted)
      socket.off('request:resolved', onResolved)
      socket.off('session:ended',    onEnded)
      socket.off('token:revoked',    onRevoked)
    }
  }, [onCountChange])

  function handleEnded(id) {
    setSessions(prev => prev.filter(s => s.id !== id))
    onCountChange?.(c => Math.max(0, c - 1))
  }

  return (
    <>
      <div className="tile__header">
        <span className="tile__title">Active Sessions</span>
        <div className="tile__right">
          {sessions.length > 0 && (
            <span className="tile__count" style={{ color:'var(--success)' }}>{sessions.length}</span>
          )}
          <button className="icon-btn" onClick={load} title="Refresh">↻</button>
        </div>
      </div>
      <div className="tile__body" ref={tileBodyRef}>
        {endedEvents.length > 0 && (
          <div style={{ display:'flex', flexDirection:'column', gap:6, marginBottom:8 }}>
            {endedEvents.map(evt => (
              <EndedBanner key={evt._id} event={evt}
                onDismiss={() => setEndedEvents(prev => prev.filter(e => e._id !== evt._id))} />
            ))}
          </div>
        )}
        {loading ? (
          <div className="state-loading"><span className="spinner"/>Loading…</div>
        ) : sessions.length === 0 ? (
          <div className="state-empty">
            <span className="state-empty__icon">◈</span>
            <h3>No active sessions</h3>
            <p>Approve a pending request to see a live session here.</p>
          </div>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            {sessions.map(s => <SessionCard key={s.id} session={s} onEnded={handleEnded} />)}
          </div>
        )}
      </div>
    </>
  )
}
