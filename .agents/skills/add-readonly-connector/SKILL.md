---
name: add-readonly-connector
description: Ajoute un connecteur en lecture seule avec revalidation des scopes et un test de refus. Use when adding a connector, an OAuth integration, or a read-only agent tool.
---

# Connecteur en lecture seule

Les skills produit (`backend/app/agents/skills.py`) ne donnent aucun accès outil. Un outil n’existe que s’il est enregistré ici.

## Étapes

1. Créer `backend/app/connectors/<nom>.py`. Décorer la fonction avec `@function_tool`. Avant tout appel HTTP, relire la connexion en base et exiger le scope, comme `drive_search_files` dans `google_drive.py`.
2. Déclarer le connecteur dans `ConnectorRegistry` (`backend/app/connectors/registry.py`) avec `ToolAccess.READ` et un scope de lecture déjà nommé dans `google_oauth.py` ou `github_oauth.py`. Ne pas inventer de scope d’écriture.
3. Enregistrer l’outil dans `create_app` (`backend/app/main.py`) :

```python
application.state.tool_registry.register(
    "<id>", "<outil>", <fonction>,
    access="read", required_scopes=[SCOPE_DE_LECTURE],
    description="...",
)
```

4. `ToolRegistry.tools_for_user` doit rester le seul chemin vers le modèle : connecteur sélectionné pour la conversation, statut `connected`, scopes inclus.
5. Ajouter dans `backend/tests/test_connectors.py` un test qui refuse l’appel quand le scope manque, sur le modèle de `test_drive_search_refuses_metadata_access_without_matching_scope`.
6. Depuis `backend/` : `PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest tests/test_connectors.py`.
