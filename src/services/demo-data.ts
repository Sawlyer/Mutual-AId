import type { ActivityPoint, Agent, Mission } from '@/types/domain'

export const demoMissions: Mission[] = [
  {
    id: 'MIS-1042',
    name: 'Veille concurrentielle Q4',
    objective: 'Cartographier les nouveautés du marché et leurs signaux faibles.',
    status: 'running',
    agents: ['Scout', 'Analyste'],
    progress: 72,
    updatedAt: 'Il y a 3 min',
  },
  {
    id: 'MIS-1041',
    name: 'Synthèse des retours clients',
    objective: 'Regrouper les retours des 30 derniers jours par thème.',
    status: 'running',
    agents: ['Analyste', 'Rédacteur'],
    progress: 48,
    updatedAt: 'Il y a 12 min',
  },
  {
    id: 'MIS-1040',
    name: 'Préparation du rapport marché',
    objective: 'Préparer une synthèse structurée pour l’équipe stratégie.',
    status: 'queued',
    agents: ['Scout'],
    progress: 0,
    updatedAt: 'Il y a 28 min',
  },
  {
    id: 'MIS-1039',
    name: 'Analyse des tendances produit',
    objective: 'Identifier les opportunités dans les échanges utilisateurs.',
    status: 'completed',
    agents: ['Analyste', 'Rédacteur'],
    progress: 100,
    updatedAt: 'Aujourd’hui, 09:42',
  },
]

export const demoAgents: Agent[] = [
  {
    id: 'agt-scout',
    name: 'Scout',
    role: 'Recherche web',
    model: 'GPT-4.1 mini',
    status: 'active',
    missionsCompleted: 128,
    initials: 'SC',
    tone: 'violet',
  },
  {
    id: 'agt-analyst',
    name: 'Analyste',
    role: 'Analyse & raisonnement',
    model: 'GPT-4.1',
    status: 'active',
    missionsCompleted: 96,
    initials: 'AN',
    tone: 'blue',
  },
  {
    id: 'agt-writer',
    name: 'Rédacteur',
    role: 'Synthèse & rédaction',
    model: 'GPT-4.1',
    status: 'idle',
    missionsCompleted: 84,
    initials: 'RD',
    tone: 'green',
  },
  {
    id: 'agt-reviewer',
    name: 'Vérificateur',
    role: 'Contrôle qualité',
    model: 'GPT-4.1 mini',
    status: 'attention',
    missionsCompleted: 51,
    initials: 'VQ',
    tone: 'amber',
  },
]

export const activityWeek: ActivityPoint[] = [
  { label: 'Lun', missions: 24, tasks: 74 },
  { label: 'Mar', missions: 31, tasks: 92 },
  { label: 'Mer', missions: 27, tasks: 82 },
  { label: 'Jeu', missions: 42, tasks: 118 },
  { label: 'Ven', missions: 36, tasks: 104 },
  { label: 'Sam', missions: 48, tasks: 132 },
  { label: 'Dim', missions: 44, tasks: 124 },
]

export const activityMonth: ActivityPoint[] = [
  { label: '1–4', missions: 82, tasks: 251 },
  { label: '5–8', missions: 96, tasks: 282 },
  { label: '9–12', missions: 88, tasks: 264 },
  { label: '13–16', missions: 112, tasks: 340 },
  { label: '17–20', missions: 104, tasks: 318 },
  { label: '21–24', missions: 128, tasks: 386 },
  { label: '25–28', missions: 144, tasks: 421 },
]

export const recentActivity = [
  { id: 1, title: 'Mission terminée', detail: 'Analyse des tendances produit', time: '09:42', tone: 'success' },
  { id: 2, title: 'Agent a rejoint une mission', detail: 'Analyste · Veille concurrentielle Q4', time: '09:31', tone: 'violet' },
  { id: 3, title: 'Nouvelle mission lancée', detail: 'Synthèse des retours clients', time: '09:18', tone: 'blue' },
  { id: 4, title: 'Vérification requise', detail: 'Vérificateur · Rapport marché', time: '08:56', tone: 'amber' },
] as const
