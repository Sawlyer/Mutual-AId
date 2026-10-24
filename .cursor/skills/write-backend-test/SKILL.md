---
name: write-backend-test
description: Écrit un test FastAPI isolé avec tmp_path, sans toucher à la base ni au .env de développement. Use when adding or updating a backend test, pytest case, or API regression test.
---

# Test backend

## Étapes

1. Ajouter le test dans `backend/tests/test_<sujet>.py`.
2. Réutiliser `make_client` de `backend/tests/test_api.py` pour une route HTTP. Il crée `Settings(database_path=tmp_path / "test.sqlite3")`, enregistre un utilisateur et pose le cookie de session.
3. Pour un dépôt ou un connecteur sans toute l’application, ouvrir `Database(tmp_path / "test.sqlite3")` et appeler `initialize()`, comme dans `backend/tests/test_connectors.py`.
4. Ne pas lire `backend/.env` ni `backend/data/mutual_aid.sqlite3`.
5. Prouver l’isolation : un autre `user_id` ne voit pas la ressource.
6. Lancer depuis `backend/` :

```bash
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest tests/test_<sujet>.py
```

Le test échoue d’abord sur le comportement attendu, puis passe une fois le code aligné. Pas de secret réel dans les fixtures : une chaîne factice suffit.
