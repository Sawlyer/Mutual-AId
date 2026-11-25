import { afterEach, describe, expect, it, vi } from 'vitest'
import { agentService } from '@/services/agent-service'

describe('agent skill service', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('lists skills for the account and creates a bounded plain-text skill', async () => {
    const skill = { id: 'skill-1', user_id: 'user-1', name: 'Citations', description: 'Sources', instructions: 'Cite sources.', enabled: true, created_at: 'now', updated_at: 'now' }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([skill]), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify(skill), { status: 201, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(agentService.listSkills()).resolves.toEqual([skill])
    await expect(agentService.createSkill({ name: 'Citations', description: 'Sources', instructions: 'Cite sources.' })).resolves.toEqual(skill)
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/agent-skills', expect.objectContaining({ credentials: 'include' }))
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/agent-skills', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ name: 'Citations', description: 'Sources', instructions: 'Cite sources.' }),
    }))
  })

  it('updates and deletes owned skills and persists profile skill assignment', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'skill-1', enabled: false }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'agent-1', skill_ids: ['skill-1'] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    await agentService.updateSkill('skill-1', { enabled: false })
    await agentService.deleteSkill('skill-1')
    await agentService.update('agent-1', { skill_ids: ['skill-1'] })

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/agent-skills/skill-1', expect.objectContaining({ method: 'PATCH' }))
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/agent-skills/skill-1', expect.objectContaining({ method: 'DELETE' }))
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/agents/agent-1', expect.objectContaining({ body: JSON.stringify({ skill_ids: ['skill-1'] }) }))
  })
})

describe('agent profile detail service', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('getProfile_uses_the_profile_endpoint', async () => {
    const profile = { id: 'agent-1', name: 'Conseiller santé' }
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(profile), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(agentService.getProfile('agent-1')).resolves.toEqual(profile)
    expect(fetchMock).toHaveBeenCalledWith('/api/agents/agent-1', expect.objectContaining({ credentials: 'include' }))
  })

  it('setMcpTools_sends_the_selected_grants', async () => {
    const tools = [{ server_id: 'github', tool_name: 'list_issues' }]
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ tools }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(agentService.setMcpTools('agent-1', tools)).resolves.toEqual({ tools })
    expect(fetchMock).toHaveBeenCalledWith('/api/agents/agent-1/mcp-tools', expect.objectContaining({
      method: 'PUT', credentials: 'include', body: JSON.stringify({ tools }),
    }))
  })

  it('installMarketplaceSkill_can_assign_to_a_profile', async () => {
    const skill = { id: 'skill-1', name: 'Analyse' }
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(skill), {
      status: 201, headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(agentService.installMarketplaceSkill('csv-analysis', 'agent-1')).resolves.toEqual(skill)
    expect(fetchMock).toHaveBeenCalledWith('/api/skill-marketplace/csv-analysis/install', expect.objectContaining({
      method: 'POST', credentials: 'include', body: JSON.stringify({ profile_id: 'agent-1' }),
    }))
  })
})
