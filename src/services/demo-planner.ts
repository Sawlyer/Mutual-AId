import { demoAgents } from '@/services/demo-data'
import type { PlannedTaskInput } from '@/types/domain'

export interface DemoPlanInput {
  objective: string
  requestedTasks: string[]
  maxAgents: number
}

function matchingSkills(value: string): string[] {
  const text = value.toLocaleLowerCase('fr')
  const skills: string[] = []
  if (/csv|donn|data|analyse|fichier|tableur/.test(text)) skills.push('Analyse de données')
  if (/test|validation|vérifi|qualit/.test(text)) skills.push('Tests')
  if (/document|guide|rapport|synthèse|rédig/.test(text)) skills.push('Documentation')
  if (/recherche|source|veille|web/.test(text)) skills.push('Recherche web')
  if (/visual|graphique|interface|maquette/.test(text)) skills.push('Synthèse')
  if (/application|développ|code|implément|parser|parseur/.test(text)) skills.push('Python')
  return [...new Set(skills)]
}

function skillsFor(title: string, objective: string): string[] {
  const taskSkills = matchingSkills(title)
  if (taskSkills.length) return taskSkills
  const objectiveSkills = matchingSkills(objective).slice(0, 2)
  return objectiveSkills.length ? objectiveSkills : ['Analyse de données']
}

export function generateDemoPlan({ objective, requestedTasks, maxAgents }: DemoPlanInput): PlannedTaskInput[] {
  const userDefined = requestedTasks.map((title) => title.trim()).filter(Boolean)
  const taskTitles = userDefined.length ? userDefined : [
    'Analyser l’objectif et préparer les données',
    'Réaliser le travail demandé',
    'Vérifier les résultats et préparer les livrables',
  ]
  const assignments = new Map<string, number>()
  const selectedAgentIds = new Set<string>()
  const sharedParallelGroup = userDefined.length > 1 && maxAgents > 1 ? 'parallel-user-tasks' : undefined

  return taskTitles.map((title, index) => {
    const requiredSkills = skillsFor(title, objective)
    const allowedAgents = selectedAgentIds.size < maxAgents
      ? demoAgents
      : demoAgents.filter((agent) => selectedAgentIds.has(agent.id))
    const candidates = allowedAgents.map((agent) => ({
      agent,
      score: agent.capabilities.filter((capability) => requiredSkills.includes(capability)).length,
      workload: assignments.get(agent.id) ?? 0,
    })).sort((a, b) => b.score - a.score || a.workload - b.workload || a.agent.id.localeCompare(b.agent.id))
    const selectedAgent = candidates[0]?.agent
    if (selectedAgent) {
      selectedAgentIds.add(selectedAgent.id)
      assignments.set(selectedAgent.id, (assignments.get(selectedAgent.id) ?? 0) + 1)
    }

    return {
      draftId: `plan-task-${index + 1}`,
      title,
      description: userDefined.length
        ? 'Tâche définie par l’utilisateur. Ajoutez ici les instructions précises pour l’agent.'
        : index === 0
          ? `Clarifier le périmètre et les informations nécessaires : ${objective}`
          : index === 1
            ? `Produire le résultat principal attendu : ${objective}`
            : 'Vérifier la qualité du résultat et préparer les livrables finaux.',
      dependencies: userDefined.length ? [] : index === 0 ? [] : [`plan-task-${index}`],
      assignedAgentId: selectedAgent?.id ?? null,
      requiredSkills,
      ...(sharedParallelGroup ? { parallelGroupId: sharedParallelGroup } : {}),
    }
  })
}
