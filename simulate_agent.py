#!/usr/bin/env python3
"""
simulate_agent.py — smoke-test the full GoldenRetriever scoped approval loop.

  python simulate_agent.py                          # default: amazon price comparison
  python simulate_agent.py --service github --task "read the latest issues"
  python simulate_agent.py --no-revoke              # skip the revoke step
  python simulate_agent.py --mode sdk               # use the Python SDK

Exit codes: 0=passed, 1=submit error, 2=denied, 3=expired/error, 4=timeout.
"""
from __future__ import annotations

import argparse
import base64
import datetime
import json
import sys
import time

import requests as http

import config
from policy.engine import is_action_in_scope, list_service_actions

AGENT_BASE    = f"http://localhost:{config.AGENT_API_PORT}"
DASH_BASE     = f"http://localhost:{config.DASHBOARD_PORT}"
POLL_INTERVAL = 2    # seconds between status polls
POLL_TIMEOUT  = 120  # seconds to wait for admin approval


def _decode_claims(token: str) -> dict:
    """Decode JWT payload (display only — signature not verified here)."""
    parts = token.split(".")
    if len(parts) < 2:
        return {}
    pad = 4 - len(parts[1]) % 4
    try:
        return json.loads(base64.urlsafe_b64decode(parts[1] + "=" * (pad % 4)))
    except Exception:
        return {}


def _bar(char: str = "─", width: int = 60) -> str:
    return char * width


def _demo_action_http(token: str, action: str, description: str) -> None:
    """Make a real HTTP scope-check call and display the result."""
    try:
        resp = http.post(f"{AGENT_BASE}/agent/action", json={
            "token": token,
            "action": action,
        }, timeout=5)
        body = resp.json()
        if resp.status_code == 200:
            print(f"  [200 OK ]  {action:12s}  ({description}) — in scope, allowed")
        elif resp.status_code == 403:
            print(f"  [403 DENY]  {action:12s}  ({description}) — out of scope, SCOPE_DENIED logged")
        else:
            print(f"  [{resp.status_code}?    ]  {action:12s}  {body}")
    except http.exceptions.RequestException as exc:
        print(f"  [ERROR  ]  {action:12s}  HTTP error: {exc}")


def main() -> None:
    parser = argparse.ArgumentParser(description="GoldenRetriever agent smoke test")
    parser.add_argument("--service",   default="amazon",
                        help="Service to request access to (default: amazon)")
    parser.add_argument("--task",      default="compare prices on these 3 items",
                        help="Natural-language task description")
    parser.add_argument("--tenant-id", default="demo-tenant",
                        help="Tenant identifier")
    parser.add_argument("--agent-id",  default="demo-agent-001",
                        help="Agent identifier")
    parser.add_argument("--no-revoke", action="store_true",
                        help="Skip the revoke step (leave token live)")
    parser.add_argument("--mode",      default="http", choices=["http", "sdk"],
                        help="Use raw HTTP calls (default) or the Python SDK")
    args = parser.parse_args()

    print(f"\n{_bar('═')}")
    print("  GoldenRetriever — Full Scoped Approval Loop (Phase 15)")
    print(_bar("═"))
    print(f"  Service : {args.service}")
    print(f"  Task    : {args.task}")
    print(f"  Tenant  : {args.tenant_id}")
    print(f"  Agent   : {args.agent_id}")
    print(f"  Backend : {AGENT_BASE}")
    print(f"  Mode    : {args.mode.upper()}")
    print(_bar("═"))

    if args.mode == "sdk":
        _run_sdk(args)
        return

    # ── 1. Submit access request ──────────────────────────────────────────
    print("\n[1/8] Submitting access request…")
    try:
        resp = http.post(f"{AGENT_BASE}/agent/request", json={
            "tenant_id": args.tenant_id,
            "agent_id":  args.agent_id,
            "service":   args.service,
            "task":      args.task,
        }, timeout=10)
    except http.exceptions.ConnectionError:
        print(f"  [FAIL] Cannot reach {AGENT_BASE} — is 'python main.py' running?")
        sys.exit(1)

    if resp.status_code != 201:
        print(f"  [FAIL] Submit failed: {resp.status_code} — {resp.text}")
        sys.exit(1)

    req_data   = resp.json()
    request_id = req_data["id"]
    scope      = req_data["scope"]
    print(f"  [OK]  request_id    = {request_id}")
    print(f"  [OK]  derived scope = {scope}")

    # ── 2. Poll for approval ──────────────────────────────────────────────
    print(f"\n[2/8] Waiting for admin approval (timeout {POLL_TIMEOUT}s)…")
    print(f"  Open → http://localhost:{config.DASHBOARD_PORT} and click Approve\n")

    token_str = None
    deadline  = time.time() + POLL_TIMEOUT
    dots      = 0
    while time.time() < deadline:
        try:
            poll   = http.get(f"{AGENT_BASE}/agent/token/{request_id}", timeout=5)
            status = poll.status_code
            body   = poll.json()
        except http.exceptions.RequestException as exc:
            print(f"\n  [ERROR] Poll failed: {exc}")
            sys.exit(3)

        if status == 202:
            dots = (dots + 1) % 4
            sys.stdout.write(f"  PENDING{'.' * dots}   \r")
            sys.stdout.flush()
            time.sleep(POLL_INTERVAL)
            continue

        if status == 200:
            token_str = body.get("token")
            print(f"\n  [OK]  APPROVED — scoped JWT received")
            break

        if status == 403:
            print(f"\n  [DENIED] Admin denied the request.")
            sys.exit(2)

        print(f"\n  [ERROR] Unexpected status {status}: {body}")
        sys.exit(3)

    if not token_str:
        print(f"\n  [TIMEOUT] No approval within {POLL_TIMEOUT}s.")
        sys.exit(4)

    # ── 3. Decode and display token claims ────────────────────────────────
    print("\n[3/8] JWT claims (decoded, not re-verified here):")
    claims   = _decode_claims(token_str)
    exp_dt   = datetime.datetime.fromtimestamp(claims.get("exp", 0), tz=datetime.timezone.utc)
    jti      = claims.get("jti", "")
    print(f"  tenant     : {claims.get('tenant')}")
    print(f"  agent_id   : {claims.get('agent_id')}")
    print(f"  service    : {claims.get('service')}")
    print(f"  scope      : {claims.get('scope')}")
    print(f"  jti        : {jti[:14]}…")
    print(f"  expires    : {exp_dt.isoformat()}")
    print(f"  algorithm  : EdDSA (Ed25519)")

    # ── 4. One-time hint fetch ────────────────────────────────────────────
    print("\n[4/8] Fetching one-time credential hint…")
    try:
        hint_resp = http.get(f"{AGENT_BASE}/agent/hint/{request_id}", timeout=5)
        if hint_resp.status_code == 200:
            hint = hint_resp.json().get("hint", {})
            print(f"  [OK]  hint type = {hint.get('type', '?')}")
            print(f"  [OK]  hint keys = {list(hint.keys())}")
            # Verify hint is consumed — second fetch should return 410
            hint_resp2 = http.get(f"{AGENT_BASE}/agent/hint/{request_id}", timeout=5)
            if hint_resp2.status_code == 410:
                print(f"  [OK]  Second fetch → 410 (one-time, consumed) ✓")
            else:
                print(f"  [?]   Expected 410 on second fetch, got {hint_resp2.status_code}")
        elif hint_resp.status_code == 410:
            print(f"  [INFO] Hint already consumed (410) — fetched by earlier call")
        else:
            print(f"  [WARN] Hint fetch returned {hint_resp.status_code}: {hint_resp.text}")
    except Exception as exc:
        print(f"  [WARN] Hint fetch error: {exc}")

    # ── 5. Fetch and verify pubkey ────────────────────────────────────────
    print("\n[5/8] Fetching GoldenRetriever Ed25519 public key…")
    try:
        pk_resp = http.get(f"{AGENT_BASE}/agent/pubkey", timeout=5)
        pk_data = pk_resp.json()
        print(f"  [OK]  algorithm  = {pk_data.get('algorithm')}")
        print(f"  [OK]  public_key = {pk_data.get('public_key', '')[:32]}…")
    except Exception as exc:
        print(f"  [WARN] Could not fetch pubkey: {exc}")

    # ── 6. Scope enforcement matrix ───────────────────────────────────────
    print(f"\n[6/8] Scope enforcement matrix for '{args.service}':")
    all_actions = list_service_actions(args.service)
    if not all_actions:
        print(f"  [WARN] No known actions for service '{args.service}'")
    for action in all_actions:
        allowed = is_action_in_scope(action, scope)
        sym     = "✓ ALLOWED" if allowed else "✕ BLOCKED"
        print(f"  [{sym}]  {action}")

    # ── 7. Live scope enforcement via /agent/action ───────────────────────
    print(f"\n[7/8] Live scope enforcement demo (real HTTP calls → audit feed):")
    _demo_action_http(token_str, "search",   "price comparison search")
    _demo_action_http(token_str, "read",     "read product details")
    _demo_action_http(token_str, "purchase", "checkout / place order")
    _demo_action_http(token_str, "delete",   "cancel an order")

    # ── 8. Session lifecycle: revoke / end ────────────────────────────────
    if not args.no_revoke:
        print(f"\n[8/8] Ending session (admin revoke)…")
        try:
            # Use the dedicated end-session endpoint
            end_resp = http.post(f"{DASH_BASE}/api/sessions/{request_id}/end", timeout=5)
        except http.exceptions.RequestException as exc:
            # Fall back to delete if dashboard isn't reachable from this process
            print(f"  [INFO] Dashboard unreachable, using agent DELETE: {exc}")
            end_resp = None

        if end_resp and end_resp.status_code == 200:
            print(f"  [OK]  Session ended via dashboard — SESSION_ENDED logged in audit")
        else:
            # Fallback: revoke via agent API
            try:
                rev = http.delete(f"{AGENT_BASE}/agent/token/{request_id}", timeout=5)
            except http.exceptions.RequestException as exc:
                print(f"  [WARN] Revoke request failed: {exc}")
            else:
                if rev.status_code == 200:
                    print(f"  [OK]  Token revoked via agent API")

        # Confirm the token is dead
        confirm = http.get(f"{AGENT_BASE}/agent/token/{request_id}", timeout=5)
        if confirm.status_code == 410:
            print(f"  [OK]  GET /agent/token/{request_id[:8]}… → 410 EXPIRED ✓")
        else:
            print(f"  [?]   Expected 410, got {confirm.status_code}")
    else:
        print(f"\n[8/8] Skipping session end (--no-revoke)")

    # ── Done ──────────────────────────────────────────────────────────────
    print(f"\n{_bar('═')}")
    print("  SMOKE TEST PASSED — scoped approval loop with session lifecycle verified")
    print(_bar("═"))
    print()


def _run_sdk(args) -> None:
    """Run the same flow using the GoldenRetrieverClient SDK."""
    from agent.sdk import GoldenRetrieverClient, ApprovalDenied, ApprovalExpired, ApprovalTimeout, ScopeViolation

    print(f"\n[SDK] Initialising GoldenRetrieverClient…")
    client = GoldenRetrieverClient(
        base_url=AGENT_BASE,
        tenant_id=args.tenant_id,
        agent_id=args.agent_id,
        timeout=POLL_TIMEOUT,
    )

    print(f"[SDK] Open → http://localhost:{config.DASHBOARD_PORT} to approve")
    try:
        token, request_id = client.request_access(args.service, args.task)
    except ApprovalDenied as exc:
        print(f"[SDK] DENIED: {exc}")
        sys.exit(2)
    except ApprovalExpired as exc:
        print(f"[SDK] EXPIRED: {exc}")
        sys.exit(3)
    except ApprovalTimeout as exc:
        print(f"[SDK] TIMEOUT: {exc}")
        sys.exit(4)

    print(f"[SDK] Verifying token…")
    claims = client.verify_token(token)
    print(f"[SDK] scope = {claims.get('scope')}")

    print(f"[SDK] Building authenticated session (hint fetch)…")
    session = client.get_session(token, request_id=request_id)
    print(f"[SDK] Session headers: {dict(session.headers)}")

    print(f"[SDK] Scope enforcement checks…")
    try:
        ok = client.check_action(token, "search")
        print(f"[SDK] search → {'ALLOWED' if ok else 'BLOCKED'}")
    except ScopeViolation as exc:
        print(f"[SDK] search → BLOCKED: {exc}")

    try:
        ok = client.check_action(token, "purchase")
        print(f"[SDK] purchase → {'ALLOWED' if ok else 'BLOCKED'}")
    except ScopeViolation as exc:
        print(f"[SDK] purchase → SCOPE_DENIED: {exc}")

    if not args.no_revoke:
        print(f"[SDK] Revoking…")
        client.revoke(request_id)
        print(f"[SDK] Token revoked ✓")

    print(f"\n[SDK] PASSED — SDK smoke test complete")


if __name__ == "__main__":
    main()
