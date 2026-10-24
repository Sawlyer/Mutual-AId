---
name: run-and-verify
description: Démarre Mutual-AId et lance typecheck, lint, Vitest et pytest. Use when the user asks to run the app, verify a change, or check that frontend and backend still pass.
---

# Lancer et vérifier

Depuis la racine du dépôt `Mutual-AId/`.

## Démarrage

Choisir un seul mode :

- Natif : `npm run dev:all` (Vite sur `127.0.0.1:5173`, API sur `127.0.0.1:8000`).
- Docker : `docker compose up --build`, mêmes ports.

`GET /api/health` doit répondre `status: ok` sans champ de clé API.

## Vérification

Frontend, à la racine :

```bash
npm run typecheck
npm run lint
npm run test
```

Backend, depuis `backend/` :

```bash
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest
```

Lancer la commande du côté modifié, puis l’autre si le contrat HTTP a changé. Un échec se corrige avant de déclarer le travail terminé.
