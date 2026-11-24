import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { WorkflowGraph } from './workflow-graph'
import type { Execution } from '@/types/execution'

const execution: Execution = {
  id: 'execution-1',
  conversation_id: 'conversation-1',
  status: 'completed',
  summary: 'Test workflow',
  tasks: [{
    id: 'task-1', title: 'Analyse', description: '', dependencies: [], capability_ids: [],
    agent_profile_id: null, connector_ids: [], expected_output: '', approval_required: false,
    status: 'completed', attempts: 1, result: null, error: null,
  }],
  result_review_status: 'skipped', result_review_feedback: null,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
}

describe('WorkflowGraph', () => {
  it('keeps graph controls while hiding the minimap', () => {
    const markup = renderToStaticMarkup(<WorkflowGraph execution={execution} />)

    expect(markup).toContain('react-flow__controls')
    expect(markup).not.toContain('react-flow__minimap')
  })
})
