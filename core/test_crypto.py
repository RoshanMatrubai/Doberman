import time

import pytest
import jwt as pyjwt

from core.crypto import (
    argon2id_hash,
    argon2id_verify,
    aes_gcm_decrypt,
    aes_gcm_encrypt,
    derive_hint_key,
    ed25519_private_from_bytes,
    ed25519_private_to_bytes,
    ed25519_public_from_bytes,
    ed25519_public_to_bytes,
    ed25519_sign,
    ed25519_verify,
    encode_jwt,
    decode_jwt,
    generate_ed25519_keypair,
    random_id,
)

M = 256  # MOCK: m=256 for fast tests; production uses m=65536


# --- Argon2id ---

def test_argon2id_roundtrip():
    h, salt = argon2id_hash("hunter2", m=M)
    assert argon2id_verify("hunter2", h, salt, m=M)
    assert not argon2id_verify("wrong", h, salt, m=M)


def test_argon2id_random_salt():
    h1, s1 = argon2id_hash("pw", m=M)
    h2, s2 = argon2id_hash("pw", m=M)
    assert s1 != s2
    assert h1 != h2


def test_argon2id_fixed_salt_deterministic():
    salt = b"\xab" * 16
    h1, _ = argon2id_hash("pw", salt, m=M)
    h2, _ = argon2id_hash("pw", salt, m=M)
    assert h1 == h2


def test_argon2id_output_is_32_bytes():
    h, _ = argon2id_hash("pw", m=M)
    assert len(h) == 32


# --- AES-256-GCM ---

def test_aes_gcm_roundtrip():
    key = b"\x01" * 32
    assert aes_gcm_decrypt(key, aes_gcm_encrypt(key, b"secret payload")) == b"secret payload"


def test_aes_gcm_random_nonce():
    key = b"\x02" * 32
    ct1 = aes_gcm_encrypt(key, b"same plaintext")
    ct2 = aes_gcm_encrypt(key, b"same plaintext")
    assert ct1[:12] != ct2[:12]
    assert ct1 != ct2


def test_aes_gcm_tamper_raises():
    key = b"\x03" * 32
    ct = bytearray(aes_gcm_encrypt(key, b"data"))
    ct[-1] ^= 0xFF
    with pytest.raises(Exception):
        aes_gcm_decrypt(key, bytes(ct))


def test_aes_gcm_wrong_key_raises():
    key = b"\x04" * 32
    wrong = b"\x05" * 32
    ct = aes_gcm_encrypt(key, b"secret")
    with pytest.raises(Exception):
        aes_gcm_decrypt(wrong, ct)


# --- Ed25519 ---

def test_ed25519_sign_verify():
    priv, pub = generate_ed25519_keypair()
    msg = b"test message"
    sig = ed25519_sign(priv, msg)
    assert ed25519_verify(pub, msg, sig)
    assert not ed25519_verify(pub, b"different", sig)


def test_ed25519_wrong_key_rejects():
    priv, _ = generate_ed25519_keypair()
    _, other_pub = generate_ed25519_keypair()
    sig = ed25519_sign(priv, b"msg")
    assert not ed25519_verify(other_pub, b"msg", sig)


def test_ed25519_private_key_roundtrip():
    priv, _ = generate_ed25519_keypair()
    restored = ed25519_private_from_bytes(ed25519_private_to_bytes(priv))
    msg = b"roundtrip"
    assert ed25519_sign(priv, msg) == ed25519_sign(restored, msg)


def test_ed25519_public_key_roundtrip():
    priv, pub = generate_ed25519_keypair()
    restored_pub = ed25519_public_from_bytes(ed25519_public_to_bytes(pub))
    sig = ed25519_sign(priv, b"roundtrip")
    assert ed25519_verify(restored_pub, b"roundtrip", sig)


def test_ed25519_key_bytes_are_32():
    priv, pub = generate_ed25519_keypair()
    assert len(ed25519_private_to_bytes(priv)) == 32
    assert len(ed25519_public_to_bytes(pub)) == 32


# --- JWT (EdDSA) ---

def test_jwt_encode_decode():
    priv, pub = generate_ed25519_keypair()
    payload = {"sub": "agent-1", "scope": ["search", "read"], "exp": int(time.time()) + 900}
    token = encode_jwt(payload, priv)
    decoded = decode_jwt(token, pub)
    assert decoded["sub"] == "agent-1"
    assert decoded["scope"] == ["search", "read"]


def test_jwt_expired_raises():
    priv, pub = generate_ed25519_keypair()
    token = encode_jwt({"sub": "x", "exp": int(time.time()) - 1}, priv)
    with pytest.raises(pyjwt.ExpiredSignatureError):
        decode_jwt(token, pub)


def test_jwt_wrong_key_raises():
    priv, _ = generate_ed25519_keypair()
    _, wrong_pub = generate_ed25519_keypair()
    token = encode_jwt({"exp": int(time.time()) + 900}, priv)
    with pytest.raises(Exception):
        decode_jwt(token, wrong_pub)


def test_jwt_scope_claim_preserved():
    priv, pub = generate_ed25519_keypair()
    scope = ["search", "read"]
    token = encode_jwt({"scope": scope, "exp": int(time.time()) + 60}, priv)
    assert decode_jwt(token, pub)["scope"] == scope


# --- derive_hint_key ---

def test_hint_key_deterministic():
    secret = b"master-secret-exactly-32-bytes!!"
    k1 = derive_hint_key(secret, "req-abc-123")
    k2 = derive_hint_key(secret, "req-abc-123")
    assert k1 == k2
    assert len(k1) == 32


def test_hint_key_different_ids():
    secret = b"master-secret-exactly-32-bytes!!"
    assert derive_hint_key(secret, "req-1") != derive_hint_key(secret, "req-2")


def test_hint_key_different_secrets():
    assert derive_hint_key(b"secret-a", "req-1") != derive_hint_key(b"secret-b", "req-1")


# --- random_id ---

def test_random_id_format():
    rid = random_id()
    parts = rid.split("-")
    assert len(parts) == 5  # UUID4 has 5 hyphen-separated groups


def test_random_id_uniqueness():
    ids = {random_id() for _ in range(200)}
    assert len(ids) == 200
