# Mutual-AId — contexte pour les agents de code

Ce fichier guide les agents qui modifient le dépôt. Cursor en reprend le même texte dans `.cursor/rules/contexte.mdc` (`alwaysApply: true`) : les deux doivent rester identiques. Cursor lit aussi `.cursor/rules/` et `.cursor/skills/`. Codex lit ce fichier, puis chaque `AGENTS.md` rencontré jusqu’au dossier courant, et les skills de `.agents/skills/`. Les skills stockées en SQLite (`backend/app/agents/skills.py`) sont des instructions produit : elles n’ont aucun rapport avec ces deux dossiers.

## Stack

- Frontend : React 19, Vite, TypeScript, React Router 7, Zustand, Tailwind. Alias `@/` vers `src/`.
- Backend : FastAPI, SDK `openai-agents`, SQLite via `aiosqlite`.
- Données locales : `backend/data/mutual_aid.sqlite3`. Les tests utilisent un fichier `tmp_path`, jamais cette base.
- Ports : frontend `http://127.0.0.1:5173`, API `http://127.0.0.1:8000`.

## Contexte par dossier

Codex n’ajoute un `AGENTS.md` imbriqué que s’il travaille dans ce dossier ou en dessous. Cursor l’ajoute quand un fichier de ce dossier est dans le contexte. Les lire avant d’éditer le code correspondant :

- `src/AGENTS.md` — frontend
- `backend/AGENTS.md` — secrets, pytest, session
- `backend/app/connectors/AGENTS.md` — lecture seule et scopes
- `backend/tests/AGENTS.md` — tests isolés

Les workflows sont dans `.agents/skills/` (lus par Codex et Cursor). `.cursor/skills/` pointe vers ces mêmes dossiers : `run-and-verify`, `add-readonly-connector`, `write-backend-test`, `change-frontend-api`.

## Où modifier

| Changement | Emplacement |
| --- | --- |
| Page ou écran | `src/pages/`, route dans `src/app/router.tsx` |
| UI d’une fonctionnalité | `src/features/<domaine>/` |
| Appel HTTP | `src/services/` (`credentials: 'include'`) |
| État client | `src/stores/` |
| Route, auth, flux SSE | `backend/app/main.py`, `backend/app/auth.py`, `backend/app/agent.py` |
| Connecteur ou outil | `backend/app/connectors/` |
| Profils et skills produit | `backend/app/agents/` |
| Plan et exécution | `backend/app/planning/`, `backend/app/executions/` |
| Test API | `backend/tests/test_*.py` |
| Test frontend | `src/**/*.test.ts` |

## Commandes

Depuis la racine du dépôt :

```bash
npm run dev:all
npm run typecheck
npm run lint
npm run test
```

`npm run dev:all` lance Vite et FastAPI. Docker, depuis la même racine : `docker compose up --build`.

Tests backend, depuis `backend/` :

```bash
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest
```

## Interdits

- Secrets uniquement dans `backend/.env`. Ne jamais les mettre dans une variable `VITE_*`, les committer, ni les renvoyer dans `/api/health` ou un événement SSE.
- Ne pas élargir les scopes OAuth. Lecture seule : `GMAIL_READ_SCOPE`, `DRIVE_METADATA_READ_SCOPE`, `CALENDAR_READ_SCOPE` (`backend/app/connectors/google_oauth.py`) et `GITHUB_READ_PERMISSIONS` (`backend/app/connectors/github_oauth.py`). `CALENDAR_WRITE_SCOPE` n’est pas un scope à demander.
- Tout outil passe par `ToolRegistry.tools_for_user` dans `backend/app/connectors/tools.py` : connecteur sélectionné, compte connecté, scopes accordés, et approbation humaine si `access` vaut `write`.
- Session en cookie HttpOnly. Ne pas accepter un identifiant utilisateur envoyé par le client.
- Les événements SSE visibles sont `user`, `delta`, `plan.ready`, `execution.created`, `done` et `error`. Le raisonnement privé, les secrets et les erreurs provider brutes restent côté serveur.
- `backend/app/agents/skills.py` décrit le modèle des skills produit. Ne pas y ranger les skills de développement.
