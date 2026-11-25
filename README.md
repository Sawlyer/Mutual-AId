# Mutual-AId

Mutual-AId est une application de chat qui peut transformer une demande complexe en tâches confiées à des agents spécialisés. Elle comprend un frontend React, une API FastAPI, un planificateur OpenAI, un suivi d’exécution et des connecteurs externes soumis aux autorisations de l’utilisateur.

> L’application utilise un espace de travail local partagé : il n’y a pas de comptes ni de connexion. Ne l’exposez pas sur Internet.

## Architecture

<p align="center">
  <a href="./.archify/architecture-mutual-aid-20261027-114110/mutual-aid.html">
    <img src="./.archify/architecture-mutual-aid-20261027-114110/architecture-preview.png" alt="Architecture de Mutual-AId" width="100%">
  </a>
  <br>
  <a href="./.archify/architecture-mutual-aid-20261027-114110/mutual-aid.html"><strong>Explorer la carte d’architecture interactive →</strong></a>
</p>

## Démarrage avec Docker

Prérequis : Docker avec Docker Compose v2.24 ou plus récent. Depuis la racine du dépôt :

```bash
cp backend/.env.example backend/.env
```

Renseignez `OPENAI_API_KEY` et `OPENAI_MODEL` dans `backend/.env`, puis démarrez l’application :

```bash
docker compose up --build
```

- Application : <http://127.0.0.1:5173>
- API et documentation : <http://127.0.0.1:8000/docs>

Le premier démarrage construit les images et nécessite une connexion Internet. Les données sont conservées dans le volume Docker `mutual-aid-data`. `Ctrl+C` arrête les services ; `docker compose down` les arrête sans supprimer les données. Pour réinitialiser l’espace local :

```bash
docker compose down -v
```

## Démarrage pour le développement

Prérequis : Node.js 22.12+, Python 3.12+, [`uv`](https://docs.astral.sh/uv/) et `curl`. La commande suivante prépare les dépendances et les fichiers d’environnement d’exemple, puis démarre Vite et FastAPI :

```bash
npm run dev:all
```

Ouvrez <http://127.0.0.1:5173>. `Ctrl+C` arrête les deux serveurs. Les données du mode natif sont stockées sous `backend/data/`, séparément du volume Docker.

Pour lancer les services séparément, installez les dépendances puis démarrez le backend dans un terminal :

```bash
cd backend
uv sync --group dev --locked
uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Dans un second terminal, à la racine du dépôt :

```bash
npm ci
npm run dev -- --host 127.0.0.1
```

## Configuration

Les secrets sont lus par le backend depuis `backend/.env`.

| Variable | Utilité |
| --- | --- |
| `OPENAI_API_KEY` | Clé API utilisée par le planificateur, les agents et la revue des résultats. |
| `OPENAI_MODEL` | Modèle compatible avec le SDK OpenAI Agents. |
| `OPENAI_REASONING_EFFORT` | Niveau de raisonnement ; `low` est la valeur par défaut. |
| `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI` | OAuth Google pour Gmail, Drive et Calendar. |
| `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_REDIRECT_URI` | OAuth GitHub en lecture seule. |
| `CONNECTOR_TOKEN_ENCRYPTION_KEY` | Clé Fernet stable pour chiffrer les jetons de connecteurs stockés localement. |

Gmail, Drive et Calendar demandent les API correspondantes dans Google Cloud. Le callback local Google est `http://127.0.0.1:8000/api/connectors/google_calendar/callback`. Pour GitHub, configurez une OAuth App avec le callback `http://127.0.0.1:8000/api/connectors/github/callback` et des permissions de lecture. Après configuration, redémarrez l’application et connectez le service depuis **Connecteurs**.

Pour générer la clé de chiffrement, depuis `backend/` :

```bash
uv run python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

## Essayer l’orchestration

Dans une nouvelle conversation, demandez :

> Je reprends une activité physique douce après une longue pause. Je peux consacrer 30 minutes au sport le lundi, le mercredi et le samedi, et je préfère la marche. Propose un programme général sur deux semaines ainsi qu’un planning qui respecte ces créneaux. Vérifie les durées et les jours de repos, indique tes hypothèses et ne crée aucun événement dans mon agenda.

Dans l’exécution, vérifiez le plan, les dépendances, les agents affectés, leurs compétences et la revue du résultat. Dans **Agents**, les profils utilisés doivent être consultables et modifiables. Si le modèle répond sans créer d’exécution, vérifiez `OPENAI_API_KEY`, `OPENAI_MODEL` et les journaux du backend.

### Vérifier le connecteur GitHub

Après avoir configuré et connecté GitHub, activez-le dans le composer et demandez :

> Dans `Sawlyer/Mutual-AId`, donne les cinq issues ouvertes les plus récemment modifiées, avec leur numéro et leur titre. N’effectue aucune modification.

## Fonctionnalités

- Chat avec historique local, réponses en streaming et rendu Markdown.
- Planification des demandes complexes, graphe de tâches, suivi d’exécution et revue du résultat.
- Agents spécialisés réutilisables, avec compétences locales modifiables.
- Connecteurs Google, GitHub et serveurs MCP ; les outils ne sont fournis à l’agent que s’ils sont disponibles et autorisés.
- Tableau d’analyse des exécutions et de l’usage des modèles.

Les connecteurs intégrés sont en lecture seule. L’application ne réalise pas d’écriture externe ni d’exécution automatique non autorisée.

## Vérifications

À la racine du dépôt :

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

Tests backend, depuis `backend/` :

```bash
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest
```
