import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useMissionsStore } from '@/stores/use-missions-store'
import type { TaskStatus } from '@/types/domain'

const statuses: { id: TaskStatus; label: string; color: string }[] = [
  { id: 'completed', label: 'Terminées', color: 'bg-emerald-500' },
  { id: 'running', label: 'En cours', color: 'bg-primary' },
  { id: 'validating', label: 'Validation', color: 'bg-violet-500' },
  { id: 'ready', label: 'Prêtes', color: 'bg-sky-500' },
  { id: 'pending', label: 'En attente', color: 'bg-muted-foreground/40' },
  { id: 'blocked', label: 'Bloquées', color: 'bg-amber-500' },
  { id: 'failed', label: 'En échec', color: 'bg-destructive' },
  { id: 'paused', label: 'En pause', color: 'bg-slate-400' },
]

export function TaskStatusDistribution() {
  const missions = useMissionsStore((state) => state.missions)
  const tasks = missions.flatMap((mission) => mission.tasks)
  const counts = statuses.map((status) => ({ ...status, count: tasks.filter((task) => task.status === status.id).length }))
  return <Card>
    <CardHeader><CardTitle>Répartition des tâches</CardTitle><CardDescription>{tasks.length} tâches sur l’ensemble des missions</CardDescription></CardHeader>
    <CardContent>
      {tasks.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">Les tâches apparaîtront ici au lancement d’une mission.</p> : <>
        <div role="img" aria-label={counts.map(({ label, count }) => `${label} : ${count}`).join(', ')} className="flex h-3 overflow-hidden rounded-full bg-muted">
          {counts.filter(({ count }) => count > 0).map(({ id, label, color, count }) => <span key={id} title={`${label} : ${count}`} className={`${color} border-r border-background/70 last:border-0`} style={{ width: `${(count / tasks.length) * 100}%` }} />)}
        </div>
        <ul className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3">{counts.map(({ id, label, color, count }) => <li key={id} className="flex items-center gap-2 text-[11px]"><span className={`size-2 rounded-full ${color}`} /><span className="flex-1 text-muted-foreground">{label}</span><span className="font-medium tabular-nums">{count}</span></li>)}</ul>
      </>}
    </CardContent>
  </Card>
}
