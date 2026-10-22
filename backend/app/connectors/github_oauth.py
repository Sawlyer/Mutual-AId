import logging
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

import httpx

from app.config import Settings
from app.connectors.oauth import OAuthStateStore, TokenVault
from app.db import Database

logger = logging.getLogger(__name__)

GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize"
GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token"
GITHUB_REVOKE_URL = "https://api.github.com/applications/{client_id}/token"
GITHUB_API_BASE = "https://api.github.com"
GITHUB_READ_PERMISSIONS = ("metadata:read", "contents:read", "issues:read")


class GitHubOAuthError(RuntimeError):
    pass


class GitHubOAuthNotConfigured(GitHubOAuthError):
    pass


class GitHubAppOAuthClient:
    """User authorization for a GitHub App, with encrypted per-user credentials."""

    def __init__(self, settings: Settings, database: Database, vault: TokenVault, state_store: OAuthStateStore,
                 http_client: httpx.AsyncClient | None = None):
        self.settings = settings
        self.database = database
        self.vault = vault
        self.state_store = state_store
        self.http_client = http_client

    def _require_config(self) -> tuple[str, str, str]:
        if not self.settings.github_app_configured:
            raise GitHubOAuthNotConfigured("GitHub App OAuth is not configured")
        assert self.settings.github_app_client_id and self.settings.github_app_client_secret and self.settings.github_app_redirect_uri
        return (
            self.settings.github_app_client_id.strip(),
            self.settings.github_app_client_secret.get_secret_value().strip(),
            self.settings.github_app_redirect_uri.strip(),
        )

    def authorization_url(self, user_id: str) -> str:
        client_id, _, redirect_uri = self._require_config()
        state = self.state_store.create(user_id, list(GITHUB_READ_PERMISSIONS), "/connectors", "github")
        return f"{GITHUB_AUTHORIZE_URL}?{urlencode({'client_id': client_id, 'redirect_uri': redirect_uri, 'state': state.value, 'allow_signup': 'false'})}"

    async def exchange_code(self, user_id: str, code: str, state: str) -> dict[str, object]:
        client_id, client_secret, redirect_uri = self._require_config()
        authorization = self.state_store.consume(user_id, state, "github")
        if authorization is None or tuple(authorization["scopes"]) != GITHUB_READ_PERMISSIONS:
            raise GitHubOAuthError("GitHub authorization state is invalid, expired, or already used")
        if not code or len(code) > 4096:
            raise GitHubOAuthError("GitHub authorization code is invalid")
        response = await self._post_form(GITHUB_TOKEN_URL, {
            "client_id": client_id, "client_secret": client_secret, "code": code, "redirect_uri": redirect_uri,
        }, accept_json=True)
        data = response.json()
        access_token = data.get("access_token")
        if not isinstance(access_token, str) or not access_token:
            raise GitHubOAuthError("GitHub token response did not include an access token")
        expires_in = data.get("expires_in")
        refresh_token = data.get("refresh_token")
        if expires_in is not None and (not isinstance(refresh_token, str) or not refresh_token):
            raise GitHubOAuthError("GitHub did not return refresh credentials for an expiring token")
        payload: dict[str, object] = {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "scopes": list(GITHUB_READ_PERMISSIONS),
            "expires_at": (datetime.now(timezone.utc) + timedelta(seconds=int(expires_in))).isoformat() if expires_in else None,
            "refresh_expires_at": (datetime.now(timezone.utc) + timedelta(seconds=int(data["refresh_token_expires_in"]))).isoformat() if data.get("refresh_token_expires_in") else None,
        }
        self._store_payload(user_id, payload)
        self.database.set_connector_connection(user_id, "github", "connected", list(GITHUB_READ_PERMISSIONS))
        return {"status": "connected", "connector_id": "github", "granted_scopes": list(GITHUB_READ_PERMISSIONS)}

    async def access_token(self, user_id: str) -> str:
        client_id, client_secret, _ = self._require_config()
        payload = self._get_payload(user_id)
        connection = self.database.get_connector_connection(user_id, "github")
        if payload is None or connection is None or connection["status"] != "connected":
            raise GitHubOAuthError("GitHub is not connected")
        expires_at = payload.get("expires_at")
        if not isinstance(expires_at, str):
            return str(payload["access_token"])
        expiry = datetime.fromisoformat(expires_at)
        if expiry.tzinfo is None:
            expiry = expiry.replace(tzinfo=timezone.utc)
        if expiry > datetime.now(timezone.utc) + timedelta(seconds=60):
            return str(payload["access_token"])
        refresh_token = payload.get("refresh_token")
        if not isinstance(refresh_token, str) or not refresh_token:
            self.database.set_connector_connection(user_id, "github", "error", list(GITHUB_READ_PERMISSIONS), "Reconnexion GitHub requise")
            raise GitHubOAuthError("GitHub requires reconnection")
        try:
            response = await self._post_form(GITHUB_TOKEN_URL, {
                "client_id": client_id, "client_secret": client_secret,
                "grant_type": "refresh_token", "refresh_token": refresh_token,
            }, accept_json=True)
            refreshed = response.json()
            access_token = refreshed.get("access_token")
            new_refresh_token = refreshed.get("refresh_token")
            if not isinstance(access_token, str) or not access_token or not isinstance(new_refresh_token, str) or not new_refresh_token:
                raise GitHubOAuthError("GitHub token refresh response is incomplete")
        except Exception as error:
            self.database.set_connector_connection(user_id, "github", "error", list(GITHUB_READ_PERMISSIONS), "Reconnexion GitHub requise")
            logger.warning("GitHub token refresh failed for user %s (%s)", user_id, type(error).__name__)
            raise GitHubOAuthError("GitHub requires reconnection") from error
        payload["access_token"] = access_token
        payload["refresh_token"] = new_refresh_token
        payload["expires_at"] = (datetime.now(timezone.utc) + timedelta(seconds=int(refreshed.get("expires_in", 28800)))).isoformat()
        payload["refresh_expires_at"] = (datetime.now(timezone.utc) + timedelta(seconds=int(refreshed.get("refresh_token_expires_in", 15897600)))).isoformat()
        self._store_payload(user_id, payload)
        return access_token

    async def revoke(self, user_id: str) -> None:
        client_id, client_secret, _ = self._require_config()
        payload = self._get_payload(user_id)
        if payload:
            token = payload.get("access_token")
            if isinstance(token, str) and token:
                try:
                    await self._delete_token(client_id, client_secret, token)
                except Exception as error:
                    logger.warning("GitHub token revocation failed for user %s (%s)", user_id, type(error).__name__)
        self.database.delete_connector_credentials(user_id, "github")
        self.database.set_connector_connection(user_id, "github", "disconnected", [])

    async def _post_form(self, url: str, data: dict[str, str], accept_json: bool = False) -> httpx.Response:
        headers = {"Accept": "application/json"} if accept_json else {}
        if self.http_client:
            response = await self.http_client.post(url, data=data, headers=headers, timeout=15)
        else:
            async with httpx.AsyncClient(timeout=15) as client:
                response = await client.post(url, data=data, headers=headers)
        if response.status_code != 200:
            logger.warning("GitHub OAuth request failed with HTTP %s", response.status_code)
            raise GitHubOAuthError("GitHub authorization failed")
        return response

    async def _delete_token(self, client_id: str, client_secret: str, token: str) -> None:
        url = GITHUB_REVOKE_URL.format(client_id=client_id)
        if self.http_client:
            response = await self.http_client.delete(url, auth=(client_id, client_secret), json={"access_token": token}, timeout=15)
        else:
            async with httpx.AsyncClient(timeout=15) as client:
                response = await client.delete(url, auth=(client_id, client_secret), json={"access_token": token})
        if response.status_code not in {204, 404}:
            response.raise_for_status()

    def _get_payload(self, user_id: str) -> dict[str, object] | None:
        encrypted = self.database.get_connector_credentials(user_id, "github")
        if encrypted is None:
            return None
        try:
            return self.vault.decrypt_payload(encrypted)
        except Exception as error:
            logger.warning("Stored GitHub credentials could not be decrypted for user %s", user_id)
            raise GitHubOAuthError("Stored GitHub credentials are unavailable") from error

    def _store_payload(self, user_id: str, payload: dict[str, object]) -> None:
        self.database.store_connector_credentials(user_id, "github", self.vault.encrypt_payload(payload))
