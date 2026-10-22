import logging
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

import httpx

from app.config import Settings
from app.connectors.oauth import OAuthStateStore, TokenVault
from app.db import Database

logger = logging.getLogger(__name__)

CALENDAR_READ_SCOPE = "https://www.googleapis.com/auth/calendar.readonly"
CALENDAR_EVENTS_READ_SCOPE = "https://www.googleapis.com/auth/calendar.events.readonly"
CALENDAR_WRITE_SCOPE = "https://www.googleapis.com/auth/calendar.events"
GMAIL_READ_SCOPE = "https://www.googleapis.com/auth/gmail.readonly"
DRIVE_METADATA_READ_SCOPE = "https://www.googleapis.com/auth/drive.metadata.readonly"
GOOGLE_CONNECTOR_SCOPES = {
    "gmail": {GMAIL_READ_SCOPE},
    "google_drive": {DRIVE_METADATA_READ_SCOPE},
    "google_calendar": {CALENDAR_READ_SCOPE, CALENDAR_EVENTS_READ_SCOPE},
}
GOOGLE_KNOWN_SCOPES = set().union(*GOOGLE_CONNECTOR_SCOPES.values(), {CALENDAR_WRITE_SCOPE})
GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"
GOOGLE_REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke"


class GoogleOAuthError(RuntimeError):
    pass


class GoogleOAuthNotConfigured(GoogleOAuthError):
    pass


class InvalidOAuthState(GoogleOAuthError):
    pass


class GoogleOAuthClient:
    def __init__(self, settings: Settings, database: Database, vault: TokenVault, state_store: OAuthStateStore, http_client: httpx.AsyncClient | None = None):
        self.settings = settings
        self.database = database
        self.vault = vault
        self.state_store = state_store
        self.http_client = http_client

    def _require_config(self) -> tuple[str, str, str]:
        if not self.settings.google_oauth_configured:
            raise GoogleOAuthNotConfigured("Google OAuth is not configured")
        assert self.settings.google_oauth_client_id and self.settings.google_oauth_redirect_uri
        assert self.settings.google_oauth_client_secret
        return self.settings.google_oauth_client_id.strip(), self.settings.google_oauth_client_secret.get_secret_value().strip(), self.settings.google_oauth_redirect_uri.strip()

    def authorization_url(self, user_id: str, scopes: list[str], redirect_path: str = "/connectors", *, connector_id: str = "google_calendar") -> str:
        client_id, _, redirect_uri = self._require_config()
        allowed_scopes = GOOGLE_CONNECTOR_SCOPES.get(connector_id, set())
        if not scopes or not set(scopes).issubset(allowed_scopes):
            raise ValueError("Unsupported Google connector scope")
        if redirect_path != "/connectors":
            raise ValueError("Unsupported OAuth return path")
        state = self.state_store.create(user_id, scopes, redirect_path, connector_id)
        query = urlencode({
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": " ".join(scopes),
            "access_type": "offline",
            "prompt": "consent",
            "include_granted_scopes": "true",
            "state": state.value,
        })
        return f"{GOOGLE_AUTH_ENDPOINT}?{query}"

    async def exchange_code(self, user_id: str, code: str, state: str, *, connector_id: str | None = None) -> dict[str, object]:
        client_id, client_secret, redirect_uri = self._require_config()
        authorization = self.state_store.consume(user_id, state, connector_id)
        if authorization is None:
            raise InvalidOAuthState("OAuth state is invalid, expired, or already used")
        resolved_connector_id = str(authorization["connector_id"])
        allowed_scopes = GOOGLE_CONNECTOR_SCOPES.get(resolved_connector_id, set())
        requested_scopes = set(authorization["scopes"])
        if not requested_scopes or not requested_scopes.issubset(allowed_scopes):
            raise GoogleOAuthError("Stored Google OAuth scopes are unsupported")
        if not code or len(code) > 4096:
            raise GoogleOAuthError("Authorization code is invalid")
        response = await self._post_form(GOOGLE_TOKEN_ENDPOINT, {
            "client_id": client_id, "client_secret": client_secret, "code": code,
            "redirect_uri": redirect_uri, "grant_type": "authorization_code",
        })
        token_data = response.json()
        access_token = token_data.get("access_token")
        if not isinstance(access_token, str) or not access_token:
            raise GoogleOAuthError("Google token response did not include an access token")
        existing = self._get_payload(user_id, resolved_connector_id)
        refresh_token = token_data.get("refresh_token") or (existing or {}).get("refresh_token")
        if not isinstance(refresh_token, str) or not refresh_token:
            raise GoogleOAuthError("Google did not return a durable offline credential")
        granted_scopes = str(token_data.get("scope") or "").split() or list(authorization["scopes"])
        if not set(granted_scopes).issubset(GOOGLE_KNOWN_SCOPES) or not requested_scopes.issubset(granted_scopes):
            raise GoogleOAuthError("Google did not grant the requested permissions")
        expires_at = datetime.now(timezone.utc) + timedelta(seconds=int(token_data.get("expires_in", 3600)))
        payload = {"access_token": access_token, "refresh_token": refresh_token, "expires_at": expires_at.isoformat(), "scopes": granted_scopes}
        self._store_payload(user_id, resolved_connector_id, payload)
        self.database.set_connector_connection(user_id, resolved_connector_id, "connected", granted_scopes)
        return {"status": "connected", "connector_id": resolved_connector_id, "granted_scopes": granted_scopes}

    async def access_token(self, user_id: str, connector_id: str = "google_calendar") -> str:
        client_id, client_secret, _ = self._require_config()
        if connector_id not in GOOGLE_CONNECTOR_SCOPES:
            raise GoogleOAuthError("Unsupported Google connector")
        payload = self._get_payload(user_id, connector_id)
        if payload is None:
            raise GoogleOAuthError("Google connector is not connected")
        expires_at = datetime.fromisoformat(str(payload.get("expires_at")))
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        current_token = str(payload.get("access_token", ""))
        if current_token and expires_at > datetime.now(timezone.utc) + timedelta(seconds=60):
            return current_token
        refresh_token = payload.get("refresh_token")
        if not isinstance(refresh_token, str) or not refresh_token:
            self.database.set_connector_connection(user_id, connector_id, "error", list(payload.get("scopes", [])), "Reconnexion Google requise")
            raise GoogleOAuthError("Google connector requires reconnection")
        try:
            response = await self._post_form(GOOGLE_TOKEN_ENDPOINT, {
                "client_id": client_id, "client_secret": client_secret,
                "refresh_token": refresh_token, "grant_type": "refresh_token",
            })
            refreshed = response.json()
            access_token = refreshed.get("access_token")
            if not isinstance(access_token, str) or not access_token:
                raise GoogleOAuthError("Google refresh did not include an access token")
        except Exception as error:
            self.database.set_connector_connection(user_id, connector_id, "error", list(payload.get("scopes", [])), "Reconnexion Google requise")
            logger.warning("Google token refresh failed for user %s and connector %s (%s)", user_id, connector_id, type(error).__name__)
            raise GoogleOAuthError("Google connector requires reconnection") from error
        payload["access_token"] = access_token
        payload["expires_at"] = (datetime.now(timezone.utc) + timedelta(seconds=int(refreshed.get("expires_in", 3600)))).isoformat()
        self._store_payload(user_id, connector_id, payload)
        return access_token

    async def revoke(self, user_id: str, connector_id: str = "google_calendar") -> None:
        payload = self._get_payload(user_id, connector_id)
        if payload and not self.database.has_other_connected_google_connector(user_id, connector_id):
            token = payload.get("refresh_token") or payload.get("access_token")
            if isinstance(token, str) and token:
                try:
                    response = await self._post_form(GOOGLE_REVOKE_ENDPOINT, {"token": token})
                    if response.status_code not in {200, 400}:
                        logger.warning("Google token revocation returned HTTP %s for user %s", response.status_code, user_id)
                except Exception as error:
                    logger.warning("Google token revocation failed for user %s (%s)", user_id, type(error).__name__)
        elif payload:
            logger.info("Skipping provider-wide Google revocation while another connector remains active for user %s", user_id)
        self.database.delete_connector_credentials(user_id, connector_id)
        self.database.set_connector_connection(user_id, connector_id, "disconnected", [])

    async def _post_form(self, url: str, data: dict[str, str]) -> httpx.Response:
        if self.http_client:
            response = await self.http_client.post(url, data=data, timeout=15)
        else:
            async with httpx.AsyncClient(timeout=15) as client:
                response = await client.post(url, data=data)
        if url == GOOGLE_TOKEN_ENDPOINT and response.status_code != 200:
            logger.warning("Google OAuth token request failed with HTTP %s", response.status_code)
            raise GoogleOAuthError("Google authorization failed")
        response.raise_for_status()
        return response

    def _get_payload(self, user_id: str, connector_id: str = "google_calendar") -> dict[str, object] | None:
        encrypted = self.database.get_connector_credentials(user_id, connector_id)
        if encrypted is None:
            return None
        try:
            return self.vault.decrypt_payload(encrypted)
        except Exception as error:
            logger.warning("Stored Google credentials could not be decrypted for user %s and connector %s", user_id, connector_id)
            raise GoogleOAuthError("Stored Google Calendar credentials are unavailable") from error

    def _store_payload(self, user_id: str, connector_id: str, payload: dict[str, object]) -> None:
        self.database.store_connector_credentials(user_id, connector_id, self.vault.encrypt_payload(payload))
