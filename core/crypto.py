import os
import hmac
import hashlib
import uuid

from argon2.low_level import hash_secret_raw, Type as Argon2Type
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from cryptography.hazmat.primitives.serialization import (
    Encoding, PublicFormat, PrivateFormat, NoEncryption,
)
import jwt as pyjwt

# Production Argon2id params (CLAUDE.md architecture lock)
_A2_M = 65536
_A2_T = 3
_A2_P = 4


def argon2id_hash(
    password: bytes | str,
    salt: bytes | None = None,
    *,
    m: int = _A2_M,
    t: int = _A2_T,
    p: int = _A2_P,
) -> tuple[bytes, bytes]:
    """Derive a 32-byte key from password. Returns (hash_bytes, salt)."""
    if isinstance(password, str):
        password = password.encode()
    if salt is None:
        salt = os.urandom(16)
    key = hash_secret_raw(
        secret=password,
        salt=salt,
        time_cost=t,
        memory_cost=m,
        parallelism=p,
        hash_len=32,
        type=Argon2Type.ID,
    )
    return key, salt


def argon2id_verify(
    password: bytes | str,
    expected_hash: bytes,
    salt: bytes,
    *,
    m: int = _A2_M,
    t: int = _A2_T,
    p: int = _A2_P,
) -> bool:
    derived, _ = argon2id_hash(password, salt, m=m, t=t, p=p)
    return hmac.compare_digest(derived, expected_hash)


def aes_gcm_encrypt(key: bytes, plaintext: bytes) -> bytes:
    """Returns nonce (12 B) + ciphertext + GCM tag (16 B)."""
    nonce = os.urandom(12)
    return nonce + AESGCM(key).encrypt(nonce, plaintext, None)


def aes_gcm_decrypt(key: bytes, data: bytes) -> bytes:
    """Expects nonce (12 B) + ciphertext + GCM tag. Raises on tamper."""
    return AESGCM(key).decrypt(data[:12], data[12:], None)


def generate_ed25519_keypair() -> tuple[Ed25519PrivateKey, Ed25519PublicKey]:
    priv = Ed25519PrivateKey.generate()
    return priv, priv.public_key()


def ed25519_sign(private_key: Ed25519PrivateKey, message: bytes) -> bytes:
    return private_key.sign(message)


def ed25519_verify(public_key: Ed25519PublicKey, message: bytes, signature: bytes) -> bool:
    try:
        public_key.verify(signature, message)
        return True
    except Exception:
        return False


def ed25519_private_to_bytes(private_key: Ed25519PrivateKey) -> bytes:
    return private_key.private_bytes(Encoding.Raw, PrivateFormat.Raw, NoEncryption())


def ed25519_private_from_bytes(key_bytes: bytes) -> Ed25519PrivateKey:
    return Ed25519PrivateKey.from_private_bytes(key_bytes)


def ed25519_public_to_bytes(public_key: Ed25519PublicKey) -> bytes:
    return public_key.public_bytes(Encoding.Raw, PublicFormat.Raw)


def ed25519_public_from_bytes(key_bytes: bytes) -> Ed25519PublicKey:
    return Ed25519PublicKey.from_public_bytes(key_bytes)


def encode_jwt(payload: dict, private_key: Ed25519PrivateKey) -> str:
    """Sign payload with Ed25519 private key; EdDSA algorithm."""
    return pyjwt.encode(payload, private_key, algorithm="EdDSA")


def decode_jwt(token: str, public_key: Ed25519PublicKey) -> dict:
    """Verify signature and expiry; returns decoded claims."""
    return pyjwt.decode(token, public_key, algorithms=["EdDSA"])


def derive_hint_key(master_secret: bytes, request_id: str) -> bytes:
    """HMAC-SHA256(master_secret, request_id) → 32-byte per-hint key; never stored."""
    return hmac.new(master_secret, request_id.encode(), hashlib.sha256).digest()


def random_id() -> str:
    return str(uuid.uuid4())
