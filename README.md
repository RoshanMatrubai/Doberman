# 🐕 GoldenRetriever · Scoped Access Broker for Agentic AI

> Companies don't hand their AI agents passwords. They hand them a scoped, expiring JWT — exactly the permissions the task needs, gone the moment the session ends.

GoldenRetriever sits between your AI agents and the third-party accounts they need. The agent requests access for a task; GoldenRetriever derives the minimum permission set, an admin approves, and the agent receives a short-lived Ed25519-signed JWT. Every grant is scoped, logged, and revocable.

---

## Quick Start

```bash
pip install -r requirements.txt

python main.py          # dashboard :5001 · agent API :5002
python main.py --mcp    # stdio MCP server for Claude Code
npm --prefix ui install && npm --prefix ui run dev   # frontend dev server
```

---

## Build Status

| Phase | What | Status |
|---|---|---|
| 1 | Scaffold — config, main, ui shell, package dirs | ✅ |
| 2 | Crypto primitives — Argon2id, AES-256-GCM, Ed25519, EdDSA JWT | ✅ |
| 3 | Encrypted vault — SQLite + AES-256-GCM, multi-tenant, secrets masked on read | ✅ |
| 4 | Policy engine — task→scope derivation, least-privilege, 5 service catalogs | ✅ |
| 5 | Request queue — AccessRequest dataclass, state machine, background expiry, rate limiting | ✅ |
| 6 | Agent REST API — POST /request, GET/DELETE /token/<id>, GET /pubkey on :5002 | ✅ |
| 7 | Dashboard backend — Flask+SocketIO, stable JSON API, real-time events | ✅ |
| 8 | Polished dashboard UI — approval cards, scope badges, accounts, audit feed, live SocketIO | ✅ |
| 9 | Token issuance — Ed25519 JWT, AES-GCM hint, verify/revoke/decrypt, wired to approve+revoke | ✅ |
| 10 | Full approval loop — approve→scope→JWT→UI live update→agent poll→revoke; `simulate_agent.py` | ✅ |
| 11 | Python SDK — `GoldenRetrieverClient`: `request_access`, `verify_token`, `revoke`, `get_session` | ✅ |
| 12 | MCP server — FastMCP stdio, `request_access` / `list_available_services` / `revoke_token` | ✅ |
| 13 | Audit log — append-only `audit_log` table, event constants, wired to all lifecycle points, live UI feed | ✅ |
| 14 | OAuth + headless auth — Google/GitHub OAuth flow, Playwright session login, per-service adapters, hint wired into approve | ✅ |
| 15 | Session lifecycle — session bind, `GET /agent/hint/<id>` one-time fetch, real `get_session()`, UI Sessions tab, auto-expiry, `POST /agent/action` scope enforcement | ✅ |
| 16 | Demo polish | 🔜 |

---

## Python SDK

```python
from agent.sdk import GoldenRetrieverClient, ApprovalDenied, ApprovalExpired, ApprovalTimeout, ScopeViolation

client = GoldenRetrieverClient(
    base_url="http://localhost:5002",
    tenant_id="my-tenant",
    agent_id="my-agent",
)

# Block until admin approves; raises ApprovalDenied / ApprovalExpired / ApprovalTimeout
token, request_id = client.request_access("amazon", "compare prices on 3 items")

# Verify signature + expiry using the server's Ed25519 public key (cached)
claims = client.verify_token(token, required_scope=["search"])

# Build an authenticated requests.Session with real credentials injected from the
# one-time hint (OAuth Bearer or cookie jar from headless session)
session = client.get_session(token, request_id=request_id)

# Check if an action is in scope (logs SCOPE_DENIED audit event on 403)
try:
    client.check_action(token, "purchase")
except ScopeViolation as exc:
    print("Blocked:", exc)

# Revoke when done
client.revoke(request_id)
```

---

## MCP Server (Claude Code integration)

```bash
# Terminal A — backend + dashboard
python main.py

# Terminal B — MCP server (stdio)
python main.py --mcp
# prints config snippet to paste into ~/.claude.json → mcpServers
```

The MCP server exposes three tools to the Claude CLI agent:

| Tool | Description |
|---|---|
| `request_access(service, task)` | Submit an access request; block until admin approves; return scoped JWT |
| `list_available_services()` | List services and their action catalogs |
| `revoke_token(request_id)` | Revoke an approved token or cancel a pending request |

All tools return structured dicts — never raise — so the agent always gets a readable response.

---

## Architecture

| Layer | Choice |
|---|---|
| KDF | Argon2id (m=65536, t=3, p=4) |
| Secret encryption | AES-256-GCM, random nonce per operation |
| Token format | Ed25519-signed JWT (`EdDSA`) with AES-GCM encrypted credential hint |
| Scope model | Per-request allow-list derived from agent task; embedded in signed claims |
| Service auth | OAuth 2.0 code flow (Google/GitHub via `authlib`) or Playwright headless login |
| Cookie cache | 6 h AES-GCM encrypted cookie cache for headless sessions |
| MCP | `fastmcp` stdio server — first-class Claude Code integration |
| Persistence | SQLite (`vault.db`) |

---

## Security Model

- Agents receive a **signed JWT** — never raw passwords, master vault keys, or OAuth secrets.
- The JWT `hint` is an AES-GCM blob decryptable only by the issuing server.
- Per-hint key = `HMAC(master_secret, request_id)` — derived at issue, never stored.
- Agents fetch the hint **once** via `GET /agent/hint/{id}` (consumed on first read; 410 on replay).
- Tokens are bound to a session; they auto-expire when `session_expires_at` is reached (background loop) or when the admin ends the session.
- Tokens expire at session end or TTL, whichever first — never renewable.
- Revocation checked on every use.
- Out-of-scope actions return 403 and log a `SCOPE_DENIED` audit event.

---

## Project Layout

```
config.py          — ports, paths, TTLs, service adapter stubs
main.py            — entry point (--mcp for MCP server)
core/              — crypto primitives, vault, token issuance
policy/            — task-to-scope engine (least-privilege derivation)
agent/             — REST API, SDK, MCP server
auth/              — OAuth flow and Playwright headless login
auth/adapters/     — per-service login adapters
dashboard/         — Flask + SocketIO backend + routes
audit/             — append-only audit log
ui/                — frontend dashboard (swappable design shell)
```

---

## Dashboard API Contract (stable — UI binds to these)

All routes on `:5001`. Agent API lives on `:5002`.

| Method | Path | Description |
|---|---|---|
| GET | `/api/status` | Health + pending count |
| GET | `/api/requests?state=PENDING` | Pending (or filtered) requests |
| GET | `/api/requests/all?limit=100` | All requests, newest first |
| POST | `/api/requests/<id>/approve` | Approve → resolves credential hint → issues scoped JWT; returns `{request, message, token}` |
| POST | `/api/requests/<id>/deny` | Deny a pending request |
| DELETE | `/api/requests/<id>` | Revoke an approved/pending request |
| GET | `/api/tenants` | List tenants |
| GET | `/api/accounts?tenant_id=<id>` | List service accounts for a tenant |
| GET | `/api/audit?limit=50&event=TOKEN_ISSUED&tenant_id=<id>` | Audit log, newest first; optional filters |
| GET | `/api/sessions` | List active sessions (APPROVED requests with live tokens) |
| POST | `/api/sessions/<id>/end` | End a live session — revokes token, logs `SESSION_ENDED` |
| GET | `/auth/oauth/<service>/begin?tenant_id=<id>` | Start OAuth flow — redirects to provider consent screen |
| GET | `/auth/callback` | OAuth callback — exchanges code, stores encrypted tokens in vault |

**Agent API (`:5002`):**

| Method | Path | Description |
|---|---|---|
| POST | `/agent/request` | Submit scoped access request |
| GET | `/agent/token/<id>` | Poll status (202/200/403/410) |
| DELETE | `/agent/token/<id>` | Cancel/revoke |
| GET | `/agent/pubkey` | Ed25519 public key |
| GET | `/agent/hint/<id>` | One-time credential hint (410 on replay) |
| POST | `/agent/action` | Scope enforcement check — 200/403 + `SCOPE_DENIED` audit |

**SocketIO events (server → client):**
- `request:new` — new pending request arrived `{"request": {...}}`
- `request:resolved` — approved, denied, or expired `{"request": {...}}`
- `token:revoked` — token explicitly revoked `{"request_id": "...", "state": "..."}`
- `session:started` — token issued for an approved request `{"request": {...}}`
- `session:ended` — session ended (TTL/admin/revoke) `{"request_id":"...","service":"...","agent_id":"...","reason":"..."}`
- `audit:event` — every lifecycle event `{event, tenant_id, agent_id, service, request_id, scope, detail, timestamp}`

---

## Demo Arc (90 seconds)

```
A: python main.py               # backend :5001/:5002
B: npm --prefix ui run dev      # UI
C: python simulate_agent.py     # agent smoke test (waits for admin to approve)

1. simulate_agent.py submits Amazon "compare prices" → scope=[search,read], NO purchase
2. Pending card appears live in the UI (Pending tab)
3. Admin clicks Approve → Sessions tab shows new live session with scope + TTL countdown
4. simulate_agent.py receives scoped JWT; fetches one-time hint → hint consumed (410 on replay)
5. In-scope: search → 200 OK  |  Out-of-scope: purchase → 403 + SCOPE_DENIED in audit feed
6. Admin clicks "End Session" → red banner in Sessions tab, SESSION_ENDED in audit
7. Subsequent token poll → 410 EXPIRED ✓
```

---

## License

MIT © 2026 Roshan Matrubai
