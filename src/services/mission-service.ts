import { demoMissions } from '@/services/demo-data'
import type { CreateMissionInput, Mission, Task } from '@/types/domain'

/** In-memory demo adapter. Replace with an HTTP-backed service when backend exists. */
export interface MissionService {
  list(): Promise<Mission[]>
  create(input: CreateMissionInput): Promise<Mission>
}

let missions = [...demoMissions]

export const demoMissionService: MissionService = {
  async list() {
    return missions
  },
  async create(input) {
    const id = `MIS-${Date.now()}`
    const taskIds = new Map(input.tasks.map((task, index) => [task.draftId, `${id}-T${index + 1}`]))
    const plannedTasks: Task[] = input.tasks.map((task, index) => ({
      id: `${id}-T${index + 1}`,
      missionId: id,
      title: task.title.trim(),
      description: task.description.trim(),
      status: task.dependencies.length === 0 ? 'ready' : 'pending',
      dependencies: task.dependencies.map((dependency) => taskIds.get(dependency)).filter((dependency): dependency is string => Boolean(dependency)),
      assignedAgentId: task.assignedAgentId,
      attempts: 0,
      requiredSkills: task.requiredSkills,
      ...(task.parallelGroupId ? { parallelGroupId: task.parallelGroupId } : {}),
    }))
    const mission: Mission = {
      id,
      title: input.title.trim(),
      objective: input.objective.trim(),
      status: plannedTasks.some((task) => task.status === 'ready') ? 'ready' : 'pending',
      createdAt: new Date().toISOString(),
      tasks: plannedTasks,
      priority: input.priority,
      progress: plannedTasks.length ? Math.round((plannedTasks.filter((task) => task.status === 'completed').length / plannedTasks.length) * 100) : 0,
      constraints: input.constraints.trim(),
      requestedTasks: input.requestedTasks,
      maxAgents: input.maxAgents,
      humanValidationRequired: input.humanValidationRequired,
      planningMethod: input.planningMethod,
    }
    missions = [mission, ...missions]
    return mission
  },
}
