import { Bot, Pencil, Power, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { getEnabledSkillNames } from '@/features/agents/agent-profile-utils'
import type { AgentCapability, AgentProfile } from '@/types/agent'

interface Props {
  profile: AgentProfile
  capabilities: AgentCapability[]
  onEdit: (profile: AgentProfile) => void
  onToggle: (profile: AgentProfile) => void
  onDelete: (profile: AgentProfile) => void
}

export function AgentProfileCard({ profile, capabilities, onEdit, onToggle, onDelete }: Props) {
  const labels = profile.capability_ids.map((id) => capabilities.find((item) => item.id === id)?.label ?? id)
  const skillNames = getEnabledSkillNames(profile.skills)
  return <Card><CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start">
    <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><Bot aria-hidden="true" className="size-5" /></span>
      <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{profile.name}</h3><Badge variant="outline">{profile.enabled ? 'Activé' : 'Désactivé'}</Badge><Badge variant="secondary">{profile.origin === 'auto_created' ? 'Créé automatiquement' : profile.origin === 'system_template' ? 'Modèle Mutual-AId' : 'Personnel'}</Badge></div>
      <p className="mt-1 text-sm text-muted-foreground">{profile.description}</p>
      <p className="mt-2 text-xs text-muted-foreground">Compétences : {skillNames.length ? skillNames.join(' · ') : 'aucune compétence activée'}</p>
      {labels.length > 0 && <p className="text-xs text-muted-foreground">Spécialisations : {labels.join(' · ')}</p>}
      <p className="text-xs text-muted-foreground">Domaine {profile.domain}</p>
    </div><div className="flex shrink-0 gap-1"><Button type="button" variant="ghost" size="icon" aria-label={`Modifier ${profile.name}`} onClick={() => onEdit(profile)}><Pencil /></Button><Button type="button" variant="ghost" size="icon" aria-label={`${profile.enabled ? 'Désactiver' : 'Activer'} ${profile.name}`} onClick={() => onToggle(profile)}><Power /></Button><Button type="button" variant="ghost" size="icon" aria-label={`Supprimer ${profile.name}`} onClick={() => onDelete(profile)}><Trash2 /></Button></div>
  </CardContent></Card>
}
