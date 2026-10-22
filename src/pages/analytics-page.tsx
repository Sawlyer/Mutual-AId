import { useEffect, useState } from 'react'
import { Activity, Bot, CircleAlert, LoaderCircle, MessagesSquare, Workflow } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { analyticsService, type AnalyticsSummary } from '@/services/analytics-service'

const statusLabels: Record<string, string> = {
  pending: 'En attente', ready: 'Prête', running: 'En cours', awaiting_approval: 'Approbation requise',
  validating: 'Validation', completed: 'Terminée', failed: 'Échec', blocked: 'Bloquée', paused: 'En pause', interrupted: 'Interrompue', cancelled: 'Annulée',
}

export function AnalyticsPage() {
  const [metrics, setMetrics] = useState<AnalyticsSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    void analyticsService.get().then((result) => { if (active) setMetrics(result) })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Les statistiques sont indisponibles.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  const stats = metrics ? [
    { label: 'Conversations', value: metrics.conversations, icon: MessagesSquare },
    { label: 'Exécutions', value: metrics.executions, icon: Workflow },
    { label: 'Exécutions actives', value: metrics.active_executions, icon: Activity },
    { label: 'Tâches terminées', value: `${metrics.completed_tasks} / ${metrics.tasks}`, icon: Bot },
  ] : []
  const maxStatus = Math.max(1, ...Object.values(metrics?.task_statuses ?? {}))
  return <div className="mx-auto max-w-4xl space-y-6">
    <header><p className="text-sm text-muted-foreground">Mesure d’activité</p><h2 className="mt-1 font-heading text-2xl font-semibold tracking-tight">Analytics</h2><p className="mt-1 text-sm text-muted-foreground">Statistiques calculées depuis les conversations et tâches de votre compte.</p></header>
    {loading && <div role="status" className="flex items-center gap-2 py-10 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Calcul des indicateurs…</div>}
    {!loading && error && <p role="alert" className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive"><CircleAlert className="size-4" />{error}</p>}
    {!loading && !error && metrics && <>
      <section aria-label="Indicateurs principaux" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{stats.map(({ label, value, icon: Icon }) => <Card key={label}><CardContent className="flex items-center gap-3 p-4"><span className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary"><Icon className="size-4" /></span><div><p className="text-xs text-muted-foreground">{label}</p><p className="mt-0.5 text-xl font-semibold tabular-nums">{value}</p></div></CardContent></Card>)}</section>
      <Card><CardContent className="space-y-5 p-5"><div><h2 className="font-semibold">Répartition des tâches</h2><p className="mt-1 text-sm text-muted-foreground">État courant des {metrics.tasks} tâches persistées.</p></div>
        {metrics.tasks === 0 ? <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Aucune tâche enregistrée. Les indicateurs apparaîtront après votre première orchestration.</p> : <div className="space-y-3">{Object.entries(metrics.task_statuses).sort(([left], [right]) => left.localeCompare(right)).map(([status, count]) => <div key={status} className="grid grid-cols-[130px_minmax(0,1fr)_36px] items-center gap-3 text-sm"><span className="truncate text-muted-foreground">{statusLabels[status] ?? status}</span><div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${count / maxStatus * 100}%` }} /></div><span className="text-right tabular-nums">{count}</span></div>)}</div>}
      </CardContent></Card>
      <p className="text-xs text-muted-foreground">Le taux de complétion global est de {metrics.task_completion_percent} %. Les statistiques reflètent uniquement votre compte.</p>
    </>}
  </div>
}
