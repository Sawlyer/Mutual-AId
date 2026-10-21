# Mutual-AId

Socle frontend d’une plateforme de démonstration pour orchestrer des agents IA. L’interface est construite avec React, TypeScript, Vite, Tailwind CSS v4 et shadcn/ui. Les données sont simulées ; aucune API OpenAI n’est connectée.

## Démarrer

```bash
npm install
npm run dev
```

## Commandes

- `npm run dev` : serveur Vite
- `npm run typecheck` : vérification TypeScript
- `npm run lint` : ESLint
- `npm run build` : compilation de production
- `npm run preview` : aperçu de la compilation

## Architecture

- `src/app` : configuration du routeur
- `src/components/layout` : navigation et structure de page
- `src/components/ui` : composants d’interface partagés
- `src/features` : composants propres aux fonctionnalités
- `src/pages` : pages routées
- `src/services` : données et service de démonstration
- `src/stores` : état global Zustand
- `src/types` : types du domaine
- `src/lib` : utilitaires

## Pages disponibles

Dashboard, Missions, détail d’une mission, création, Agents, Analytics et Paramètres. Le planificateur applique des modèles déterministes de démonstration ; aucun LLM ni backend n’est connecté. Les missions et événements créés sont mémorisés dans le stockage local du navigateur.
