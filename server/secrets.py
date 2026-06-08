"""Secret encryption at rest (Fernet).

API keys and integration credentials are encrypted before they hit the SQLite
store. The symmetric key lives in a 0600 file next to the database (or via
CREWFORGE_SECRET_KEY), never in the DB itself.

`dec()` is migration-tolerant: a value that isn't a valid token is returned
as-is, so pre-existing plaintext keys keep working until the next save.
"""
from __future__ import annotations

import os
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken

from .store import _DB_PATH

_PREFIX = "enc::"  # marks values we encrypted, so dec() only decrypts our own
_fernet: Fernet | None = None


def _key_path() -> Path:
    env = os.environ.get("CREWFORGE_SECRET_KEY_FILE")
    return Path(env) if env else _DB_PATH.parent / "secret.key"


def _get_fernet() -> Fernet:
    global _fernet
    if _fernet is not None:
        return _fernet
    env_key = os.environ.get("CREWFORGE_SECRET_KEY")
    if env_key:
        _fernet = Fernet(env_key.encode())
        return _fernet
    path = _key_path()
    if path.exists():
        key = path.read_bytes()
    else:
        key = Fernet.generate_key()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(key)
        try:
            path.chmod(0o600)
        except OSError:
            pass
    _fernet = Fernet(key)
    return _fernet


def enc(plain: str | None) -> str | None:
    if not plain:
        return plain
    return _PREFIX + _get_fernet().encrypt(plain.encode()).decode()


def dec(value: str | None) -> str | None:
    if not value or not isinstance(value, str) or not value.startswith(_PREFIX):
        return value  # legacy plaintext or empty — return unchanged
    try:
        return _get_fernet().decrypt(value[len(_PREFIX):].encode()).decode()
    except InvalidToken:
        return value
