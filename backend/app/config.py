from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


BACKEND_DIR = Path(__file__).resolve().parents[1]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BACKEND_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    openai_api_key: SecretStr | None = None
    openai_model: str | None = None
    openai_reasoning_effort: Literal[
        "none", "minimal", "low", "medium", "high", "xhigh", "max",
    ] = "low"
    openai_input_price_per_million: float | None = Field(default=None, ge=0)
    openai_cached_input_price_per_million: float | None = Field(default=None, ge=0)
    openai_output_price_per_million: float | None = Field(default=None, ge=0)
    database_path: Path = BACKEND_DIR / "data" / "mutual_aid.sqlite3"
    allowed_origins: list[str] = Field(default_factory=lambda: ["http://localhost:5173", "http://127.0.0.1:5173"])
    max_agent_turns: int = Field(default=5, ge=1, le=20)
    max_parallel_tasks: int = Field(default=3, ge=1, le=8)
    max_message_chars: int = Field(default=12_000, ge=100, le=50_000)
    requests_per_minute: int = Field(default=60, ge=1, le=120)
    google_oauth_client_id: str | None = None
    google_oauth_client_secret: SecretStr | None = None
    google_oauth_redirect_uri: str | None = None
    github_app_client_id: str | None = None
    github_app_client_secret: SecretStr | None = None
    github_app_redirect_uri: str | None = None
    connector_token_encryption_key: SecretStr | None = None
    mcp_catalog_path: Path = BACKEND_DIR / "app" / "connectors" / "data" / "mcp_catalog.sqlite3"
    mcp_allow_loopback: bool = False

    @property
    def openai_configured(self) -> bool:
        return bool(self.openai_api_key and self.openai_api_key.get_secret_value().strip() and self.openai_model and self.openai_model.strip())

    @property
    def api_key_value(self) -> str | None:
        if not self.openai_api_key:
            return None
        value = self.openai_api_key.get_secret_value().strip()
        return value or None

    @property
    def connector_token_key(self) -> str | None:
        value = self.connector_token_encryption_key.get_secret_value().strip() if self.connector_token_encryption_key else ""
        return value or None

    @property
    def google_oauth_configured(self) -> bool:
        client_secret = self.google_oauth_client_secret.get_secret_value().strip() if self.google_oauth_client_secret else ""
        return bool(self.google_oauth_client_id and self.google_oauth_client_id.strip() and client_secret and self.google_oauth_redirect_uri and self.google_oauth_redirect_uri.strip() and self.connector_token_key)

    @property
    def google_calendar_configured(self) -> bool:
        """Backward-compatible name for the shared Google OAuth configuration."""
        return self.google_oauth_configured

    @property
    def github_app_configured(self) -> bool:
        client_secret = self.github_app_client_secret.get_secret_value().strip() if self.github_app_client_secret else ""
        return bool(self.github_app_client_id and self.github_app_client_id.strip() and client_secret and self.github_app_redirect_uri and self.github_app_redirect_uri.strip() and self.connector_token_key)
