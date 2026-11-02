import type { Execution, ExecutionArtifact, ExecutionArtifactContent, ExecutionEvent } from '@/types/execution'

const baseUrl = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '')

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    credentials: 'include', ...init,
    headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { detail?: string }
    throw new Error(body.detail || (response.status === 404 ? 'Exécution introuvable.' : 'La demande a échoué.'))
  }
  return await response.json() as T
}

export interface ExecutionEventHandlers {
  onEvent: (event: ExecutionEvent) => void
  onTerminal: (state: { id: string; status: Execution['status'] }) => void
  onConnectionChange?: (connected: boolean) => void
}

function parseEvent<T>(event: Event): T | null {
  try {
    return JSON.parse((event as MessageEvent<string>).data) as T
  } catch {
    return null
  }
}

export const executionService = {
  list: () => request<Execution[]>('/executions'),
  get: (id: string) => request<Execution>(`/executions/${encodeURIComponent(id)}`),
  listEvents: (id: string, afterId?: number, limit = 200) => {
    const query = new URLSearchParams()
    if (limit !== 200) query.set('limit', String(limit))
    if (afterId !== undefined) query.set('after_id', String(afterId))
    const search = query.size ? `?${query.toString()}` : ''
    return request<ExecutionEvent[]>(`/executions/${encodeURIComponent(id)}/events${search}`)
  },
  listAllEvents: async (id: string) => {
    const events: ExecutionEvent[] = []
    let cursor: number | undefined
    const pageSize = 500
    while (true) {
      const page = await executionService.listEvents(id, cursor, pageSize)
      events.push(...page)
      if (page.length < pageSize) return events
      const nextCursor = page.at(-1)?.id
      if (nextCursor === undefined || nextCursor === cursor) return events
      cursor = nextCursor
    }
  },
  listArtifacts: (id: string) => request<ExecutionArtifact[]>(`/executions/${encodeURIComponent(id)}/artifacts`),
  getArtifact: (id: string, artifactId: string) => request<ExecutionArtifactContent>(`/executions/${encodeURIComponent(id)}/artifacts/${encodeURIComponent(artifactId)}`),
  subscribe: (id: string, handlers: ExecutionEventHandlers, afterId = 0) => {
    const source = new EventSource(`${baseUrl}/executions/${encodeURIComponent(id)}/stream?after_id=${afterId}`, { withCredentials: true })
    source.addEventListener('open', () => handlers.onConnectionChange?.(true))
    source.addEventListener('error', () => handlers.onConnectionChange?.(false))
    source.addEventListener('execution.event', (event) => {
      const payload = parseEvent<ExecutionEvent>(event)
      if (payload && Number.isInteger(payload.id) && payload.event_type) handlers.onEvent(payload)
    })
    source.addEventListener('execution.terminal', (event) => {
      const payload = parseEvent<{ id: string; status: Execution['status'] }>(event)
      source.close()
      if (payload) handlers.onTerminal(payload)
    })
    return () => source.close()
  },
  decide: (id: string, approvalId: string, decision: 'approve' | 'reject') => request<Execution>(`/executions/${encodeURIComponent(id)}/approvals/${encodeURIComponent(approvalId)}`, { method: 'POST', body: JSON.stringify({ decision }) }),
  cancel: (id: string) => request<Execution>(`/executions/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),
  resume: (id: string) => request<Execution>(`/executions/${encodeURIComponent(id)}/resume`, { method: 'POST' }),
}
