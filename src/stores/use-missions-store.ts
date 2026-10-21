import { create } from 'zustand'
import { demoMissions } from '@/services/demo-data'
import { demoMissionService } from '@/services/mission-service'
import type { CreateMissionInput, Mission } from '@/types/domain'

interface MissionsState {
  missions: Mission[]
  isLoading: boolean
  loadMissions: () => Promise<void>
  createMission: (input: CreateMissionInput) => Promise<void>
}

export const useMissionsStore = create<MissionsState>((set) => ({
  missions: demoMissions,
  isLoading: false,
  loadMissions: async () => {
    set({ isLoading: true })
    const missions = await demoMissionService.list()
    set({ missions, isLoading: false })
  },
  createMission: async (input) => {
    const mission = await demoMissionService.create(input)
    set((state) => ({ missions: [mission, ...state.missions] }))
  },
}))
