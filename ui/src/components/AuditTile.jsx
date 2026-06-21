import { useState, useEffect, useRef } from 'react'
import { getAudit } from '../api'
import { socket } from '../socket'

function fmt(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', second:'2-digit' })
}

const EVENT_COLOR = {
  TOKEN_ISSUED:   'var(--success)',
  TOKEN_REVOKED:  'var(--danger)',
  APPROVED:       'var(--success)',
  ACTION_ALLOWED: 'var(--success)',
  DENIED:         'var(--danger)',
  SCOPE_DENIED:   'var(--danger)',
  EXPIRED:        'var(--text-subtle)',
  SCOPE_DERIVED:  'var(--info)',
  SESSION_ENDED:  'var(--warning)',
  SUBMITTED:      'var(--accent-bright)',
}

export default function AuditTile() {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [newIds, setNewIds] = useState(new Set())
  const newIdsRef = useRef(new Set())
  const bodyRef = useRef(null)

  useEffect(() => {
    getAudit(200)
      .then(d => setEvents(d.events ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    function handler(ev) {
      setEvents(prev => [ev, ...prev].slice(0, 500))
      const id = ev.id ?? `live-${Date.now()}`
      newIdsRef.current = new Set([...newIdsRef.current, id])
      setNewIds(new Set(newIdsRef.current))
      setTimeout(() => {
        newIdsRef.current.delete(id)
        setNewIds(new Set(newIdsRef.current))
      }, 2600)
      // Scroll to top for new events
      if (bodyRef.current) bodyRef.current.scrollTop = 0
    }
    socket.on('audit:event', handler)
    return () => socket.off('audit:event', handler)
  }, [])

  return (
    <>
      <div className="tile__header">
        <span className="tile__title">Audit Log</span>
        <span className="tile__count">{events.length}</span>
      </div>
      <div className="tile__body tile__body--flush" ref={bodyRef}
           style={{ overflowY:'auto' }}>
        {loading ? (
          <div className="state-loading"><span className="spinner"/>Loading…</div>
        ) : events.length === 0 ? (
          <div className="state-empty">
            <span className="state-empty__icon">◷</span>
            <h3>No events yet</h3>
            <p>Simulate a request to see the full lifecycle here.</p>
          </div>
        ) : (
          events.map((ev, i) => {
            const evId = ev.id ?? i
            const isNew = newIds.has(evId)
            return (
              <div key={evId} className={`audit-row${isNew ? ' audit-row--new' : ''}`}>
                <span className="audit-time">{fmt(ev.timestamp ?? ev.created_at)}</span>
                <span className="audit-event" style={{ color: EVENT_COLOR[ev.event] ?? 'var(--info)' }}>
                  {ev.event}
                </span>
                <span className="audit-detail">
                  {ev.service && <span style={{ textTransform:'capitalize' }}>{ev.service} · </span>}
                  {ev.scope?.length > 0 && <span>[{ev.scope.join(', ')}] · </span>}
                  {ev.detail ?? ''}
                </span>
              </div>
            )
          })
        )}
      </div>
    </>
  )
}
