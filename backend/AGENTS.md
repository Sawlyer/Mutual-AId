# Backend

S’applique à `backend/`. Les règles plus précises sont dans `backend/app/connectors/AGENTS.md` et `backend/tests/AGENTS.md`.

- Secrets uniquement dans `backend/.env`. Ne pas les committer ni les renvoyer au client.
- Tests depuis ce dossier : `PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest`.
- Les tests utilisent `tmp_path`. Ne pas ouvrir `backend/data/mutual_aid.sqlite3`.
- Session en cookie HttpOnly. Ne pas accepter un `user_id` envoyé par le client.
- `backend/app/agents/skills.py` décrit les skills produit en SQLite. Les skills de développement sont dans `.agents/skills/` et `.cursor/skills/`.
