export type MissionStatus = 'running' | 'queued' | 'completed' | 'paused'

export interface Mission {
  id: string
  name: string
  objective: string
  status: MissionStatus
  agents: string[]
  progress: number
  updatedAt: string
}

export type AgentStatus = 'active' | 'idle' | 'attention'

export interface Agent {
  id: string
  name: string
  role: string
  model: string
  status: AgentStatus
  missionsCompleted: number
  initials: string
  tone: 'violet' | 'blue' | 'green' | 'amber'
}

export interface ActivityPoint {
  label: string
  missions: number
  tasks: number
}

export interface CreateMissionInput {
  name: string
  objective: string
}
