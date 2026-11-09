import type { AgentCatalog, AgentProfile, AgentProfileInput, AgentSkill, AgentSkillInput, AgentSkillUpdate, SkillCatalogComparison, SkillCatalogItem, SkillUpgradeResult } from '@/types/agent'

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
  searchSkillMarketplace: (query = '', category = '') => {
    const params = new URLSearchParams()
    if (query) params.set('query', query)
    if (category) params.set('category', category)
    return request<SkillCatalogItem[]>(`/skill-marketplace${params.size ? `?${params.toString()}` : ''}`)
  },
  installMarketplaceSkill: (catalogId: string, profileId?: string) => request<AgentSkill>(`/skill-marketplace/${encodeURIComponent(catalogId)}/install`, { method: 'POST', body: JSON.stringify({ profile_id: profileId }) }),
  compareCatalogSkill: (skillId: string, version?: number) => request<SkillCatalogComparison>(`/agent-skills/${encodeURIComponent(skillId)}/comparison${version ? `?version=${version}` : ''}`),
  upgradeCatalogSkill: (skillId: string, strategy: 'keep_customizations' | 'replace_customizations' = 'keep_customizations', targetVersion?: number) => request<SkillUpgradeResult>(`/agent-skills/${encodeURIComponent(skillId)}/upgrade`, { method: 'POST', body: JSON.stringify({ strategy, target_version: targetVersion }) }),
  createGeneratedSkill: (input: AgentSkillInput) => request<AgentSkill>('/agent-skills/generated', { method: 'POST', body: JSON.stringify(input) }),
  reviewGeneratedSkill: (skillId: string, decision: 'approved' | 'rejected') => request<AgentSkill>(`/agent-skills/${encodeURIComponent(skillId)}/review`, { method: 'POST', body: JSON.stringify({ decision }) }),
  skillAudit: () => request<Array<{ id: number; skill_id: string; profile_id: string | null; action: string; details: Record<string, unknown>; created_at: string }>>('/agent-skills/audit'),
  createSkill: (input: AgentSkillInput) => request<AgentSkill>('/agent-skills', { method: 'POST', body: JSON.stringify(input) }),
  updateSkill: (id: string, input: AgentSkillUpdate) => request<AgentSkill>(`/agent-skills/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) }),
  deleteSkill: (id: string) => request<void>(`/agent-skills/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  listMcpTools: (profileId: string) => request<{ tools: { server_id: string; tool_name: string }[] }>(`/agents/${encodeURIComponent(profileId)}/mcp-tools`),
  setMcpTools: (profileId: string, tools: { server_id: string; tool_name: string }[]) => request<{ tools: { server_id: string; tool_name: string }[] }>(`/agents/${encodeURIComponent(profileId)}/mcp-tools`, { method: 'PUT', body: JSON.stringify({ tools }) }),
}
