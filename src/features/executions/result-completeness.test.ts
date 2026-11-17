import { describe, expect, it } from 'vitest'
import { inspectResultCompleteness } from '@/features/executions/result-completeness'

describe('inspectResultCompleteness', () => {
  it('verifies completed tasks only when each has a saved non-empty result artifact', () => {
    const tasks = [
      { id: 'task-a', status: 'completed', result: 'Rapport' },
      { id: 'task-b', status: 'completed', result: 'Tableau' },
    ] as const
    const artifacts = [{ task_id: 'task-a' }, { task_id: 'task-b' }]

    expect(inspectResultCompleteness('completed', tasks, artifacts)).toEqual({
      status: 'complete',
      completedTasks: 2,
      totalTasks: 2,
      missingTaskIds: [],
    })
  })

  it('reports completed tasks with missing outputs or artifacts as incomplete', () => {
    const tasks = [
      { id: 'task-a', status: 'completed', result: 'Rapport' },
      { id: 'task-b', status: 'completed', result: ' ' },
    ] as const

    expect(inspectResultCompleteness('completed', tasks, [{ task_id: 'task-a' }])).toEqual({
      status: 'partial',
      completedTasks: 2,
      totalTasks: 2,
      missingTaskIds: ['task-b'],
    })
  })

  it('does not claim completion while the execution is still running', () => {
    expect(inspectResultCompleteness('running', [
      { id: 'task-a', status: 'running', result: null },
    ], [])).toEqual({
      status: 'pending',
      completedTasks: 0,
      totalTasks: 1,
      missingTaskIds: ['task-a'],
    })
  })

  it('keeps structural outputs complete while the independent review is running', () => {
    expect(inspectResultCompleteness('validating', [
      { id: 'task-a', status: 'completed', result: 'Rapport' },
    ], [{ task_id: 'task-a' }])).toEqual({
      status: 'complete',
      completedTasks: 1,
      totalTasks: 1,
      missingTaskIds: [],
    })
  })
})
