from collections.abc import Iterable
from dataclasses import replace

from app.connectors.base import (
    Connector,
    ConnectorPermission,
    ToolAccess,
    UnavailableAuthProvider,
)


_READ = ToolAccess.READ
_WRITE = ToolAccess.WRITE
_GOOGLE_MAIL = "https://www.googleapis.com/auth/gmail.readonly"
_GOOGLE_DRIVE = "https://www.googleapis.com/auth/drive.readonly"
_GOOGLE_CALENDAR = "https://www.googleapis.com/auth/calendar.readonly"


def _permissions(*permissions: ConnectorPermission) -> tuple[ConnectorPermission, ...]:
    return permissions


class ConnectorRegistry:
    """Central catalog of supported connector definitions."""

    def __init__(self, available_connector_ids: Iterable[str] = ()) -> None:
        available_ids = set(available_connector_ids)
        auth_provider = UnavailableAuthProvider()
        definitions = (
                Connector(
                    id="gmail", name="Gmail", icon="mail",
                    description="Consulter et organiser les e-mails de votre compte.",
                    capabilities=("Rechercher des e-mails", "Lire les messages", "Préparer des réponses"),
                    available_tools=(), availability="coming_soon", auth_provider=auth_provider,
                    required_scopes=_permissions(
                        ConnectorPermission("gmail.read", "Lecture des e-mails", "Rechercher et lire les messages.", _READ, _GOOGLE_MAIL),
                        ConnectorPermission("gmail.write", "Écriture des e-mails", "Envoyer ou modifier des messages après validation.", _WRITE, "https://www.googleapis.com/auth/gmail.send"),
                    ),
                ),
                Connector(
                    id="google_drive", name="Google Drive", icon="drive",
                    description="Rechercher et consulter des fichiers Google Drive.",
                    capabilities=("Rechercher des fichiers", "Lire des documents"),
                    available_tools=(), availability="coming_soon", auth_provider=auth_provider,
                    required_scopes=_permissions(ConnectorPermission("drive.read", "Lecture des fichiers", "Rechercher et lire les fichiers autorisés.", _READ, _GOOGLE_DRIVE)),
                ),
                Connector(
                    id="google_calendar", name="Google Calendar", icon="calendar",
                    description="Consulter les événements et disponibilités de votre agenda.",
                    capabilities=("Consulter les événements", "Vérifier les disponibilités"),
                    available_tools=(), availability="coming_soon", auth_provider=auth_provider,
                    required_scopes=_permissions(
                        ConnectorPermission("calendar.read", "Lecture de l’agenda", "Consulter les événements.", _READ, _GOOGLE_CALENDAR),
                    ),
                ),
                Connector(
                    id="github", name="GitHub", icon="github",
                    description="Consulter des dépôts, issues et demandes de fusion.",
                    capabilities=("Lire des dépôts", "Consulter les issues", "Créer des pull requests"),
                    available_tools=(), availability="coming_soon", auth_provider=auth_provider,
                    required_scopes=_permissions(
                        ConnectorPermission("github.read", "Lecture des dépôts", "Consulter les dépôts autorisés.", _READ),
                        ConnectorPermission("github.write", "Écriture GitHub", "Créer des issues ou pull requests après validation.", _WRITE),
                    ),
                ),
                Connector(
                    id="custom_mcp", name="Custom MCP Server", icon="mcp",
                    description="Relier un serveur MCP compatible et approuvé.",
                    capabilities=("Découvrir des outils MCP", "Appeler les outils autorisés"),
                    available_tools=(), availability="coming_soon", auth_provider=auth_provider,
                    required_scopes=_permissions(ConnectorPermission("mcp.tools", "Outils du serveur", "Les outils disponibles dépendent du serveur MCP ajouté.", _READ)),
                ),
            )
        self._connectors = {
            connector.id: replace(connector, availability="available") if connector.id in available_ids else connector
            for connector in definitions
        }

    def get(self, connector_id: str) -> Connector | None:
        return self._connectors.get(connector_id)

    def list(self) -> list[Connector]:
        return list(self._connectors.values())
    def register(self, connector: Connector) -> None:
        """Add or replace a connector definition from an installed provider."""
        self._connectors[connector.id] = connector
