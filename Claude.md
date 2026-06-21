# 🐕 GoldenRetriever · AI Agent Authenticator
> AI agents don't get your passwords. They ask. You decide. They get a token that expires.

Agent calls GoldenRetriever → user approves on the dashboard → agent gets a short-lived signed token (OAuth access token or headless-login session cookies), never the raw password.
Personal-use paid product. Hackathon demo. Build in phase order, one phase at a time.

---

## STACK & COMMANDS
```
install:   pip install -r requirements.txt && playwright install chromium
run:       python main.py            # dashboard :5001, agent API :5002
mcp:       python main.py --mcp      # stdio MCP server for Claude Code
test:      pytest core/test_crypto.py -x
lint:      flake8 core/ agent/ auth/ dashboard/ audit/
```
**Never** run the full test suite. Single-file only.

---

## ARCHITECTURE (locked — do not deviate)
| Layer | Decision |
|---|---|
| KDF | Argon2id (m=65536, t=3, p=4) — NOT PBKDF2, NOT bcrypt |
| Vault encryption | AES-256-GCM, random nonce per op, stored in SQLite |
| Token format | Ed25519-signed JWT (`EdDSA`) with AES-GCM encrypted credential hint |
| OAuth | `authlib` auth-code flow, refresh token stored encrypted |
| Headless login | Playwright Chromium headless |
| Cookie cache | Encrypted `.auth_state/{service}.enc`, 6-hour freshness window |
| MCP | `fastmcp` stdio server |
| Persistence | SQLite (`vault.db`) for credentials, tokens, audit log |
| Request queue | In-memory + SQLite state machine; background expiry thread (5s) |

**Key files:** `config.py` · `core/crypto.py` · `core/vault.py` · `core/tokens.py` · `agent/queue.py` · `agent/api.py` · `agent/sdk.py` · `agent/mcp_server.py` · `auth/oauth.py` · `auth/session.py` · `auth/adapters/` · `dashboard/app.py` · `audit/log.py`

---

## TOKEN SECURITY MODEL
- Agents get a JWT signed by GoldenRetriever's Ed25519 identity key.
- Payload `hint` is an AES-GCM blob: `{type:"oauth", access_token, expires_in}` or `{type:"session", cookies:[...]}`.
- Per-hint key = `HMAC(master_secret, request_id)` — never stored. Agents fetch hint once via `GET /agent/hint/{id}` (consumed after first read).
- Revocation checked on every token poll + `verify_token()`. TTL = `TOKEN_TTL_SECONDS` (900s), never renewable — always re-request.
- Agents NEVER receive: raw passwords, master vault key, OAuth client secrets, other users' tokens.

**Request states:** `PENDING → APPROVED | DENIED | EXPIRED`; APPROVED → token issued → JWT; revoked → 410 Gone. Transitions in `agent/queue.py`; driven from dashboard approve/deny routes.

---

## BUILD PLAN (build in this order — one phase at a time)
Build bottom-up. Each phase leaves the repo importable and runnable. Restate the phase goal in one line first. **Recommend `/clear` between phases.**

1. **Scaffold** — `config.py` (ports, `DB_PATH`, `TOKEN_TTL_SECONDS=900`, `REQUEST_TTL_SECONDS=60`, `SITE_ADAPTERS` stub), `main.py` (`--mcp` flag, prints startup line, clean imports), `requirements.txt` (`flask flask-socketio cryptography argon2-cffi PyJWT pytest flake8`), `.gitignore`, `LICENSE` (MIT 2026), `README.md`, package dirs + `__init__.py` (`core/ agent/ auth/ auth/adapters/ dashboard/ audit/`). → `chore: scaffold GoldenRetriever project structure and entry point`
2. **Crypto** — `core/crypto.py`: Argon2id, AES-GCM (nonce prepended), Ed25519 (keygen/sign/verify/to-from-bytes), `encode/decode_jwt` (EdDSA), `derive_hint_key` (HMAC-SHA256), `random_id` (16 hex). `core/test_crypto.py` (use m=256). → `feat: crypto primitives (Argon2id, AES-GCM, Ed25519, JWT)`
3. **Vault** — `core/vault.py`: SQLite `vault_meta` / `credentials` / `revoked_tokens`; create/unlock (Argon2id VSK), add/get/find/list (masked)/delete credential, add/check revoked token. `extra` holds OAuth config. `core/test_vault.py`. → `feat: encrypted credential vault (SQLite + AES-256-GCM)`
4. **Request Queue** — `agent/queue.py`: `AuthRequest` dataclass, `RequestQueue` (submit/approve/deny/attach_token/get/list_pending/expire_stale/pending_count_for), background expiry thread (5s). `agent/test_queue.py`. → `feat: auth request queue with state machine and auto-expiry`
5. **Agent REST API** — `agent/api.py` Blueprint `/agent`: `POST /request` (400/429/202), `GET /token/{id}` (200/202/403/410/404), `DELETE /token/{id}`, `GET /pubkey`. Rate limit 5 pending/agent. `agent/test_api.py`. → `feat: agent REST API (request, poll, revoke, pubkey)`
6. **Dashboard Shell** — `dashboard/app.py` Flask+SocketIO (`async_mode="threading"`): `init_app`, routes `/ /status /credentials /requests /audit`; emits `request:new` / `request:resolved` / `token:revoked`. `index.html`: pending/credentials/tokens/audit panels, live countdowns, SocketIO-only updates. → `feat: dashboard shell with credential manager and real-time request feed`
7. **Token Issuance** — `core/tokens.py`: load/create Ed25519 identity (`TOKEN_KEY_FILE`), `get_public_key_hex`, `issue_token` (encrypt hint, sign JWT), `verify_token` (sig+expiry+revocation), `decrypt_hint`. Wire into API token/revoke/pubkey. `core/test_tokens.py`. → `feat: Ed25519 JWT token issuance, verification, and revocation`
8. **Full Approval Loop** — `dashboard/app.py`: `POST /requests/{id}/approve` (find credential → issue_token hint={} → approve+attach → emit `request:resolved`), `/deny`. Wire buttons. Smoke test `simulate_agent.py`. → `feat: wire full approval loop (dashboard approve → JWT → polling agent)`
9. **Python SDK** — `agent/sdk.py` `GoldenRetrieverClient`: `request_token` (poll 2s), `verify_token` (cached pubkey), `revoke`, `get_session` (oauth→Bearer / session→cookie jar / empty→plain). Exceptions `ApprovalDenied/Expired/Timeout`. `agent/test_sdk.py`. → `feat: GoldenRetrieverClient SDK with get_session() and error types`
10. **MCP Server** — `agent/mcp_server.py` FastMCP: `request_credentials` (blocks, returns dict, never raises), `list_available_services`, `revoke_token`. `main.py --mcp` launches it + prints config snippet. Add `fastmcp`. → `feat: MCP server for Claude Code (request_credentials, list_available_services, revoke_token)`
11. **Audit Log** — `audit/log.py`: `audit_log` table, event constants, `log_event` / `get_recent` / `get_by_agent` / `get_by_service`. Wire into submit/approve/deny/expire/issue/revoke. `GET /audit` + dashboard panel. → `feat: append-only audit log wired to all credential lifecycle events`
12. **OAuth2** — `auth/oauth.py`: `OAuthAdapter` base, `GoogleOAuth` / `GitHubOAuth` (authorization_url/exchange_code/refresh). `config.OAUTH_SERVICES` + `OAUTH_REDIRECT_URI`. Routes `/auth/oauth/{service}` + `/auth/callback`. Approve route uses/refreshes tokens → hint type oauth. Add `authlib requests`. → `feat: OAuth2 flow for Google and GitHub (real access tokens in JWT hint)`
13. **Headless Login** — `auth/session.py`: `headless_login` (async Playwright), `get_or_refresh_session` (6h cache), `sync_headless_login`. Adapters `generic` / `google` / `github` (raise `TwoFactorRequired` / `LoginFailed`). `config.SITE_ADAPTERS`. Approve route (non-OAuth) → cookies → hint type session. Add `playwright`. → `feat: Playwright headless login with Google, GitHub, and generic form adapters`
14. **SDK get_session() wired** — `GET /agent/hint/{id}` returns decrypted hint once (then 410, `hint_consumed`), logs `TOKEN_HINT_FETCHED`. `get_session` builds real OAuth/session session. → `feat: SDK get_session() wired to real OAuth tokens and session cookies`
15. **Demo Polish** — `simulate_agent.py` (`--service`, `--mode sdk|mcp`, graceful errors), `DEMO.md` (3-terminal, Act I/II/III), `README.md` final. → `feat: demo polish, simulate_agent.py final form, complete DEMO.md and README`

---

## LIVING DOCS (update each phase before the commit block)
- **README.md** — new features, updated layout.
- **requirements.txt** — append new deps only (never pre-add).
- **.gitignore** — new runtime artifacts.
- **config.py** — new keys near related ones, short comment.
> Rule: if the phase changed how someone installs, runs, or demos, the docs change in the same phase.

---

## GIT / COMMITS
- **NEVER run git or commit automatically.** The human commits.
- End each phase by printing a ready-to-paste block:
  ```
  ✅ PHASE <n> COMPLETE — ready to commit
    git add <exact files — never -A or .>
    git commit -m "<type>: <message>"
  Suggested: /clear before Phase <n+1>.
  ```
- Conventional commits: `chore feat fix docs test refactor`.
- Never stage `vault.db`, `.auth_state/`, `.gr_identity*`, `*.key`.

---

## ANTI-PATTERNS (never do these)
- ❌ Sending raw passwords to agents — tokens only.
- ❌ Logging passwords anywhere (audit logs agent_id + service, never credentials).
- ❌ Storing plaintext credentials, OAuth tokens, or cookies — always AES-GCM encrypted.
- ❌ Auto-approving requests — every approval is explicit user action.
- ❌ Silent try/except — fail loudly to console + dashboard.
- ❌ Running git / `git add -A` / `git add .`.
- ❌ Pre-adding deps before they're used.
- ❌ Renewable tokens — always re-request.
- ❌ Abstractions/refactors not required for the demo.
- ❌ Full test-suite runs — single-file only.

---

## MOCKS (flag every one with `# MOCK`)
- OAuth app credentials (placeholder client_id/secret; flow is real once filled).
- Argon2id timing in tests (m=256).
- License/payment gate (`POST /license` for demo only).
- 2FA — raise `TwoFactorRequired`, surface it; don't intercept OTPs.
- Bark key (build-completion ping only, not a product feature; prints to console if empty).

---

## DEMO ARC (happy path — practice to 90s)
```
A: python main.py            # dashboard :5001
B: python main.py --mcp      # MCP server
C: python simulate_agent.py --service Gmail
1. [C] Requesting Gmail credentials…
2. Dashboard shows pending card with 60s countdown
3. Click Approve
4. [C] ✅ Token received (exp 15 min)
5.     📬 Fetching inbox… 200 OK · 3 unread
6. Audit: SUBMITTED → APPROVED → TOKEN_ISSUED → HINT_FETCHED
7. Click Revoke
8. [C] next request: ❌ Token revoked — re-request required
```
The demo is the pitch: **agents ask, users decide, passwords never leave the vault.**

---

## MILESTONES & NOTIFICATIONS
The Bark `curl` below is a **Claude Code build-completion ping to my phone** — it is NOT a product feature (GoldenRetriever itself has no phone notifications; the dashboard is how requests are noticed). Key milestones: Phase 3, 5, 8, 10, 13, 15. On each, run:
```bash
curl -s "https://api.day.app/Ty6uAVeqkSq5D2u35yMotQ/Alert%20Sound/[URL_ENCODED_MESSAGE]?sound=birdsong"
```
Then print:
```
=== 🐕 MILESTONE COMPLETE - READY FOR REVIEW 🐕 ===
DONE: [what was built]
DOCS: [README/reqs/.gitignore/config updated? Y/N]
NEXT: [immediate next step]
FILES: [files touched]
CREDS_EXPOSED?: [touched plaintext passwords? must be N]
```

---

## WORKFLOW
1. Restate the phase goal in one line before starting.
2. Build in order — one phase at a time, each importable/runnable.
3. Edit existing files; create new only when none fits.
4. Hardcode config in `config.py`. No `.env`.
5. Throw visible errors to console + dashboard. No silent try/except.
6. Raw passwords never leave `core/vault.py` — every other layer uses VSK/tokens/hints.
7. Update living docs before each commit block.
8. Ask before: deleting files, adding packages, schema changes, OAuth app registration.
9. Code like a lazy senior dev — no abstractions until needed twice.

## CONTEXT HYGIENE
- Append to every reply: `CTX: <low|med|HIGH>`
- If HIGH or repeated tool errors → output: `⚠️ Run /clear now`
- Use /compact every ~40 exchanges
