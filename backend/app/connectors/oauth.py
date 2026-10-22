import hashlib
import json
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from cryptography.fernet import Fernet, InvalidToken

from app.db import Database


@dataclass(frozen=True)
class OAuthState:
    value: str
    user_id: str
    scopes: list[str]
    redirect_path: str
    expires_at: str
    connector_id: str = "google_calendar"


class TokenVault:
    """Encrypt provider tokens before they are written to SQLite."""

    def __init__(self, key: str):
        try:
            self._fernet = Fernet(key.encode("utf-8"))
        except (ValueError, TypeError) as error:
            raise ValueError("A valid Fernet key is required") from error

    def encrypt(self, token: str) -> str:
        return self._fernet.encrypt(token.encode("utf-8")).decode("ascii")

    def decrypt(self, ciphertext: str) -> str:
        return self._fernet.decrypt(ciphertext.encode("ascii")).decode("utf-8")

    def encrypt_payload(self, payload: dict[str, object]) -> str:
        return self.encrypt(json.dumps(payload, separators=(",", ":"), ensure_ascii=False))

    def decrypt_payload(self, ciphertext: str) -> dict[str, object]:
        value = json.loads(self.decrypt(ciphertext))
        if not isinstance(value, dict):
            raise ValueError("Credential payload must be an object")
        return value


class OAuthStateStore:
    def __init__(self, database: Database, lifetime_seconds: int = 600):
        self.database = database
        self.lifetime_seconds = max(60, min(lifetime_seconds, 900))

    @staticmethod
    def _digest(value: str) -> str:
        return hashlib.sha256(value.encode("utf-8")).hexdigest()

    def create(self, user_id: str, scopes: list[str], redirect_path: str, connector_id: str = "google_calendar") -> OAuthState:
        value = secrets.token_urlsafe(32)
        expires = datetime.now(timezone.utc) + timedelta(seconds=self.lifetime_seconds)
        expires_at = expires.isoformat()
        self.database.create_connector_oauth_state(self._digest(value), user_id, scopes, redirect_path, expires_at, connector_id)
        return OAuthState(value=value, user_id=user_id, scopes=list(scopes), redirect_path=redirect_path, expires_at=expires_at, connector_id=connector_id)

    def consume(self, user_id: str, value: str, connector_id: str | None = None) -> dict[str, object] | None:
        if not value or len(value) > 256:
            return None
        return self.database.consume_connector_oauth_state(self._digest(value), user_id, connector_id)
