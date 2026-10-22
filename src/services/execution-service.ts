import type { Execution, ExecutionEvent } from '@/types/execution'

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

export const executionService = {
  list: () => request<Execution[]>('/executions'),
  get: (id: string) => request<Execution>(`/executions/${encodeURIComponent(id)}`),
  listEvents: (id: string, afterId?: number) => request<ExecutionEvent[]>(`/executions/${encodeURIComponent(id)}/events${afterId === undefined ? '' : `?after_id=${afterId}`}`),
  decide: (id: string, approvalId: string, decision: 'approve' | 'reject') => request<Execution>(`/executions/${encodeURIComponent(id)}/approvals/${encodeURIComponent(approvalId)}`, { method: 'POST', body: JSON.stringify({ decision }) }),
  cancel: (id: string) => request<Execution>(`/executions/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),
}
