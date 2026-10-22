import { describe, expect, it } from 'vitest'
import { getEnabledSkillNames, updateProfileSkills } from './agent-profile-utils'

describe('updateProfileSkills', () => {
  it('updates the selected profile without mutating the other profiles', () => {
    const profiles = [
      { id: 'agent-a', skill_ids: [], skills: [] },
      { id: 'agent-b', skill_ids: [], skills: [] },
    ]
    const skills = [{ id: 'skill-1', name: 'Verify' }]

    const result = updateProfileSkills(profiles, 'agent-a', skills, ['skill-1'])

    expect(result[0]).toEqual({ id: 'agent-a', skill_ids: ['skill-1'], skills })
    expect(result[1]).toBe(profiles[1])
    expect(profiles[0].skill_ids).toEqual([])
  })
})

describe('getEnabledSkillNames', () => {
  it('summarizes enabled skills and omits disabled ones', () => {
    expect(getEnabledSkillNames([
      { name: 'Organisation santé', enabled: true },
      { name: 'Ancienne consigne', enabled: false },
    ])).toEqual(['Organisation santé'])
  })
})
