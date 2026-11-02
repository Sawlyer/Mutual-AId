import { afterEach, describe, expect, it, vi } from 'vitest'
import { executionService, type ExecutionEventHandlers } from '@/services/execution-service'

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

  it('resumes an interrupted execution with session credentials', async () => {
    const response = { id: 'execution-1', status: 'running' }
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(response), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await executionService.resume('execution-1')

    expect(fetchMock).toHaveBeenCalledWith('/api/executions/execution-1/resume', expect.objectContaining({
      method: 'POST',
      credentials: 'include',
    }))
  })

  it('streams persisted execution events and closes on terminal state', () => {
    class MockEventSource extends EventTarget {
      static instance: MockEventSource
      closed = false
      withCredentials = false
      readonly url: string
      constructor(url: string, options?: EventSourceInit) {
        super()
        this.url = url
        this.withCredentials = options?.withCredentials ?? false
        MockEventSource.instance = this
      }
      close() { this.closed = true }
    }
    vi.stubGlobal('EventSource', MockEventSource)
    const handlers: ExecutionEventHandlers = {
      onEvent: vi.fn(),
      onTerminal: vi.fn(),
      onConnectionChange: vi.fn(),
    }

    const unsubscribe = executionService.subscribe('execution-1', handlers)
    const source = MockEventSource.instance
    source.dispatchEvent(new MessageEvent('execution.event', {
      data: JSON.stringify({ id: 7, task_id: 'task-1', agent_id: 'agent-alpha', event_type: 'task.started', status: 'running', message: 'Démarrée', created_at: 'now' }),
    }))
    source.dispatchEvent(new MessageEvent('execution.terminal', { data: JSON.stringify({ id: 'execution-1', status: 'completed' }) }))

    expect(source.url).toBe('/api/executions/execution-1/stream?after_id=0')
    expect(source.withCredentials).toBe(true)
    expect(handlers.onEvent).toHaveBeenCalledWith(expect.objectContaining({
      id: 7,
      event_type: 'task.started',
      agent_id: 'agent-alpha',
      status: 'running',
    }))
    expect(handlers.onTerminal).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }))
    expect(source.closed).toBe(true)
    unsubscribe()
  })

  it('lists and reads execution artifacts with session credentials', async () => {
    const payload = [{ id: 'artifact-1', task_id: 'task-1', name: 'Résultat', media_type: 'text/plain', created_at: 'now' }]
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(payload), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...payload[0], content: 'rapport' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await executionService.listArtifacts('execution-1')
    await executionService.getArtifact('execution-1', 'artifact-1')

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/executions/execution-1/artifacts', expect.objectContaining({ credentials: 'include' }))
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/executions/execution-1/artifacts/artifact-1', expect.objectContaining({ credentials: 'include' }))
  })

  it('loads the full event history using stable cursors', async () => {
    const firstPage = Array.from({ length: 500 }, (_, index) => ({
      id: index + 1,
      task_id: null,
      agent_id: null,
      event_type: 'task.updated',
      status: 'running',
      message: 'Mise à jour',
      created_at: 'now',
    }))
    const lastEvent = { id: 501, task_id: null, agent_id: null, event_type: 'execution.completed', status: 'completed', message: 'Terminé', created_at: 'now' }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(firstPage), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([lastEvent]), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const events = await executionService.listAllEvents('execution-1')

    expect(events).toHaveLength(501)
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/executions/execution-1/events?limit=500&after_id=500', expect.anything())
  })
})
