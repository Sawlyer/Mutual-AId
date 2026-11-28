import type { AgentProfile, SkillCatalogItem } from '@/types/agent'
import type { McpServerRecord, McpToolInfo } from '@/services/chat-adapters'

const STOP_WORDS = new Set([
  'avec', 'dans', 'pour', 'vers', 'leur', 'leurs', 'elle', 'elles', 'nous', 'vous', 'cela', 'cette', 'celui',
  'être', 'avoir', 'aide', 'aider', 'faire', 'fait', 'plus', 'moins', 'depuis', 'selon', 'entre', 'ainsi',
  'the', 'and', 'for', 'with', 'from', 'this', 'that', 'into', 'their', 'your', 'you', 'are', 'can', 'will',
])

const TERM_ALIASES: Record<string, string> = {
  agendas: 'agenda', calendar: 'agenda', calendars: 'agenda', calendrier: 'agenda', calendriers: 'agenda',
  horaires: 'horaire', schedule: 'horaire', schedules: 'horaire', planning: 'planifier', planification: 'planifier',
  disponibilites: 'disponibilite', disponibilite: 'disponibilite', events: 'evenement', evenement: 'evenement',
  cours: 'cours', documents: 'document', files: 'fichier', fichiers: 'fichier',
}

function tokenize(value: string): Set<string> {
  const normalized = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr-FR')
  return new Set(normalized.match(/[a-z0-9]{4,}/g)?.map((word) => TERM_ALIASES[word] ?? word).filter((word) => !STOP_WORDS.has(word)) ?? [])
}

function profileTerms(profile: AgentProfile): Set<string> {
  return tokenize([
    profile.name, profile.domain, profile.description, profile.instructions, ...profile.capability_ids,
    ...profile.skills.flatMap((skill) => [skill.name, skill.description, skill.instructions]),
  ].join(' '))
}

function matchScore(profile: AgentProfile, terms: Set<string>, candidate: string, category?: string) {
  const words = tokenize(candidate)
  const matchedTerms = [...words].filter((word) => terms.has(word)).sort()
  const categoryMatch = category ? tokenize(profile.domain).has([...tokenize(category)][0] ?? '') : false
  const score = matchedTerms.length * 2 + (categoryMatch ? 2 : 0)
  return { score, matchedTerms }
}

export interface SkillRecommendation {
  item: SkillCatalogItem
  score: number
  matchedTerms: string[]
}

export function rankMarketplaceSkills(profile: AgentProfile, items: SkillCatalogItem[]): SkillRecommendation[] {
  const terms = profileTerms(profile)
  const assigned = new Set(profile.skills.map((skill) => skill.catalog_id).filter(Boolean))
  return items
    .filter((item) => !assigned.has(item.id))
    .map((item) => ({ item, ...matchScore(profile, terms, [item.name, item.description, item.category, ...item.tags].join(' '), item.category) }))
    .filter(({ score }) => score >= 2)
    .sort((left, right) => right.score - left.score || left.item.name.localeCompare(right.item.name, 'fr'))
}

export interface McpToolRecommendation {
  server: McpServerRecord
  tool: McpToolInfo
  score: number
  matchedTerms: string[]
}

export function rankMcpTools(profile: AgentProfile, servers: McpServerRecord[]): McpToolRecommendation[] {
  const terms = profileTerms(profile)
  return servers
    .filter((server) => server.status === 'ready' && server.enabled)
    .flatMap((server) => server.tools
      .filter((tool) => tool.access === 'read' && !tool.requires_human_approval && server.approved_tool_names.includes(tool.name))
      .map((tool) => ({ server, tool, ...matchScore(profile, terms, [server.name, tool.name, tool.description].join(' ')) })))
    .filter(({ score }) => score >= 2)
    .sort((left, right) => right.score - left.score || left.tool.name.localeCompare(right.tool.name, 'fr'))
}
