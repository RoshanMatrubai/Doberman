import { useState, useEffect } from 'react'
import { getTenants, getAccounts } from '../api'

const SVC_ICONS = { amazon:'🛒', google:'🔍', github:'🐱', slack:'💬', jira:'📋' }

export default function AccountsTile() {
  const [chips, setChips] = useState([])   // flat list of {tenant, service, username}
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getTenants()
      .then(async ({ tenants }) => {
        const all = []
        for (const t of (tenants ?? [])) {
          try {
            const { accounts } = await getAccounts(t.id)
            for (const a of (accounts ?? [])) {
              all.push({ tenant: t.name || t.id, service: a.service, username: a.username })
            }
          } catch { /* skip */ }
        }
        setChips(all)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  return (
    <>
      <div className="tile__header">
        <span className="tile__title">Connected Accounts</span>
        <span className="tile__count">{chips.length}</span>
      </div>
      <div className="tile__body tile__body--horizontal">
        {loading ? (
          <div className="state-loading" style={{ height:'auto', padding:0 }}>
            <span className="spinner"/>
          </div>
        ) : chips.length === 0 ? (
          <span style={{ fontSize:12.5, color:'var(--text-subtle)' }}>
            No service accounts configured yet.
          </span>
        ) : (
          chips.map((c, i) => (
            <div key={i} className="account-chip">
              <span className="account-chip__icon">{SVC_ICONS[c.service?.toLowerCase()] ?? '🔑'}</span>
              <div>
                <div className="account-chip__service">{c.service}</div>
                <div className="account-chip__user">{c.username}</div>
              </div>
            </div>
          ))
        )}
      </div>
    </>
  )
}
