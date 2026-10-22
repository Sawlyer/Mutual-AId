from dataclasses import dataclass

from app.connectors.google_oauth import GoogleOAuthClient
from app.db import Database


@dataclass
class ConnectorToolContext:
    user_id: str
    database: Database
    google_oauth: GoogleOAuthClient | None = None
    github_oauth: object | None = None
