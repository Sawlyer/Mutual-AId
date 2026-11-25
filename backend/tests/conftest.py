import pytest


@pytest.fixture(autouse=True)
def isolate_backend_settings_from_local_env(monkeypatch):
    """Keep tests deterministic when a developer has configured backend/.env."""
    for name in (
        "OPENAI_API_KEY",
        "OPENAI_MODEL",
        "GOOGLE_OAUTH_CLIENT_ID",
        "GOOGLE_OAUTH_CLIENT_SECRET",
        "GOOGLE_OAUTH_REDIRECT_URI",
        "GITHUB_APP_CLIENT_ID",
        "GITHUB_APP_CLIENT_SECRET",
        "GITHUB_APP_REDIRECT_URI",
        "CONNECTOR_TOKEN_ENCRYPTION_KEY",
    ):
        monkeypatch.setenv(name, "")
