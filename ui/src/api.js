// All dashboard API calls — vite proxies /api → http://localhost:5001

async function _fetch(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
  return json
}

export const getStatus       = ()          => _fetch('/api/status')
export const getPending      = ()          => _fetch('/api/requests?state=PENDING')
export const getAllRequests   = (limit=100) => _fetch(`/api/requests/all?limit=${limit}`)
export const approve         = (id, scope) => _fetch(`/api/requests/${id}/approve`, {
  method: 'POST',
  body: scope ? JSON.stringify({ scope }) : undefined,
})
export const deny            = (id)        => _fetch(`/api/requests/${id}/deny`,    { method: 'POST' })
export const revoke          = (id)        => _fetch(`/api/requests/${id}`,         { method: 'DELETE' })
export const getTenants      = ()          => _fetch('/api/tenants')
export const getAccounts     = (tenantId)  => _fetch(`/api/accounts?tenant_id=${tenantId}`)
export const getAudit        = (limit=50)  => _fetch(`/api/audit?limit=${limit}`)
export const getSessions     = ()          => _fetch('/api/sessions')
export const endSession      = (id)        => _fetch(`/api/sessions/${id}/end`, { method: 'POST' })

// Demo triggers — UI-driven simulation, no terminal needed
export const demoRequest = (service, task) =>
  _fetch('/api/demo/request', {
    method: 'POST',
    body: JSON.stringify({ service, task }),
  })

// demoAction returns body even on 403 (expected for blocked actions)
export const demoAction = async (action, requestId) => {
  const res = await fetch('/api/demo/action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, request_id: requestId }),
  })
  return res.json()
}
