# 🐕 GoldenRetriever · AI Agent Authenticator

> AI agents don't get your passwords. They ask. You decide. They get a token that expires.

Agent calls GoldenRetriever → user approves on the dashboard → agent gets a short-lived signed token (OAuth access token or headless-login session cookies), **never the raw password.**

---

## How It Works

1. An AI agent (Claude Code MCP, SDK, or REST) requests access to a service (e.g. Gmail).
2. A card appears on your dashboard with a 60-second countdown.
3. You click **Approve** or **Deny**.
4. On approval the agent receives an Ed25519-signed JWT whose encrypted `hint` payload contains the real OAuth token or session cookies.
5. The token expires in 15 minutes and is never renewable — agents re-request every time.

---

## Quick Start

```bash
pip install -r requirements.txt
playwright install chromium    # for headless login (Phase 13+)

python main.py                 # dashboard :5001 · agent API :5002
python main.py --mcp           # stdio MCP server for Claude Code
```

---

## Architecture

| Layer | Choice |
|---|---|
| KDF | Argon2id (m=65536, t=3, p=4) |
| Vault encryption | AES-256-GCM, random nonce per operation |
| Token format | Ed25519-signed JWT (`EdDSA`) with AES-GCM encrypted credential hint |
| OAuth | `authlib` auth-code flow, refresh token stored encrypted |
| Headless login | Playwright Chromium headless |
| Cookie cache | Encrypted `.auth_state/{service}.enc`, 6-hour freshness window |
| MCP | `fastmcp` stdio server |
| Persistence | SQLite (`vault.db`) |

---

## Security Model

- Agents receive a **signed JWT** — never raw passwords, master vault keys, OAuth secrets, or other users' tokens.
- The JWT `hint` is an AES-GCM blob decryptable only by the issuing server.
- Per-hint key = `HMAC(master_secret, request_id)` — derived at issue time, never stored.
- Agents fetch the hint **once** via `GET /agent/hint/{id}` (consumed on first read).
- Revocation checked on every poll and `verify_token()` call.

---

## Demo (90 seconds)

```
Terminal A:  python main.py
Terminal B:  python main.py --mcp
Terminal C:  python simulate_agent.py --service Gmail
```

1. `[C]` Requesting Gmail credentials…
2. Dashboard shows pending card with 60 s countdown
3. Click **Approve**
4. `[C]` ✅ Token received (exp 15 min)
5. `    ` 📬 Fetching inbox… 200 OK · 3 unread
6. Audit: `SUBMITTED → APPROVED → TOKEN_ISSUED → HINT_FETCHED`
7. Click **Revoke**
8. `[C]` next request: ❌ Token revoked — re-request required

---

## Status

| Phase | Description | Status |
|---|---|---|
| 1 | Scaffold | ✅ |
| 2 | Crypto primitives | 🔜 |
| 3 | Encrypted vault | 🔜 |
| 4 | Request queue | 🔜 |
| 5 | Agent REST API | 🔜 |
| 6 | Dashboard shell | 🔜 |
| 7 | Token issuance | 🔜 |
| 8 | Full approval loop | 🔜 |
| 9 | Python SDK | 🔜 |
| 10 | MCP server | 🔜 |
| 11 | Audit log | 🔜 |
| 12 | OAuth2 | 🔜 |
| 13 | Headless login | 🔜 |
| 14 | SDK get_session() wired | 🔜 |
| 15 | Demo polish | 🔜 |

---

MIT © 2026 Roshan Matrubai
