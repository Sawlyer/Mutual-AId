export interface AgentCapability {
  id: string
  label: string
  template_id: string
}

export interface AgentProfile {
  id: string
  user_id: string
  name: string
  domain: string
  description: string
  instructions: string
  capability_ids: string[]
  enabled: boolean
  origin: 'user_created' | 'auto_created' | 'system_template'
  template_version: number
  created_at: string
  updated_at: string
  skill_ids: string[]
  skills: AgentSkill[]
}

export interface AgentSkill {
  id: string
  user_id: string
  name: string
  description: string
  instructions: string
  enabled: boolean
  created_at: string
  updated_at: string
}

export interface AgentCatalog {
  profiles: AgentProfile[]
  capabilities: AgentCapability[]
}

export interface AgentProfileInput {
  name: string
  domain: string
  description: string
  instructions: string
  capability_ids: string[]
  enabled: boolean
  skill_ids?: string[]
}

export interface AgentSkillInput {
  name: string
  description: string
  instructions: string
  enabled?: boolean
}

export interface AgentSkillUpdate {
  name?: string
  description?: string
  instructions?: string
  enabled?: boolean
}
