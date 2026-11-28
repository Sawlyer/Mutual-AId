import { describe, expect, it } from 'vitest'
import { rankMcpTools, rankMarketplaceSkills } from './resource-recommendations'
import type { AgentProfile, SkillCatalogItem } from '@/types/agent'
import type { McpServerRecord } from '@/services/chat-adapters'

const profile: AgentProfile = {
  id: 'agent-planning', user_id: 'local', name: 'Planificateur d’agenda', domain: 'planning',
  description: 'Organise les cours et les horaires dans un agenda.',
  instructions: 'Repère les conflits et propose un planning réaliste.', capability_ids: ['schedule_planning'],
  enabled: true, origin: 'auto_created', template_version: 2, created_at: '', updated_at: '', skill_ids: [], skills: [],
}

function skill(id: string, category: string, tags: string[]): SkillCatalogItem {
  return { id, name: id, category, tags, description: '', instructions: '', version: 1, author: '', source: '', updated_at: '', installed: false }
}

describe('resource recommendations', () => {
  it('ranks locally relevant marketplace skills above unrelated skills', () => {
    const ranked = rankMarketplaceSkills(profile, [
      skill('planning.realistic-schedule', 'planning', ['agenda', 'priorités']),
      skill('writing.clear-briefs', 'writing', ['rédaction']),
    ])

    expect(ranked.map(({ item }) => item.id)).toEqual(['planning.realistic-schedule'])
    expect(ranked[0].matchedTerms).toContain('agenda')
  })

  it('suggests only enabled, ready, approved read-only MCP tools with a relevant description', () => {
    const server: McpServerRecord = {
      id: 'calendar', name: 'Agenda MCP', url: 'https://example.test', status: 'ready', enabled: true,
      catalog_id: null, approved_tool_names: ['list_events', 'create_event'], last_checked_at: null, last_error: null,
      tools: [
        { name: 'list_events', description: 'Consulte les événements et disponibilités de l’agenda', input_schema: {}, access: 'read', requires_human_approval: false },
        { name: 'create_event', description: 'Crée un nouvel événement dans le calendrier', input_schema: {}, access: 'write', requires_human_approval: true },
        { name: 'search_docs', description: 'Recherche dans des documents', input_schema: {}, access: 'read', requires_human_approval: false },
      ],
    }

    const ranked = rankMcpTools(profile, [server])

    expect(ranked.map(({ tool }) => tool.name)).toEqual(['list_events'])
    expect(ranked[0].matchedTerms).toContain('agenda')
  })
})
