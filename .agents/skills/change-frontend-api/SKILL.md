---
name: change-frontend-api
description: Modifie ensemble un service frontend et le contrat FastAPI sans casser le cookie de session. Use when changing an API route, a request payload, a service in src/services, or a conversation endpoint.
---

# Contrat frontend et API

Un changement de payload se fait des deux côtés dans le même passage.

## Étapes

1. Côté backend, ajuster le schéma Pydantic dans `backend/app/schemas.py` et la route dans `backend/app/main.py`. La session reste le cookie HttpOnly posé par `backend/app/auth.py`. Ne pas accepter un `user_id` dans le corps.
2. Côté frontend, modifier le service dans `src/services/`. Conserver `credentials: 'include'` et la base `VITE_API_BASE_URL` ou `/api`, comme `src/services/auth-service.ts`.
3. Si l’écran change de chemin, mettre à jour `src/app/router.tsx` sans réactiver `/dashboard` ni `/missions/*` autrement que par redirection vers `/`.
4. Étendre `make_client` dans `backend/tests/test_api.py` (ou le fichier de test du domaine) pour le nouveau statut et le nouveau corps.
5. Si le parsing de la réponse vit dans `src/services/`, ajuster le test Vitest colocaté `*.test.ts`.
6. Vérifier :

```bash
npm run typecheck
npm run test
```

Puis, depuis `backend/` :

```bash
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest
```

Les erreurs renvoyées au client restent des messages courts. Pas de clé, de stack trace ni de raisonnement de modèle dans le JSON ou le SSE.
