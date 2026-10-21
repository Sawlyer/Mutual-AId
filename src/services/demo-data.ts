import type {
  ActivityPoint,
  Agent,
  Artifact,
  ExecutionEvent,
  Mission,
  Task,
  ValidationResult,
} from '@/types/domain'

export const demoAgents: Agent[] = [
  {
    id: 'agt-scout', name: 'Scout', role: 'Recherche web',
    description: 'Repère les sources utiles et collecte les informations pertinentes.',
    capabilities: ['Recherche web', 'Collecte de sources', 'Veille'], status: 'active',
    model: 'GPT-4.1 mini', missionsCompleted: 128, initials: 'SC', tone: 'violet',
  },
  {
    id: 'agt-analyst', name: 'Analyste', role: 'Analyse & raisonnement',
    description: 'Structure les données, identifie les tendances et formule des conclusions.',
    capabilities: ['Analyse de données', 'Raisonnement', 'Python'], status: 'active',
    model: 'GPT-4.1', missionsCompleted: 96, initials: 'AN', tone: 'blue',
  },
  {
    id: 'agt-writer', name: 'Rédacteur', role: 'Synthèse & rédaction',
    description: 'Transforme les résultats en livrables clairs et documentés.',
    capabilities: ['Rédaction', 'Synthèse', 'Documentation'], status: 'idle',
    model: 'GPT-4.1', missionsCompleted: 84, initials: 'RD', tone: 'green',
  },
  {
    id: 'agt-reviewer', name: 'Vérificateur', role: 'Contrôle qualité',
    description: 'Vérifie la qualité, les tests et la cohérence des livrables.',
    capabilities: ['Tests', 'Validation', 'Relecture'], status: 'attention',
    model: 'GPT-4.1 mini', missionsCompleted: 51, initials: 'VQ', tone: 'amber',
  },
]

const csvMissionId = 'MIS-1038'
const tasks: Task[] = [
  { id: 'task-csv-01', missionId: csvMissionId, title: 'Définir le schéma et les cas d’usage', description: 'Lister les formats, limites et erreurs à prendre en charge.', status: 'completed', dependencies: [], assignedAgentId: 'agt-analyst', attempts: 1 },
  { id: 'task-csv-02', missionId: csvMissionId, title: 'Construire le parseur CSV', description: 'Gérer séparateurs, encodages, en-têtes et lignes invalides.', status: 'running', dependencies: ['task-csv-01'], assignedAgentId: 'agt-analyst', attempts: 2 },
  { id: 'task-csv-03', missionId: csvMissionId, title: 'Créer les visualisations', description: 'Présenter distributions, tendances et aperçu tabulaire.', status: 'ready', dependencies: ['task-csv-02'], assignedAgentId: 'agt-writer', attempts: 0 },
  { id: 'task-csv-04', missionId: csvMissionId, title: 'Ajouter les tests', description: 'Tester les fichiers valides, vides et mal formés.', status: 'validating', dependencies: ['task-csv-02', 'task-csv-03'], assignedAgentId: 'agt-reviewer', attempts: 1 },
  { id: 'task-csv-05', missionId: csvMissionId, title: 'Rédiger la documentation', description: 'Expliquer l’installation, les formats et les visualisations.', status: 'pending', dependencies: ['task-csv-03', 'task-csv-04'], assignedAgentId: 'agt-writer', attempts: 0 },
  { id: 'task-1042-01', missionId: 'MIS-1042', title: 'Collecter les sources concurrentes', description: 'Identifier les annonces et produits récents.', status: 'completed', dependencies: [], assignedAgentId: 'agt-scout', attempts: 1 },
  { id: 'task-1042-02', missionId: 'MIS-1042', title: 'Comparer les nouveautés', description: 'Comparer les fonctionnalités et les signaux marché.', status: 'running', dependencies: ['task-1042-01'], assignedAgentId: 'agt-analyst', attempts: 1 },
  { id: 'task-1042-03', missionId: 'MIS-1042', title: 'Valider la synthèse', description: 'Vérifier les sources et les conclusions.', status: 'validating', dependencies: ['task-1042-02'], assignedAgentId: 'agt-reviewer', attempts: 1 },
  { id: 'task-1041-01', missionId: 'MIS-1041', title: 'Regrouper les retours', description: 'Classer les verbatims par thème.', status: 'completed', dependencies: [], assignedAgentId: 'agt-analyst', attempts: 1 },
  { id: 'task-1041-02', missionId: 'MIS-1041', title: 'Rédiger les enseignements', description: 'Faire ressortir les irritants et opportunités.', status: 'failed', dependencies: ['task-1041-01'], assignedAgentId: 'agt-writer', attempts: 2 },
  { id: 'task-1040-01', missionId: 'MIS-1040', title: 'Repérer les données de marché', description: 'Collecter les données disponibles et documenter les sources.', status: 'ready', dependencies: [], assignedAgentId: 'agt-scout', attempts: 0 },
  { id: 'task-1040-02', missionId: 'MIS-1040', title: 'Préparer la synthèse', description: 'Assembler les résultats dans un rapport de marché.', status: 'blocked', dependencies: ['task-1040-01'], assignedAgentId: 'agt-writer', attempts: 0 },
  { id: 'task-1039-01', missionId: 'MIS-1039', title: 'Analyser les tendances produit', description: 'Extraire les tendances des échanges utilisateurs.', status: 'completed', dependencies: [], assignedAgentId: 'agt-analyst', attempts: 1 },
  { id: 'task-1039-02', missionId: 'MIS-1039', title: 'Publier le résumé', description: 'Préparer la synthèse finale.', status: 'completed', dependencies: ['task-1039-01'], assignedAgentId: 'agt-writer', attempts: 1 },
  { id: 'task-1037-01', missionId: 'MIS-1037', title: 'Inventorier les retours', description: 'Regrouper les observations de la période.', status: 'paused', dependencies: [], assignedAgentId: 'agt-analyst', attempts: 1 },
]

function progressFor(missionTasks: Task[]) {
  if (missionTasks.length === 0) return 0
  return Math.round((missionTasks.filter((task) => task.status === 'completed').length / missionTasks.length) * 100)
}

function makeMission(id: string, title: string, objective: string, status: Mission['status'], priority: Mission['priority'], createdAt: string): Mission {
  const missionTasks = tasks.filter((task) => task.missionId === id)
  return { id, title, objective, status, priority, createdAt, tasks: missionTasks, progress: progressFor(missionTasks), constraints: '', requestedTasks: [], maxAgents: 4, humanValidationRequired: false, planningMethod: 'demo-template' }
}

export const demoMissions: Mission[] = [
  makeMission(csvMissionId, 'Développer une application d’analyse de fichiers CSV avec visualisations, tests et documentation.', 'Construire une application fiable pour importer des fichiers CSV, explorer leurs données et partager des visualisations utiles.', 'running', 'high', '2026-10-21T08:45:00.000Z'),
  makeMission('MIS-1042', 'Veille concurrentielle Q4', 'Cartographier les nouveautés du marché et leurs signaux faibles.', 'running', 'high', '2026-10-21T08:30:00.000Z'),
  makeMission('MIS-1041', 'Synthèse des retours clients', 'Regrouper les retours des 30 derniers jours par thème.', 'running', 'medium', '2026-10-21T08:10:00.000Z'),
  makeMission('MIS-1040', 'Préparation du rapport marché', 'Préparer une synthèse structurée pour l’équipe stratégie.', 'ready', 'medium', '2026-10-21T07:50:00.000Z'),
  makeMission('MIS-1039', 'Analyse des tendances produit', 'Identifier les opportunités dans les échanges utilisateurs.', 'completed', 'low', '2026-10-20T14:00:00.000Z'),
  makeMission('MIS-1037', 'Audit des demandes entrantes', 'Examiner les demandes et relever les thèmes récurrents.', 'paused', 'low', '2026-10-19T10:15:00.000Z'),
]

export const demoExecutionEvents: ExecutionEvent[] = [
  { id: 'evt-01', missionId: csvMissionId, taskId: 'task-csv-04', agentId: 'agt-reviewer', timestamp: '2026-10-21T09:32:00.000Z', type: 'task.validating', message: 'Validation des cas de test démarrée.' },
  { id: 'evt-02', missionId: 'MIS-1042', taskId: 'task-1042-02', agentId: 'agt-analyst', timestamp: '2026-10-21T09:26:00.000Z', type: 'task.started', message: 'Comparaison des nouveautés en cours.' },
  { id: 'evt-03', missionId: 'MIS-1041', taskId: 'task-1041-02', agentId: 'agt-writer', timestamp: '2026-10-21T09:18:00.000Z', type: 'task.failed', message: 'Synthèse à reprendre : une source manque.' },
  { id: 'evt-04', missionId: 'MIS-1040', taskId: 'task-1040-01', agentId: 'agt-scout', timestamp: '2026-10-21T09:04:00.000Z', type: 'agent.assigned', message: 'Scout affecté à la collecte des sources.' },
  { id: 'evt-05', missionId: 'MIS-1039', taskId: 'task-1039-02', agentId: 'agt-writer', timestamp: '2026-10-21T08:42:00.000Z', type: 'task.completed', message: 'Résumé final publié.' },
]

export const demoArtifacts: Artifact[] = [
  { id: 'artifact-csv-schema', missionId: csvMissionId, taskId: 'task-csv-01', name: 'schema-analyse.csv.md', type: 'markdown', content: 'Schéma de données et cas d’usage pour l’analyse des fichiers CSV.' },
  { id: 'artifact-trend-report', missionId: 'MIS-1039', taskId: 'task-1039-02', name: 'synthese-tendances.md', type: 'markdown', content: 'Synthèse des tendances produit observées dans les échanges utilisateurs.' },
]

export const demoValidationResults: ValidationResult[] = [
  { taskId: 'task-csv-04', status: 'pending', feedback: 'Vérification des tests en cours.' },
  { taskId: 'task-1039-02', status: 'passed', feedback: 'Synthèse relue et validée.' },
  { taskId: 'task-1041-02', status: 'failed', feedback: 'Compléter la source des retours avant nouvelle validation.' },
]

export const activityWeek: ActivityPoint[] = [
  { label: 'Lun', missions: 24, tasks: 74 }, { label: 'Mar', missions: 31, tasks: 92 },
  { label: 'Mer', missions: 27, tasks: 82 }, { label: 'Jeu', missions: 42, tasks: 118 },
  { label: 'Ven', missions: 36, tasks: 104 }, { label: 'Sam', missions: 48, tasks: 132 },
  { label: 'Dim', missions: 44, tasks: 124 },
]

export const activityMonth: ActivityPoint[] = [
  { label: '1–4', missions: 82, tasks: 251 }, { label: '5–8', missions: 96, tasks: 282 },
  { label: '9–12', missions: 88, tasks: 264 }, { label: '13–16', missions: 112, tasks: 340 },
  { label: '17–20', missions: 104, tasks: 318 }, { label: '21–24', missions: 128, tasks: 386 },
  { label: '25–28', missions: 144, tasks: 421 },
]
