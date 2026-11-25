export function updateProfileSkills<Skill, Profile extends { id: string; skill_ids: string[]; skills: Skill[] }>(
  profiles: Profile[],
  profileId: string,
  skills: Skill[],
  skillIds: string[],
): Profile[] {
  return profiles.map((profile) => profile.id === profileId
    ? { ...profile, skills, skill_ids: skillIds }
    : profile)
}

export function getEnabledSkillNames(skills: readonly { name: string; enabled: boolean }[]): string[] {
  return skills.filter((skill) => skill.enabled).map((skill) => skill.name)
}

export function agentDomainFromName(name: string): string {
  const normalized = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/[-_]{2,}/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')

  if (!/[a-z]/.test(normalized)) return 'agent'

  const withLeadingLetter = /^[a-z]/.test(normalized) ? normalized : `agent-${normalized}`
  return withLeadingLetter.slice(0, 64).replace(/[-_]+$/g, '') || 'agent'
}
