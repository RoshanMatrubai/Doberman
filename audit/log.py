"""
Append-only audit log — every access lifecycle event in one place.

Events are written to the `audit_log` table in the same SQLite DB as the
vault and request queue.  Never raises — failures print to console.

Usage:
    from audit.log import log_event, get_recent
    import audit.log as audit_events

    log_event(audit_events.SUBMITTED, tenant_id=..., agent_id=..., service=..., request_id=...)
"""
from __future__ import annotations

import datetime
import json
import sqlite3
import threading

import config

# ── Event constants ──────────────────────────────────────────────────────────
SUBMITTED    = "SUBMITTED"
SCOPE_DERIVED = "SCOPE_DERIVED"
APPROVED     = "APPROVED"
DENIED       = "DENIED"
EXPIRED      = "EXPIRED"
TOKEN_ISSUED  = "TOKEN_ISSUED"
TOKEN_REVOKED = "TOKEN_REVOKED"
SCOPE_DENIED  = "SCOPE_DENIED"
SESSION_ENDED = "SESSION_ENDED"

_lock = threading.Lock()
_conn: sqlite3.Connection | None = None
_emit_hook = None  # optional fn(event_name: str, data: dict)


def set_emit_hook(fn) -> None:
    """Register a callback to broadcast each audit event over SocketIO."""
    global _emit_hook
    _emit_hook = fn


def _get_conn() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        with _lock:
            if _conn is None:
                c = sqlite3.connect(config.DB_PATH, check_same_thread=False)
                c.row_factory = sqlite3.Row
                c.execute("PRAGMA journal_mode=WAL")
                _init_schema(c)
                _conn = c
    return _conn


def _init_schema(conn: sqlite3.Connection) -> None:
    conn.execute("""
        CREATE TABLE IF NOT EXISTS audit_log (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            event      TEXT    NOT NULL,
            tenant_id  TEXT,
            agent_id   TEXT,
            service    TEXT,
            request_id TEXT,
            scope      TEXT,
            detail     TEXT,
            timestamp  TEXT    NOT NULL
        )
    """)
    conn.commit()


def log_event(
    event: str,
    *,
    tenant_id: str | None = None,
    agent_id: str | None = None,
    service: str | None = None,
    request_id: str | None = None,
    scope: list | None = None,
    detail: str | None = None,
) -> None:
    """Append one event to the audit log. Never raises."""
    ts = datetime.datetime.now(datetime.UTC).isoformat()
    scope_str = json.dumps(scope) if scope is not None else None

    try:
        conn = _get_conn()
        with _lock:
            conn.execute(
                """INSERT INTO audit_log
                   (event, tenant_id, agent_id, service, request_id, scope, detail, timestamp)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (event, tenant_id, agent_id, service, request_id, scope_str, detail, ts),
            )
            conn.commit()
    except Exception as exc:
        print(f"[audit] log_event error: {exc}", flush=True)

    if _emit_hook is not None:
        try:
            _emit_hook("audit:event", {
                "event":      event,
                "tenant_id":  tenant_id,
                "agent_id":   agent_id,
                "service":    service,
                "request_id": request_id,
                "scope":      scope,
                "detail":     detail,
                "timestamp":  ts,
            })
        except Exception as exc:
            print(f"[audit] emit hook error: {exc}", flush=True)


def get_recent(
    limit: int = 50,
    *,
    event_filter: str | None = None,
    tenant_id: str | None = None,
) -> list[dict]:
    """Return recent audit events, newest first. Never raises."""
    try:
        conn = _get_conn()
        params: list = []
        clauses: list[str] = []
        if event_filter:
            clauses.append("event = ?")
            params.append(event_filter)
        if tenant_id:
            clauses.append("tenant_id = ?")
            params.append(tenant_id)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        params.append(min(limit, 500))
        rows = conn.execute(
            f"SELECT * FROM audit_log {where} ORDER BY id DESC LIMIT ?", params
        ).fetchall()
        result = []
        for row in rows:
            r = dict(row)
            if r.get("scope"):
                try:
                    r["scope"] = json.loads(r["scope"])
                except Exception:
                    pass
            result.append(r)
        return result
    except Exception as exc:
        print(f"[audit] get_recent error: {exc}", flush=True)
        return []
