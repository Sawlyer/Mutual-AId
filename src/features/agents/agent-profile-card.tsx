import { Bot, Power, Trash2 } from 'lucide-react'
import { Link } from 'react-router'
import { Badge } from '@/components/reui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { IconTile } from '@/components/reui/icon-tile'
import { getEnabledSkillNames } from '@/features/agents/agent-profile-utils'
import type { AgentProfile } from '@/types/agent'

interface Props {
  profile: AgentProfile
  disabled?: boolean
  onToggle: (profile: AgentProfile) => void
  onDelete: (profile: AgentProfile) => void
}

function originLabel(profile: AgentProfile) {
  if (profile.origin === 'auto_created') return 'Créé automatiquement'
  if (profile.origin === 'system_template') return 'Modèle Mutual-AId'
  return 'Personnel'
}

export function AgentProfileCard({ profile, disabled = false, onToggle, onDelete }: Props) {
  const skillNames = getEnabledSkillNames(profile.skills)
  return <Card className="transition-shadow hover:shadow-sm">
    <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:p-5">
      <Link to={`/agents/${encodeURIComponent(profile.id)}`} className="flex min-w-0 flex-1 items-start gap-3 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
        <IconTile variant="soft" className="text-primary" aria-hidden="true"><Bot /></IconTile>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2"><span className="font-semibold text-foreground">{profile.name}</span><Badge variant={profile.enabled ? 'success-light' : 'secondary'}>{profile.enabled ? 'Actif' : 'Inactif'}</Badge><Badge variant="outline">{originLabel(profile)}</Badge></span>
          <span className="mt-1 block line-clamp-2 text-sm text-muted-foreground">{profile.description}</span>
          <span className="mt-2 block truncate text-xs text-muted-foreground">{skillNames.length ? `${skillNames.length} skill${skillNames.length === 1 ? '' : 's'} · ${skillNames.join(' · ')}` : 'Aucun skill associé'}</span>
        </span>
      </Link>
      <div className="flex shrink-0 justify-end gap-1 sm:border-l sm:border-border/70 sm:pl-3">
        <Button type="button" variant="ghost" size="icon" disabled={disabled} aria-label={`${profile.enabled ? 'Désactiver' : 'Activer'} ${profile.name}`} onClick={() => onToggle(profile)}><Power /></Button>
        <Button type="button" variant="ghost" size="icon" disabled={disabled} aria-label={`Supprimer ${profile.name}`} onClick={() => onDelete(profile)} className="text-muted-foreground hover:text-destructive"><Trash2 /></Button>
      </div>
    </CardContent>
  </Card>
}
