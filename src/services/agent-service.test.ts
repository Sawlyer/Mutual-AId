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
