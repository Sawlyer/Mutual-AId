import type { Execution, ExecutionArtifact, ExecutionTask } from '@/types/execution'

type TaskSummary = Readonly<Pick<ExecutionTask, 'id' | 'status' | 'result'>>
type ArtifactReference = Readonly<Pick<ExecutionArtifact, 'task_id'>>

export interface ResultCompleteness {
  status: 'complete' | 'partial' | 'pending'
  completedTasks: number
  totalTasks: number
  missingTaskIds: string[]
}

const terminalStatuses = new Set<Execution['status']>(['completed', 'partial', 'failed', 'cancelled', 'interrupted'])

export function inspectResultCompleteness(
  executionStatus: Execution['status'],
  tasks: readonly TaskSummary[],
  artifacts: readonly ArtifactReference[],
): ResultCompleteness {
  const completedTasks = tasks.filter((task) => task.status === 'completed').length
  const missingTaskIds = tasks
    .filter((task) => task.status !== 'completed' || !task.result?.trim() || !artifacts.some((artifact) => artifact.task_id === task.id))
    .map((task) => task.id)
  const isComplete = tasks.length > 0 && missingTaskIds.length === 0

  return {
    status: isComplete ? 'complete' : terminalStatuses.has(executionStatus) ? 'partial' : 'pending',
    completedTasks,
    totalTasks: tasks.length,
    missingTaskIds,
  }
}
