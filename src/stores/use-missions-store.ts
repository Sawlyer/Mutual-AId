import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { demoExecutionEvents, demoMissions } from '@/services/demo-data'
import { demoMissionService } from '@/services/mission-service'
import type { CreateMissionInput, ExecutionEvent, Mission } from '@/types/domain'

interface MissionsState {
  missions: Mission[]
  events: ExecutionEvent[]
  isLoading: boolean
  loadMissions: () => Promise<void>
  createMission: (input: CreateMissionInput) => Promise<Mission>
}

export const useMissionsStore = create<MissionsState>()(persist((set) => ({
    missions: demoMissions,
    events: demoExecutionEvents,
    isLoading: false,
    loadMissions: async () => {
      set({ isLoading: true })
      const missions = await demoMissionService.list()
      set((state) => ({ missions: state.missions.length ? state.missions : missions, isLoading: false }))
    },
    createMission: async (input) => {
      const mission = await demoMissionService.create(input)
      const event: ExecutionEvent = {
        id: `evt-${mission.id}`,
        missionId: mission.id,
        taskId: mission.tasks[0]?.id,
        agentId: mission.tasks[0]?.assignedAgentId ?? undefined,
        timestamp: mission.createdAt,
        type: 'mission.created',
        message: 'Mission créée et ajoutée à la file de démonstration.',
      }
      set((state) => ({
        missions: [mission, ...state.missions],
        events: [event, ...state.events],
      }))
      return mission
    },
  }), {
    name: 'mutual-aid-demo-missions',
    storage: createJSONStorage(() => localStorage),
    partialize: (state) => ({ missions: state.missions, events: state.events }),
  }))
