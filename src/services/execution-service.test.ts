import { afterEach, describe, expect, it, vi } from 'vitest'
import { executionService } from '@/services/execution-service'

afterEach(() => vi.unstubAllGlobals())

describe('executionService', () => {
  it('replays events after a persisted cursor with credentials', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    await executionService.listEvents('execution /1', 42)
    expect(fetchMock).toHaveBeenCalledWith('/api/executions/execution%20%2F1/events?after_id=42', expect.objectContaining({ credentials: 'include' }))
  })

  it('submits an explicit approval decision', async () => {
    const response = { id: 'execution-1', tasks: [] }
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(response), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    await executionService.decide('execution-1', 'approval-1', 'approve')
    expect(fetchMock).toHaveBeenCalledWith('/api/executions/execution-1/approvals/approval-1', expect.objectContaining({ method: 'POST', body: '{"decision":"approve"}' }))
  })
})
