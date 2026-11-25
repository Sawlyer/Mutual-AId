import { describe, expect, it } from 'vitest'
import { agentDomainFromName } from '@/features/agents/agent-profile-utils'

describe('agentDomainFromName', () => {
  it('creates_a_valid_domain_from_a_name', () => {
    const domain = agentDomainFromName('42 — Conseiller santé & Bien-être ' + 'avec un nom très long '.repeat(8))

    expect(domain).toMatch(/^[a-z][a-z0-9_-]{0,63}$/)
    expect(domain.startsWith('agent-42-conseiller-sante-bien-etre')).toBe(true)
    expect(domain).toHaveLength(64)
  })

  it('falls_back_when_name_has_no_ascii_letters', () => {
    expect(agentDomainFromName('🤖 123 !!!')).toBe('agent')
  })
})
