function classify(action) {
  if (action === 'purchase' || action === 'delete') return 'destructive'
  if (action === 'write') return 'write'
  return 'read'
}

export function ScopeBadge({ action }) {
  const tier = classify(action)
  return <span className={`scope-badge scope-badge--${tier}`}>{action}</span>
}

export function ScopeList({ scope }) {
  if (!scope?.length) return <span className="badge badge--muted">no scope</span>
  return (
    <div className="scope-list">
      {scope.map(a => <ScopeBadge key={a} action={a} />)}
    </div>
  )
}
