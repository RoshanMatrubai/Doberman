"""
Tests for core/tokens.py — Ed25519 JWT issuance, verification, and hint decryption.
Uses a temporary key file and a fresh temp vault per test.
"""
import datetime

import pytest

import config


@pytest.fixture(autouse=True)
def isolated_identity(tmp_path, monkeypatch):
    """Each test gets a fresh key file so caches don't leak between tests."""
    monkeypatch.setattr(config, "TOKEN_KEY_FILE", str(tmp_path / "test_identity.key"))
    import core.tokens
    core.tokens._identity_key = None
    yield
    core.tokens._identity_key = None


def _make_request(tmp_path, scope=None):
    from agent.queue import AccessRequest, RequestState
    now = datetime.datetime.now(datetime.UTC)
    return AccessRequest(
        id="req-test-123",
        tenant_id="tenant-abc",
        agent_id="agent-xyz",
        service="amazon",
        task="compare prices on items",
        scope=scope or ["read", "search"],
        state=RequestState.APPROVED,
        created_at=now,
        expires_at=now + datetime.timedelta(seconds=60),
    )


@pytest.fixture
def vault(tmp_path):
    from core.vault import Vault
    v = Vault.create(str(tmp_path / "test.db"), "test-password")
    yield v
    v.close()


# ---------------------------------------------------------------------------
# Identity management
# ---------------------------------------------------------------------------

def test_load_or_create_identity_generates_key(tmp_path):
    from core.tokens import load_or_create_identity
    key = load_or_create_identity()
    assert key is not None
    assert (tmp_path / "test_identity.key").exists()


def test_load_or_create_identity_persists_across_loads(tmp_path):
    from core.crypto import ed25519_public_to_bytes
    from core.tokens import load_or_create_identity
    import core.tokens
    key1 = load_or_create_identity()
    core.tokens._identity_key = None          # evict cache
    key2 = load_or_create_identity()          # reloads from file
    assert ed25519_public_to_bytes(key1.public_key()) == ed25519_public_to_bytes(key2.public_key())


# ---------------------------------------------------------------------------
# Token issuance
# ---------------------------------------------------------------------------

def test_issue_token_returns_jwt_and_id(tmp_path):
    from core.tokens import issue_token
    req = _make_request(tmp_path)
    token_str, token_id = issue_token(req, b"master-secret-32bytes-padded!!")
    assert isinstance(token_str, str)
    assert len(token_str.split(".")) == 3   # header.payload.signature
    assert isinstance(token_id, str) and len(token_id) > 0


def test_issued_token_carries_correct_claims(tmp_path, vault):
    from core.tokens import issue_token, verify_token
    req = _make_request(tmp_path, scope=["search", "read"])
    token_str, _ = issue_token(req, vault.get_key())
    claims = verify_token(token_str, vault)
    assert claims["tenant"] == "tenant-abc"
    assert claims["agent_id"] == "agent-xyz"
    assert claims["service"] == "amazon"
    assert claims["session_id"] == req.id
    assert set(claims["scope"]) == {"search", "read"}
    assert "hint" in claims
    assert "jti" in claims


def test_scope_not_broadened(tmp_path, vault):
    """JWT scope must be exactly what the request carries — no extras."""
    from core.tokens import issue_token, verify_token
    req = _make_request(tmp_path, scope=["search", "read"])
    token_str, _ = issue_token(req, vault.get_key())
    claims = verify_token(token_str, vault)
    assert "purchase" not in claims["scope"]
    assert "checkout" not in claims["scope"]


# ---------------------------------------------------------------------------
# Token verification
# ---------------------------------------------------------------------------

def test_verify_token_passes_scope_check(tmp_path, vault):
    from core.tokens import issue_token, verify_token
    req = _make_request(tmp_path, scope=["search", "read"])
    token_str, _ = issue_token(req, vault.get_key())
    claims = verify_token(token_str, vault, required_scope=["search"])
    assert claims is not None


def test_verify_token_fails_out_of_scope(tmp_path, vault):
    from core.tokens import issue_token, verify_token
    req = _make_request(tmp_path, scope=["search", "read"])
    token_str, _ = issue_token(req, vault.get_key())
    with pytest.raises(ValueError, match="scope insufficient"):
        verify_token(token_str, vault, required_scope=["purchase"])


def test_verify_token_revoked(tmp_path, vault):
    from core.tokens import issue_token, verify_token
    req = _make_request(tmp_path)
    token_str, token_id = issue_token(req, vault.get_key())
    vault.revoke_token(token_id, req.tenant_id)
    with pytest.raises(ValueError, match="revoked"):
        verify_token(token_str, vault)


def test_verify_token_tampered_signature(tmp_path, vault):
    import jwt as pyjwt
    from core.tokens import issue_token, verify_token
    req = _make_request(tmp_path)
    token_str, _ = issue_token(req, vault.get_key())
    header, payload, sig = token_str.split(".")
    tampered = f"{header}.{payload}.{'A' * len(sig)}"
    with pytest.raises(Exception):
        verify_token(tampered, vault)


# ---------------------------------------------------------------------------
# Hint decryption
# ---------------------------------------------------------------------------

def test_decrypt_hint_roundtrip(tmp_path):
    from core.tokens import decrypt_hint, issue_token
    master_secret = b"master-secret-32bytes-padded!!"
    req = _make_request(tmp_path)
    hint_data = {"type": "oauth", "provider": "amazon", "token": "tok_abc"}
    token_str, _ = issue_token(req, master_secret, hint_data=hint_data)
    recovered = decrypt_hint(token_str, req.id, master_secret)
    assert recovered == hint_data


def test_decrypt_hint_wrong_request_id(tmp_path):
    from core.tokens import decrypt_hint, issue_token
    master_secret = b"master-secret-32bytes-padded!!"
    req = _make_request(tmp_path)
    token_str, _ = issue_token(req, master_secret, hint_data={"type": "stub"})
    with pytest.raises(Exception):
        decrypt_hint(token_str, "wrong-request-id", master_secret)


def test_decrypt_hint_stub_default(tmp_path):
    from core.tokens import decrypt_hint, issue_token
    master_secret = b"master-secret-32bytes-padded!!"
    req = _make_request(tmp_path)
    token_str, _ = issue_token(req, master_secret)   # no hint_data → stub
    recovered = decrypt_hint(token_str, req.id, master_secret)
    assert recovered == {"type": "stub"}
