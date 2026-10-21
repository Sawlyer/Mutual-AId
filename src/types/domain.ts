export type WorkStatus =
  | 'pending'
  | 'ready'
  | 'running'
  | 'validating'
  | 'completed'
  | 'failed'
  | 'blocked'
  | 'paused'

export type MissionStatus = Exclude<WorkStatus, 'validating'>
export type TaskStatus = WorkStatus
export type MissionPriority = 'low' | 'medium' | 'high' | 'urgent'
export type AgentStatus = 'active' | 'idle' | 'attention' | 'paused'

export interface Task {
  id: string
  missionId: string
  title: string
  description: string
  status: TaskStatus
  dependencies: string[]
  assignedAgentId: string | null
  attempts: number
  requiredSkills?: string[]
  parallelGroupId?: string
}

export interface Mission {
  id: string
  title: string
  objective: string
  status: MissionStatus
  createdAt: string
  tasks: Task[]
  priority: MissionPriority
  progress: number
  constraints: string
  requestedTasks: string[]
  maxAgents: number
  humanValidationRequired: boolean
  planningMethod: 'user-defined' | 'demo-template'
}

export interface Agent {
  id: string
  name: string
  role: string
  description: string
  capabilities: string[]
  status: AgentStatus
  model: string
  missionsCompleted: number
  initials: string
  tone: 'violet' | 'blue' | 'green' | 'amber'
}

export type ExecutionEventType =
  | 'mission.created'
  | 'task.started'
  | 'task.validating'
  | 'task.completed'
  | 'task.failed'
  | 'agent.assigned'

export interface ExecutionEvent {
  id: string
  missionId: string
  taskId?: string
  agentId?: string
  timestamp: string
  type: ExecutionEventType
  message: string
}

export type ArtifactType = 'csv' | 'markdown' | 'json' | 'image' | 'other'

export interface Artifact {
  id: string
  missionId: string
  taskId?: string
  name: string
  type: ArtifactType
  content: string
}

export interface ValidationResult {
  taskId: string
  status: 'pending' | 'passed' | 'failed'
  feedback: string
}

export interface ActivityPoint {
  label: string
  missions: number
  tasks: number
}

export interface CreateMissionInput {
  title: string
  objective: string
  priority: MissionPriority
  constraints: string
  requestedTasks: string[]
  maxAgents: number
  humanValidationRequired: boolean
  planningMethod: Mission['planningMethod']
  tasks: PlannedTaskInput[]
}

export interface PlannedTaskInput {
  draftId: string
  title: string
  description: string
  dependencies: string[]
  assignedAgentId: string | null
  requiredSkills: string[]
  parallelGroupId?: string
}
