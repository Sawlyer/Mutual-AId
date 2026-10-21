import { demoMissions } from '@/services/demo-data'
import type { CreateMissionInput, Mission } from '@/types/domain'

/** Replace this adapter with an HTTP-backed implementation when the API exists. */
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
    const mission: Mission = {
      id: `MIS-${Date.now().toString().slice(-4)}`,
      name: input.name.trim(),
      objective: input.objective.trim(),
      status: 'queued',
      agents: [],
      progress: 0,
      updatedAt: 'À l’instant',
    }
    missions = [mission, ...missions]
    return mission
  },
}
