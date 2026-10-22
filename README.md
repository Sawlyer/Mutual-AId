# Mutual-AId

Mutual-AId est une interface de chat React + Vite + TypeScript reliée à un backend FastAPI. Le backend utilise le SDK officiel OpenAI Agents, conserve les conversations dans SQLite et peut planifier les demandes complexes en tâches suivies dans un workflow. Google Calendar est disponible en lecture seule lorsque son OAuth est configuré.

## Prérequis

- Node.js 20.19+ ou 22.12+
- Python 3.10+
- [uv](https://docs.astral.sh/uv/)
- Pour les réponses IA réelles : une clé API OpenAI et un modèle activé sur le projet

## Démarrage rapide

Après avoir cloné le projet, lancez cette commande depuis sa racine :

```bash
npm run dev:all
```

Elle installe les dépendances si nécessaire, prépare les fichiers d’environnement d’exemple s’ils n’existent pas, puis démarre Vite et FastAPI. Si les deux services tournent déjà, elle détecte leur état et ne crée pas de doublons. Si un seul port est occupé, elle affiche une erreur explicite. **Ctrl+C arrête proprement les deux serveurs.** Ouvrez l’adresse affichée par Vite, généralement `http://127.0.0.1:5173`.

Pour activer les réponses IA, renseignez `OPENAI_API_KEY` et `OPENAI_MODEL` dans `backend/.env`, puis relancez la commande. Les comptes, conversations et sessions sont stockés dans SQLite localement.

## Configuration manuelle

À la racine du dépôt :

```bash
npm install
cp .env.example .env.local
cd backend && uv sync --group dev && cp .env.example .env
```

Éditez `backend/.env` et renseignez `OPENAI_API_KEY` ainsi que `OPENAI_MODEL`. La clé reste côté backend et n’est jamais chargée par Vite. `ALLOWED_ORIGINS` doit contenir uniquement les origines du frontend autorisées.

## Lancer l’application

Dans un terminal, depuis `backend/` :

```bash
uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Dans un autre terminal, depuis la racine du dépôt :

```bash
npm run dev -- --host 127.0.0.1
```

Ouvrez l’URL Vite affichée, généralement `http://127.0.0.1:5173`. Le backend expose sa documentation OpenAPI à `http://127.0.0.1:8000/docs` et l’état de configuration à `http://127.0.0.1:8000/api/health`.

Le mode utilisé par défaut est `openai`. Pour revenir au mode de démonstration local, changez `VITE_CHAT_ADAPTER=demo` dans `.env.local`, puis redémarrez Vite. En développement, Vite relaie `/api` vers FastAPI pour garder la session de connexion sur la même origine. Si le frontend et l’API sont déployés séparément, définissez `VITE_API_BASE_URL` avec l’URL complète de l’API.

## API de chat

- `GET /api/health` : disponibilité et présence de la configuration OpenAI, sans exposer la clé
- `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout` et `GET /api/auth/me` : comptes et session HttpOnly
- `GET /api/conversations` et `POST /api/conversations` : lister et créer des conversations
- `GET /api/conversations/{id}` : consulter une conversation
- `PATCH /api/conversations/{id}` et `DELETE /api/conversations/{id}` : renommer et supprimer
- `GET /api/conversations/{id}/messages` : récupérer son historique
- `POST /api/conversations/{id}/messages/stream` : envoyer `{ "content": "…" }` et recevoir `text/event-stream`

Le flux SSE émet `user`, `delta`, `done` et `error`. Seuls les deltas de texte destinés à l’utilisateur sont transmis ; le raisonnement privé et les erreurs détaillées restent côté serveur.

Toutes les routes de conversation et de connecteur nécessitent une session. Les routes historiques `/dashboard`, `/missions/*` et `/executions/*` redirigent vers le chat : elles ne créent plus de données de démonstration qui ressemblent à de vraies exécutions.

## Connecteurs

La page Connecteurs affiche Gmail, Google Drive, Google Calendar, GitHub et Custom MCP Server. Gmail, Drive et Calendar utilisent le client OAuth Google commun ; GitHub utilise une OAuth App. Chaque service reste `setup_required` tant que ses paramètres serveur ne sont pas présents et passe en lecture seule après configuration. Custom MCP reste indisponible jusqu’à l’ajout et l’approbation d’un serveur dans l’interface dédiée.

- `GET /api/connectors` renvoie le catalogue, les permissions et les outils réellement accessibles à l’utilisateur courant.
- `GET /api/conversations/{id}/connectors` lit les connecteurs sélectionnés pour la conversation.
- `PUT /api/conversations/{id}/connectors` enregistre une sélection. Le backend rejette un connecteur déconnecté ou indisponible avec `409`.
- Le corps de `POST /api/conversations/{id}/messages/stream` accepte `connector_ids`. Le backend compare cette liste aux préférences enregistrées, puis ne fournit au SDK Agents que les outils autorisés et dotés des scopes accordés. Les outils d’écriture sans permission explicite, et ceux qui attendent une validation humaine, ne sont pas donnés à l’agent.

Le backend stocke les états OAuth à usage unique et les jetons Google chiffrés avec `CONNECTOR_TOKEN_ENCRYPTION_KEY`, séparément par compte. L’outil Calendar revérifie connexion, sélection de conversation et scope à chaque appel, puis ne renvoie que titre, début, fin et statut d’événement. Aucun outil d’écriture Calendar n’est activé. Les comptes disposent d’une inscription, connexion, déconnexion et session persistante en cookie HttpOnly. Les mots de passe sont hachés avec Argon2. Configurez `AUTH_COOKIE_SECURE=true` lorsque l’application est servie en HTTPS.

Pour activer Google, créez un client OAuth de type application Web dans Google Cloud, activez Gmail API, Google Drive API et/ou Google Calendar API selon les services voulus, puis ajoutez exactement `http://127.0.0.1:8000/api/connectors/google_calendar/callback` comme URI de redirection autorisée en local. Copiez `backend/.env.example` vers `backend/.env`, puis définissez `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI` et une clé Fernet stable dans `CONNECTOR_TOKEN_ENCRYPTION_KEY`. Les autorisations sont limitées à la lecture : Gmail readonly, Drive metadata readonly et Calendar readonly. Générez la clé depuis `backend/` avec `uv run python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`.

Pour GitHub, créez une OAuth App dans les paramètres développeur, inscrivez `http://127.0.0.1:8000/api/connectors/github/callback` comme callback, puis définissez `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET` et `GITHUB_APP_REDIRECT_URI` dans `backend/.env`. GitHub ne demande que les permissions de lecture nécessaires aux dépôts et issues. Conservez tous les secrets uniquement dans `backend/.env` et redémarrez le backend après configuration. La page Connecteurs affichera les services correctement configurés et permettra de lancer/retirer leur connexion.

## Vérifications

Frontend, à la racine :

```bash
npm run typecheck
npm run lint
npm run build
```

Tests backend, depuis `backend/` :

```bash
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest
```

## Données et sécurité

Les conversations produit sont dans `backend/data/mutual_aid.sqlite3`. Le SDK Agents conserve également son historique de session dans la base configurée. Les limites par défaut sont de 12 000 caractères par message, 12 requêtes d’écriture par minute et 5 tours d’agent. Ces limites en mémoire sont adaptées au développement local ; une configuration multi-processus nécessite un limiteur partagé et une authentification avant exposition publique.

Les clés sont ignorées par Git via `.env`; seuls les fichiers `.env.example` sans secret sont suivis. N’exposez pas le serveur de développement sur Internet.
