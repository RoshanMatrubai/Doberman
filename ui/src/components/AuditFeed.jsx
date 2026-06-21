import { useState, useEffect } from 'react'
import { getAudit } from '../api'
import { socket } from '../socket'

function fmtTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

const EVENT_COLORS = {
  TOKEN_ISSUED:   'var(--success)',
  TOKEN_REVOKED:  'var(--danger)',
  APPROVED:       'var(--success)',
  DENIED:         'var(--danger)',
  EXPIRED:        'var(--text-subtle)',
  SCOPE_DERIVED:  'var(--info)',
  SCOPE_DENIED:   'var(--danger)',
  SESSION_ENDED:  'var(--warning)',
  SUBMITTED:      'var(--accent)',
}

export default function AuditFeed() {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)

  // Initial load
  useEffect(() => {
    getAudit(100)
      .then(d => setEvents(d.events ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  // Live updates via SocketIO
  useEffect(() => {
    const handler = (ev) => {
      setEvents(prev => [ev, ...prev].slice(0, 500))
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
      </div>

      <div className="page-body">
        {loading ? (
          <div className="state-loading"><span className="spinner" /> Loading audit log…</div>
        ) : events.length === 0 ? (
          <div className="state-empty">
            <span className="state-empty__icon">📋</span>
            <h3>No audit events yet</h3>
            <p>Submit an access request to see the full event trail here.</p>
          </div>
        ) : (
          <div className="card">
            {events.map((ev, i) => (
              <div key={ev.id ?? i} className="audit-row">
                <span className="audit-time">{fmtTime(ev.timestamp ?? ev.created_at)}</span>
                <span className="audit-event" style={{ color: EVENT_COLORS[ev.event] ?? 'var(--info)' }}>
                  {ev.event}
                </span>
                <span className="audit-detail">
                  {ev.agent_id && <span>agent:{ev.agent_id?.slice(0, 10)} · </span>}
                  {ev.service && <span>{ev.service} · </span>}
                  {ev.detail ?? ''}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
