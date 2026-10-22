export type ExecutionStatus = 'planning' | 'running' | 'awaiting_approval' | 'completed' | 'partial' | 'failed' | 'cancelled' | 'interrupted'
export type ExecutionTaskStatus = 'pending' | 'ready' | 'running' | 'awaiting_approval' | 'validating' | 'completed' | 'failed' | 'blocked' | 'paused' | 'interrupted' | 'cancelled'

export interface ExecutionTask {
  id: string
  title: string
  description: string
  dependencies: string[]
  capability_ids: string[]
  agent_profile_id: string | null
  agent_profile_snapshot?: Record<string, unknown> | null
  connector_ids: string[]
  expected_output: string
  approval_required: boolean
  approval_id?: string | null
  status: ExecutionTaskStatus
  result: string | null
  error: string | null
}

export interface Execution {
  id: string
  conversation_id: string
  status: ExecutionStatus
  summary: string
  tasks: ExecutionTask[]
  created_at: string
  updated_at: string
}

export interface ExecutionEvent {
  id: number
  task_id: string | null
  event_type: string
  message: string
  created_at: string
}
