"""
Token issuance, verification, and hint management.

Ed25519-signed JWTs carry a scoped permission claim + an AES-GCM encrypted
credential hint.  Per-hint key = HMAC(master_secret, request_id) — never stored.
Tokens expire at TTL; revocation is checked on every verify call.
"""
from __future__ import annotations

import base64
import datetime
import json

import jwt as pyjwt

import config
from core.crypto import (
    aes_gcm_decrypt,
    aes_gcm_encrypt,
    decode_jwt,
    derive_hint_key,
    ed25519_private_from_bytes,
    ed25519_private_to_bytes,
    ed25519_public_to_bytes,
    encode_jwt,
    generate_ed25519_keypair,
    random_id,
)

_identity_key = None  # cached Ed25519PrivateKey


def load_or_create_identity():
    """Return cached Ed25519 identity key; loads from TOKEN_KEY_FILE or generates new."""
    global _identity_key
    if _identity_key is not None:
        return _identity_key
    try:
        with open(config.TOKEN_KEY_FILE, "rb") as f:
            _identity_key = ed25519_private_from_bytes(f.read())
    except FileNotFoundError:
        _identity_key, _ = generate_ed25519_keypair()
        with open(config.TOKEN_KEY_FILE, "wb") as f:
            f.write(ed25519_private_to_bytes(_identity_key))
        print(f"[tokens] generated Ed25519 identity key → {config.TOKEN_KEY_FILE}", flush=True)
    return _identity_key


def get_public_key_bytes() -> bytes:
    """Return the Ed25519 public key bytes for the current identity."""
    return ed25519_public_to_bytes(load_or_create_identity().public_key())


def issue_token(
    request,
    master_secret: bytes,
    hint_data: dict | None = None,
    ttl: int | None = None,
) -> tuple[str, str]:
    """
    Issue a scoped Ed25519-signed JWT for an approved AccessRequest.

    Payload: jti, tenant, agent_id, service, session_id, scope, iat, exp, hint, request_id.
    hint is AES-GCM encrypted with HMAC(master_secret, request_id) — never stored.

    Returns (jwt_string, token_id).
    """
    priv = load_or_create_identity()
    token_id = random_id()
    now = datetime.datetime.now(datetime.UTC)
    expires = now + datetime.timedelta(seconds=ttl or config.TOKEN_TTL_SECONDS)

    hint_payload = hint_data or {"type": "stub"}
    hint_key = derive_hint_key(master_secret, request.id)
    encrypted_hint = aes_gcm_encrypt(hint_key, json.dumps(hint_payload).encode())

    payload = {
        "jti": token_id,
        "tenant": request.tenant_id,
        "agent_id": request.agent_id,
        "service": request.service,
        "session_id": request.id,
        "scope": request.scope,
        "iat": int(now.timestamp()),
        "exp": int(expires.timestamp()),
        "hint": base64.b64encode(encrypted_hint).decode(),
        "request_id": request.id,
    }

    token_str = encode_jwt(payload, priv)
    return token_str, token_id


def verify_token(
    token: str,
    vault,
    required_scope: list[str] | None = None,
) -> dict:
    """
    Verify signature, expiry, revocation, and optional scope.
    Returns decoded claims on success; raises ValueError on any failure.
    """
    pub = load_or_create_identity().public_key()
    # decode_jwt verifies Ed25519 signature and exp claim
    claims = decode_jwt(token, pub)

    token_id = claims.get("jti")
    if not token_id:
        raise ValueError("Token missing jti claim")
    if vault.is_token_revoked(token_id):
        raise ValueError(f"Token {token_id} has been revoked")

    if required_scope:
        token_scope = claims.get("scope", [])
        missing = [a for a in required_scope if a not in token_scope]
        if missing:
            raise ValueError(f"Token scope insufficient: missing {missing}")

    return claims


def decrypt_hint(token: str, request_id: str, master_secret: bytes) -> dict:
    """
    Decode the token (without re-verifying sig) and decrypt the hint payload.
    Per-hint key derived from HMAC(master_secret, request_id) — never stored.
    """
    claims = pyjwt.decode(token, options={"verify_signature": False})
    hint_b64 = claims.get("hint")
    if not hint_b64:
        raise ValueError("Token has no hint claim")
    hint_key = derive_hint_key(master_secret, request_id)
    encrypted = base64.b64decode(hint_b64)
    return json.loads(aes_gcm_decrypt(hint_key, encrypted))
