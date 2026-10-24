# Frontend

S’applique au code sous `src/`.

- Importer le code du dépôt avec l’alias `@/` (`tsconfig.app.json`), pas par des chemins relatifs longs.
- Une page vit dans `src/pages/`. L’UI d’un domaine vit dans `src/features/<domaine>/`.
- Déclarer la route dans `src/app/router.tsx`. Les anciennes routes `dashboard` et `missions/*` redirigent vers `/`.
- Les appels HTTP passent par `src/services/`. Envoyer le cookie de session avec `credentials: 'include'`. La base est `VITE_API_BASE_URL` ou `/api`.
- Ne jamais lire `OPENAI_API_KEY` ni un secret OAuth côté Vite. Seules les variables `VITE_` publiques sont admissibles.
- L’état partagé va dans `src/stores/`. Les types d’API restent à côté du service qui les consomme.

```typescript
const response = await fetch(`${baseUrl}/conversations`, { credentials: 'include' })
```
