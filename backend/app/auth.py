import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone

from pwdlib import PasswordHash

from app.config import Settings
from app.db import Database
from app.schemas import AuthUserRead


password_hasher = PasswordHash.recommended()
_DUMMY_PASSWORD_HASH = password_hasher.hash("invalid-user-password-hash")


def hash_password(password: str) -> str:
    return password_hasher.hash(password)


def verify_password(password: str, stored_hash: str | None) -> bool:
    candidate_hash = stored_hash or _DUMMY_PASSWORD_HASH
    try:
        return password_hasher.verify(password, candidate_hash) if stored_hash else _verify_dummy(password)
    except Exception:
        return False


def _verify_dummy(password: str) -> bool:
    try:
        password_hasher.verify(password, _DUMMY_PASSWORD_HASH)
    except Exception:
        return False
    return False


def token_digest(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_session(database: Database, user: AuthUserRead, settings: Settings) -> str:
    token = secrets.token_urlsafe(32)
    expires_at = (datetime.now(timezone.utc) + timedelta(days=settings.auth_session_days)).isoformat()
    database.create_auth_session(token_digest(token), user.id, expires_at)
    return token


def constant_time_equal(left: str, right: str) -> bool:
    return hmac.compare_digest(left, right)
