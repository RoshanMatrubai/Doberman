import { useState, useEffect, useRef } from 'react'
import { getAudit } from '../api'
import { socket } from '../socket'

function fmtTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

const EVENT_COLOR = {
  TOKEN_ISSUED:  'var(--success)',
  TOKEN_REVOKED: 'var(--danger)',
  APPROVED:      'var(--success)',
  DENIED:        'var(--danger)',
  EXPIRED:       'var(--text-subtle)',
  SCOPE_DERIVED: 'var(--info)',
  SCOPE_DENIED:  'var(--danger)',
  SESSION_ENDED: 'var(--warning)',
  SUBMITTED:     'var(--accent-bright)',
}

export default function AuditFeed() {
  const [events, setEvents]   = useState([])
  const [loading, setLoading] = useState(true)
  const [newIds, setNewIds]   = useState(new Set())
  const newIdsRef             = useRef(new Set())

  useEffect(() => {
    getAudit(100)
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
    }
    socket.on('audit:event', handler)
    return () => socket.off('audit:event', handler)
  }, [])

  return (
    <>
      <div className="page-header">
        <div className="page-header__left">
          <h1>Audit Log</h1>
          <p>Append-only record of every access lifecycle event.</p>
        </div>
        <div className="page-header__right">
          <span style={{ fontSize: 12, color: 'var(--text-subtle)', fontFamily: 'JetBrains Mono, monospace' }}>
            {events.length} events
          </span>
        </div>
      </div>

      <div className="page-body">
        {loading ? (
          <div className="state-loading"><span className="spinner" /> Loading audit log…</div>
        ) : events.length === 0 ? (
          <div className="state-empty">
            <span className="state-empty__icon">◷</span>
            <h3>No audit events yet</h3>
            <p>Submit an access request to see the full event trail here.</p>
          </div>
        ) : (
          <div className="audit-feed">
            {events.map((ev, i) => {
              const evId = ev.id ?? i
              const isNew = newIds.has(evId)
              return (
                <div
                  key={evId}
                  className={`audit-row${isNew ? ' audit-row--new' : ''}`}
                >
                  <span className="audit-time">{fmtTime(ev.timestamp ?? ev.created_at)}</span>
                  <span
                    className="audit-event"
                    style={{ color: EVENT_COLOR[ev.event] ?? 'var(--info)' }}
                  >
                    {ev.event}
                  </span>
                  <span className="audit-detail">
                    {ev.agent_id && <span>agent:{ev.agent_id.slice(0, 10)} · </span>}
                    {ev.service   && <span style={{ textTransform: 'capitalize' }}>{ev.service} · </span>}
                    {ev.scope?.length > 0 && <span>[{ev.scope.join(', ')}] · </span>}
                    {ev.detail ?? ''}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}
