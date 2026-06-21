"""
Tests for agent/queue.py — access request state machine.
Run: pytest agent/test_queue.py -x
"""
import time

import pytest

from agent.queue import (
    AccessRequest,
    InvalidTransition,
    RateLimitExceeded,
    RequestNotFound,
    RequestQueue,
    RequestState,
)


@pytest.fixture
def queue(tmp_path):
    """Queue with short TTL and tight rate limit for fast tests."""
    q = RequestQueue(
        db_path=str(tmp_path / "test_requests.db"),
        ttl=2,
        rate_limit=3,
        rate_window=5,
        expiry_interval=1,
    )
    yield q
    q.stop()


# --- Submit ---

def test_submit_creates_pending_request(queue):
    req = queue.submit("t1", "agent1", "amazon", "compare prices on these 3 items")
    assert isinstance(req, AccessRequest)
    assert req.state == RequestState.PENDING
    assert req.id
    assert req.tenant_id == "t1"
    assert req.agent_id == "agent1"
    assert req.service == "amazon"
    assert req.resolved_at is None
    assert req.token_id is None


def test_submit_derives_scope_no_purchase(queue):
    req = queue.submit("t1", "agent1", "amazon", "compare prices on these 3 items")
    assert "search" in req.scope or "read" in req.scope
    assert "purchase" not in req.scope


def test_submit_unknown_service_gives_empty_scope(queue):
    req = queue.submit("t1", "agent1", "unknown_service", "do something")
    assert req.scope == []


def test_submit_persists_to_db(tmp_path):
    db = str(tmp_path / "persist.db")
    q1 = RequestQueue(db_path=db, ttl=30, rate_limit=10, rate_window=60)
    req = q1.submit("t1", "agent1", "amazon", "search for items")
    q1.stop()

    q2 = RequestQueue(db_path=db, ttl=30, rate_limit=10, rate_window=60)
    fetched = q2.get(req.id)
    assert fetched is not None
    assert fetched.id == req.id
    assert fetched.state == RequestState.PENDING
    q2.stop()


# --- Approve ---

def test_approve_transitions_to_approved(queue):
    req = queue.submit("t1", "agent1", "amazon", "find cheapest laptop")
    approved = queue.approve(req.id)
    assert approved.state == RequestState.APPROVED
    assert approved.resolved_at is not None


def test_approve_is_visible_via_get(queue):
    req = queue.submit("t1", "agent1", "amazon", "search items")
    queue.approve(req.id)
    fetched = queue.get(req.id)
    assert fetched.state == RequestState.APPROVED


def test_cannot_double_approve(queue):
    req = queue.submit("t1", "agent1", "amazon", "browse items")
    queue.approve(req.id)
    with pytest.raises(InvalidTransition):
        queue.approve(req.id)


# --- Deny ---

def test_deny_transitions_to_denied(queue):
    req = queue.submit("t1", "agent1", "github", "check open issues")
    denied = queue.deny(req.id)
    assert denied.state == RequestState.DENIED
    assert denied.resolved_at is not None


def test_cannot_deny_approved_request(queue):
    req = queue.submit("t1", "agent1", "amazon", "browse items")
    queue.approve(req.id)
    with pytest.raises(InvalidTransition):
        queue.deny(req.id)


def test_cannot_approve_denied_request(queue):
    req = queue.submit("t1", "agent1", "amazon", "browse items")
    queue.deny(req.id)
    with pytest.raises(InvalidTransition):
        queue.approve(req.id)


# --- Attach token ---

def test_attach_token_on_approved(queue):
    req = queue.submit("t1", "agent1", "amazon", "search for books")
    queue.approve(req.id)
    updated = queue.attach_token(req.id, "tok_abc123")
    assert updated.token_id == "tok_abc123"
    assert queue.get(req.id).token_id == "tok_abc123"


def test_cannot_attach_token_to_pending(queue):
    req = queue.submit("t1", "agent1", "amazon", "search prices")
    with pytest.raises(InvalidTransition):
        queue.attach_token(req.id, "tok_xyz")


def test_cannot_attach_token_to_denied(queue):
    req = queue.submit("t1", "agent1", "amazon", "search prices")
    queue.deny(req.id)
    with pytest.raises(InvalidTransition):
        queue.attach_token(req.id, "tok_xyz")


# --- Expire stale ---

def test_expire_stale_pending_past_ttl(queue):
    req = queue.submit("t1", "agent1", "amazon", "search for items")
    time.sleep(3)  # TTL is 2s; background thread or manual call will expire it
    queue.expire_stale()  # idempotent if background thread already ran
    assert queue.get(req.id).state == RequestState.EXPIRED


def test_expire_stale_does_not_touch_approved(queue):
    req = queue.submit("t1", "agent1", "amazon", "search for items")
    queue.approve(req.id)
    time.sleep(3)
    expired = queue.expire_stale()
    assert req.id not in expired
    assert queue.get(req.id).state == RequestState.APPROVED


def test_background_thread_auto_expires(queue):
    req = queue.submit("t1", "agent1", "amazon", "search items")
    time.sleep(4)  # TTL=2s, expiry_interval=1s — should auto-expire
    assert queue.get(req.id).state == RequestState.EXPIRED


# --- Rate limiting ---

def test_rate_limit_blocks_excess_requests(queue):
    for i in range(3):
        queue.submit("t1", "agent_limited", "amazon", f"search item {i}")
    with pytest.raises(RateLimitExceeded):
        queue.submit("t1", "agent_limited", "amazon", "one more search")


def test_rate_limit_is_per_agent(queue):
    for i in range(3):
        queue.submit("t1", "agent_a", "amazon", f"search {i}")
    req = queue.submit("t1", "agent_b", "amazon", "unrelated search")
    assert req.state == RequestState.PENDING


# --- Get / list ---

def test_get_returns_none_for_missing(queue):
    assert queue.get("nonexistent_id") is None


def test_get_raises_not_found_on_transition(queue):
    with pytest.raises(RequestNotFound):
        queue.approve("does_not_exist")


def test_list_pending_excludes_resolved(queue):
    r1 = queue.submit("t1", "agent1", "amazon", "compare prices")
    r2 = queue.submit("t1", "agent1", "amazon", "search items")
    r3 = queue.submit("t1", "agent1", "github", "read issues")
    queue.approve(r3.id)
    pending = queue.list_pending()
    ids = [r.id for r in pending]
    assert r1.id in ids
    assert r2.id in ids
    assert r3.id not in ids


def test_list_all_includes_all_states(queue):
    r1 = queue.submit("t1", "agent1", "amazon", "compare prices")
    r2 = queue.submit("t1", "agent1", "github", "search code")
    queue.approve(r2.id)
    all_reqs = queue.list_all()
    all_ids = [r.id for r in all_reqs]
    assert r1.id in all_ids
    assert r2.id in all_ids


def test_to_dict_serializes_cleanly(queue):
    req = queue.submit("t1", "agent1", "amazon", "search books")
    d = req.to_dict()
    assert d["state"] == "PENDING"
    assert isinstance(d["scope"], list)
    assert d["resolved_at"] is None
    assert d["token_id"] is None
