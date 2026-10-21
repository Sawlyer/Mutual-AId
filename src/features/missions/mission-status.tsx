import { Badge } from '@/components/ui/badge'
import type { WorkStatus } from '@/types/domain'

const labels: Record<WorkStatus, string> = {
  pending: 'À faire', ready: 'Prête', running: 'En cours', validating: 'Validation',
  completed: 'Terminée', failed: 'Échec', blocked: 'Bloquée', paused: 'En pause',
}
const styles: Record<WorkStatus, string> = {
  pending: 'border-border bg-muted text-muted-foreground',
  ready: 'border-sky-500/20 bg-sky-500/8 text-sky-700 dark:text-sky-300',
  running: 'border-primary/20 bg-primary/8 text-primary',
  validating: 'border-violet-500/20 bg-violet-500/8 text-violet-700 dark:text-violet-300',
  completed: 'border-emerald-500/20 bg-emerald-500/8 text-emerald-700 dark:text-emerald-300',
  failed: 'border-destructive/20 bg-destructive/8 text-destructive',
  blocked: 'border-amber-500/20 bg-amber-500/8 text-amber-700 dark:text-amber-300',
  paused: 'border-border bg-muted text-muted-foreground',
}

export function MissionStatusBadge({ status }: { status: WorkStatus }) {
  return <Badge variant="outline" className={`h-6 gap-1.5 px-2 text-[11px] font-medium ${styles[status]}`}>
    <span className="size-1.5 rounded-full bg-current" />{labels[status]}
  </Badge>
}
