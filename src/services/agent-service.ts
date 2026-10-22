import type { AgentCatalog, AgentProfile, AgentProfileInput, AgentSkill, AgentSkillInput, AgentSkillUpdate } from '@/types/agent'

const baseUrl = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '')

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    credentials: 'include',
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  })
  if (!response.ok) {
    const data = await response.json().catch(() => ({})) as { detail?: string }
    throw new Error(data.detail || 'La demande a échoué. Réessayez.')
  }
  if (response.status === 204) return undefined as T
  return await response.json() as T
}

export const agentService = {
  list: () => request<AgentCatalog>('/agents'),
  create: (input: AgentProfileInput) => request<AgentProfile>('/agents', { method: 'POST', body: JSON.stringify(input) }),
  update: (id: string, input: Partial<AgentProfileInput>) => request<AgentProfile>(`/agents/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) }),
  remove: (id: string) => request<void>(`/agents/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  listSkills: () => request<AgentSkill[]>('/agent-skills'),
  createSkill: (input: AgentSkillInput) => request<AgentSkill>('/agent-skills', { method: 'POST', body: JSON.stringify(input) }),
  updateSkill: (id: string, input: AgentSkillUpdate) => request<AgentSkill>(`/agent-skills/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) }),
  deleteSkill: (id: string) => request<void>(`/agent-skills/${encodeURIComponent(id)}`, { method: 'DELETE' }),
}
