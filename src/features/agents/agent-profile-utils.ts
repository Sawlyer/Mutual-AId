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
