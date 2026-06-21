import { useState, useEffect, useCallback, useRef } from 'react'
import { getPending, approve, deny } from '../api'
import { socket } from '../socket'
import { ScopeList } from './ScopeBadge'
import { useCursorGlow } from '../hooks'

const SVC_ICONS = { amazon:'🛒', google:'🔍', github:'🐱', slack:'💬', jira:'📋' }
const ALL_ACTIONS = ['search', 'read', 'write', 'purchase', 'delete']

function fmt(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', second:'2-digit' })
}

function ScopeEditor({ derived, value, onChange }) {
  return (
    <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginTop:6 }}>
      {ALL_ACTIONS.map(action => {
        const on = value.includes(action)
        const isDestructive = action === 'purchase' || action === 'delete'
        const isWrite = action === 'write'
        const color = isDestructive ? 'var(--danger)' : isWrite ? 'var(--warning)' : 'var(--info)'
        const dimColor = isDestructive ? 'rgba(239,68,68,0.1)' : isWrite ? 'rgba(245,158,11,0.1)' : 'rgba(129,140,248,0.1)'
        const wasInDerived = derived.includes(action)
        return (
          <button
            key={action}
            onClick={() => onChange(
              on ? value.filter(a => a !== action) : [...value, action]
            )}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '3px 10px', borderRadius: 5,
              fontFamily: 'JetBrains Mono, monospace', fontSize: 11, fontWeight: 600,
              cursor: 'pointer', transition: 'all 0.14s',
              background: on ? dimColor : 'rgba(255,255,255,0.03)',
              color: on ? color : 'var(--text-subtle)',
              border: `1px solid ${on
                ? (isDestructive ? 'rgba(239,68,68,0.35)' : isWrite ? 'rgba(245,158,11,0.35)' : 'rgba(129,140,248,0.35)')
                : 'rgba(255,255,255,0.08)'}`,
              opacity: on ? 1 : 0.55,
            }}
            title={wasInDerived ? 'Policy derived' : 'Not in derived scope'}
          >
            {on ? '✓' : '○'} {action}
            {wasInDerived && !on && <span style={{ fontSize:8, opacity:0.5 }}>policy</span>}
          </button>
        )
      })}
    </div>
  )
}

function PendingCard({ request: initial, onResolved }) {
  const [req, setReq]         = useState(initial)
  const [loading, setLoading] = useState(null)
  const [error, setError]     = useState(null)
  const [editing, setEditing] = useState(false)
  const [scopeDraft, setScopeDraft] = useState(initial.scope ?? [])
  const { ref, handleMouseMove } = useCursorGlow()
  const icon = SVC_ICONS[req.service?.toLowerCase()] ?? '🔑'

  async function handleApprove() {
    setLoading('approve')
    setError(null)
    try {
      const data = await approve(req.id, editing ? scopeDraft : undefined)
      const updated = data.request ?? { ...req, state: 'APPROVED' }
      setReq(updated)
      onResolved?.(updated)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(null)
    }
  }

  async function handleDeny() {
    setLoading('deny')
    setError(null)
    try {
      const data = await deny(req.id)
      const updated = data.request ?? { ...req, state: 'DENIED' }
      setReq(updated)
      onResolved?.(updated)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(null)
    }
  }

  const effectiveScope = editing ? scopeDraft : req.scope

  return (
    <div ref={ref} className="card card--PENDING" onMouseMove={handleMouseMove}>
      <div className="card__header">
        <div className="card__service">
          <span className="card__svc-icon">{icon}</span>
          <div>
            <div className="card__svc-name">{req.service}</div>
            <div className="card__svc-agent">agent:{req.agent_id?.slice(0,14)}</div>
          </div>
        </div>
        <div className="card__header-right">
          <span className="badge badge--warning">Pending</span>
        </div>
      </div>

      <div className="card__body">
        <div className="card__task">"{req.task}"</div>

        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:6 }}>
          <span className="card__scope-label" style={{ marginBottom:0 }}>
            {editing ? 'Edit Scope' : 'Derived Scope'}
          </span>
          <button
            onClick={() => { setEditing(e => !e); setScopeDraft(req.scope ?? []) }}
            style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px',
              fontSize: 10.5, fontWeight: 600,
              color: editing ? 'var(--accent-bright)' : 'var(--text-subtle)',
              transition: 'color 0.14s',
            }}
          >
            {editing ? '✕ cancel' : '✎ edit'}
          </button>
        </div>

        {editing
          ? <ScopeEditor derived={req.scope} value={scopeDraft} onChange={setScopeDraft} />
          : <ScopeList scope={req.scope} />
        }

        {editing && scopeDraft.length === 0 && (
          <div style={{ fontSize:11, color:'var(--warning)', marginTop:6 }}>
            ⚠ No scope selected — agent will receive an empty token.
          </div>
        )}

        <div className="card__meta">
          <div className="card__meta-item">
            <span className="card__meta-label">ID</span>
            <span className="card__meta-value">{req.id?.slice(0,12)}…</span>
          </div>
          <div className="card__meta-item">
            <span className="card__meta-label">Expires</span>
            <span className="card__meta-value">{fmt(req.expires_at)}</span>
          </div>
        </div>
        {error && <div style={{ marginTop:8, fontSize:11.5, color:'var(--danger)' }}>⚠ {error}</div>}
      </div>

      <div className="card__actions">
        <button className="btn btn--success" disabled={!!loading} onClick={handleApprove}>
          {loading === 'approve'
            ? <><span className="spinner"/>Approving…</>
            : editing
              ? `✓ Approve [${scopeDraft.join(', ') || 'empty'}]`
              : '✓ Approve'}
        </button>
        <button className="btn btn--danger" disabled={!!loading} onClick={handleDeny}>
          {loading === 'deny' ? <><span className="spinner"/>Denying…</> : '✕ Deny'}
        </button>
      </div>
    </div>
  )
}

export default function PendingTile({ onCountChange, onFlash }) {
  const [requests, setRequests] = useState([])
  const [loading, setLoading]   = useState(true)
  const [exiting, setExiting]   = useState(new Set())
  const tileRef = useRef(null)

  const load = useCallback(async () => {
    try {
      const data = await getPending()
      setRequests(data.requests ?? [])
      onCountChange?.(data.requests?.length ?? 0)
    } catch (e) {
      console.error('[PendingTile] load error', e)
    } finally {
      setLoading(false)
    }
  }, [onCountChange])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    function onNew({ request }) {
      setRequests(prev => prev.find(r => r.id === request.id) ? prev : [request, ...prev])
      onCountChange?.(c => c + 1)
      // Flash the tile border briefly
      tileRef.current?.classList.add('tile--flash-pending')
      setTimeout(() => tileRef.current?.classList.remove('tile--flash-pending'), 800)
    }
    function onResolved({ request }) {
      if (request.state === 'PENDING') return
      // exit animation, then remove
      setExiting(prev => new Set([...prev, request.id]))
      setTimeout(() => {
        setRequests(prev => prev.filter(r => r.id !== request.id))
        setExiting(prev => { const s = new Set(prev); s.delete(request.id); return s })
        onCountChange?.(c => Math.max(0, c - 1))
      }, 450)
    }
    socket.on('request:new',      onNew)
    socket.on('request:resolved', onResolved)
    socket.on('token:revoked',    onResolved)
    return () => {
      socket.off('request:new',      onNew)
      socket.off('request:resolved', onResolved)
      socket.off('token:revoked',    onResolved)
    }
  }, [onCountChange])

  function handleResolved(updated) {
    setExiting(prev => new Set([...prev, updated.id]))
    setTimeout(() => {
      setRequests(prev => prev.filter(r => r.id !== updated.id))
      setExiting(prev => { const s = new Set(prev); s.delete(updated.id); return s })
      onCountChange?.(c => Math.max(0, c - 1))
    }, 450)
  }

  return (
    <>
      <div className="tile__header">
        <span className="tile__title">Pending Approvals</span>
        <div className="tile__right">
          {requests.length > 0 && (
            <span className="tile__count" style={{ color:'var(--warning)' }}>{requests.length}</span>
          )}
          <button className="icon-btn" onClick={load} title="Refresh">↻</button>
        </div>
      </div>
      <div className="tile__body" ref={tileRef}>
        {loading ? (
          <div className="state-loading"><span className="spinner"/>Loading…</div>
        ) : requests.length === 0 ? (
          <div className="state-empty">
            <span className="state-empty__icon">○</span>
            <h3>Queue empty</h3>
            <p>Click "▶ Simulate Request" above to create one.</p>
          </div>
        ) : (
          requests.map(r => (
            <div key={r.id} className={`card-slot${exiting.has(r.id) ? ' card-slot--exit' : ''}`}>
              <PendingCard request={r} onResolved={handleResolved} />
            </div>
          ))
        )}
      </div>
    </>
  )
}
