import { useState } from 'react'
import { demoRequest } from '../api'

const SERVICES = [
  { id: 'amazon', label: '🛒 Amazon' },
  { id: 'google', label: '🔍 Google' },
  { id: 'github', label: '🐱 GitHub' },
  { id: 'slack',  label: '💬 Slack'  },
  { id: 'jira',   label: '📋 Jira'   },
]

export default function DemoControls() {
  const [service, setService] = useState('amazon')
  const [loading, setLoading] = useState(false)

  async function handleRequest() {
    setLoading(true)
    try { await demoRequest(service) }
    catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  return (
    <div className="demo-controls">
      <span className="demo-controls__label">Demo</span>

      <select
        className="demo-select"
        value={service}
        onChange={e => setService(e.target.value)}
        disabled={loading}
      >
        {SERVICES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
      </select>

      <button className="demo-btn demo-btn--neutral" onClick={handleRequest} disabled={loading}>
        {loading ? <><span className="spinner" /> Requesting…</> : '▶ Simulate Agent Request'}
      </button>
    </div>
  )
}
