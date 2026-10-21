import { Badge } from '@/components/ui/badge'
import type { MissionStatus } from '@/types/domain'

const labels: Record<MissionStatus, string> = {
  running: 'En cours', queued: 'En attente', completed: 'Terminée', paused: 'En pause',
}

export function MissionStatusBadge({ status }: { status: MissionStatus }) {
  const colors: Record<MissionStatus, string> = {
    running: 'border-primary/20 bg-primary/8 text-primary',
    queued: 'border-amber-500/20 bg-amber-500/8 text-amber-700 dark:text-amber-300',
    completed: 'border-emerald-500/20 bg-emerald-500/8 text-emerald-700 dark:text-emerald-300',
    paused: 'border-border bg-muted text-muted-foreground',
  }
  return <Badge variant="outline" className={`h-6 gap-1.5 px-2 text-[11px] font-medium ${colors[status]}`}>
    <span className="size-1.5 rounded-full bg-current" />{labels[status]}
  </Badge>
}
