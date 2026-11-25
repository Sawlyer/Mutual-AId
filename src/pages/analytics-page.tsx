import { useEffect, useState } from 'react'
import { Activity, ArrowDownToLine, ArrowUpFromLine, Bot, ChartNoAxesCombined, CircleAlert, Coins, LoaderCircle, MessagesSquare, Workflow } from 'lucide-react'
import { Link } from 'react-router'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/reui/badge'
import { analyticsService, type AnalyticsSummary, type TokenUsageMetrics } from '@/services/analytics-service'
import { scaleExecutionActivity } from './analytics-utils'

const statusLabels: Record<string, string> = {
  pending: 'En attente', ready: 'Prête', running: 'En cours', awaiting_approval: 'Approbation requise',
  validating: 'Validation', completed: 'Terminée', failed: 'Échec', blocked: 'Bloquée', paused: 'En pause', interrupted: 'Interrompue', cancelled: 'Annulée',
}

const statusColors: Record<string, string> = {
  completed: 'bg-emerald-500', running: 'bg-violet-500', ready: 'bg-blue-500', pending: 'bg-muted-foreground/50',
  failed: 'bg-destructive', blocked: 'bg-amber-500', validating: 'bg-amber-400', awaiting_approval: 'bg-amber-400',
  paused: 'bg-slate-400', interrupted: 'bg-rose-400', cancelled: 'bg-slate-400',
}

const chartWidth = 560
const chartHeight = 132

function formatCount(value: number) {
  return new Intl.NumberFormat('fr-FR').format(value)
}

function formatUsd(value: number) {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 6,
  }).format(value)
}

function estimatedCost(usage: TokenUsageMetrics) {
  if (usage.estimated_cost_usd !== null) return formatUsd(usage.estimated_cost_usd)
  return usage.runs ? 'Tarif indisponible' : '—'
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
    { label: 'Tokens en entrée', value: formatCount(metrics.token_usage.input_tokens), icon: ArrowDownToLine },
    { label: 'Tokens en sortie', value: formatCount(metrics.token_usage.output_tokens), icon: ArrowUpFromLine },
    { label: 'Coût OpenAI estimé', value: estimatedCost(metrics.token_usage), icon: Coins },
  ] : []
  const activity = scaleExecutionActivity(metrics?.execution_activity ?? [], chartWidth, chartHeight)
  const activityTotal = metrics?.execution_activity.reduce((sum, point) => sum + point.count, 0) ?? 0
  const line = activity.map(({ x, y }) => `${x},${y}`).join(' ')

  return <div className="mx-auto max-w-6xl space-y-6">
    <header className="space-y-1">
      <p className="text-sm text-muted-foreground">Mesure d’activité</p>
      <h2 className="font-heading text-2xl font-semibold tracking-tight">Analytics</h2>
      <p className="text-sm text-muted-foreground">Suivez l’activité et les résultats de vos orchestrations.</p>
    </header>
    {loading && <div role="status" className="flex items-center gap-2 py-10 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Calcul des indicateurs…</div>}
    {!loading && error && <p role="alert" className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive"><CircleAlert className="size-4" />{error}</p>}
    {!loading && !error && metrics && <>
      <section aria-label="Indicateurs principaux" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map(({ label, value, icon: Icon }) => <Card key={label}><CardContent className="flex items-center gap-3 p-4">
          <span className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary"><Icon className="size-4" /></span>
          <div><p className="text-xs text-muted-foreground">{label}</p><p className="mt-0.5 text-xl font-semibold tabular-nums">{value}</p></div>
        </CardContent></Card>)}
      </section>

      <Card><CardContent className="space-y-5 p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div><h2 className="font-heading font-semibold">Activité des exécutions</h2><p className="mt-1 text-sm text-muted-foreground">Nombre d’exécutions lancées par jour · 14 derniers jours</p></div>
          <div className="flex shrink-0 items-center gap-2"><Badge variant="primary-light" size="lg" radius="full">{activityTotal} au total</Badge><span className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary"><ChartNoAxesCombined className="size-4" /></span></div>
        </div>
        {activityTotal === 0 ? <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Aucune exécution sur cette période. Lancez une orchestration pour voir son activité ici.</p> : <>
          <div className="overflow-hidden">
            <svg className="h-auto w-full overflow-visible text-primary" viewBox={`-4 -8 ${chartWidth + 8} ${chartHeight + 20}`} role="img" aria-label={`Activité quotidienne des exécutions, ${activityTotal} au total sur 14 jours`}>
              {[0, 0.5, 1].map((ratio) => <line key={ratio} x1="0" x2={chartWidth} y1={ratio * chartHeight} y2={ratio * chartHeight} className="stroke-border" strokeDasharray="3 5" />)}
              {activity.length > 1 && <polyline points={line} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
              {activity.map(({ date, count, x, y }) => <circle key={date} cx={x} cy={y} r={count ? 3.5 : 2} fill="currentColor" stroke="var(--card)" strokeWidth="2"><title>{new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`))} : {count} exécution{count > 1 ? 's' : ''}</title></circle>)}
            </svg>
          </div>
          <div className="flex justify-between text-xs text-muted-foreground"><span>{activity[0] && new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${activity[0].date}T00:00:00Z`))}</span><span>Aujourd’hui</span></div>
        </>}
      </CardContent></Card>

      <section aria-label="Répartition par statut" className="grid gap-4 lg:grid-cols-2">
        <StatusBreakdown title="Statut des exécutions" description={`${metrics.executions} exécution${metrics.executions > 1 ? 's' : ''} au total`} statuses={metrics.execution_statuses} />
        <StatusBreakdown title="Statut des tâches" description={`${metrics.tasks} tâche${metrics.tasks > 1 ? 's' : ''} au total`} statuses={metrics.task_statuses} />
      </section>
      <Card>
        <CardContent className="space-y-4 p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-heading font-semibold">Consommation par conversation</h2>
              <p className="mt-1 text-sm text-muted-foreground">Tokens réels remontés par les exécutions du modèle, regroupés par chat.</p>
            </div>
            <Badge variant={metrics.token_usage.unpriced_runs ? 'warning-light' : 'primary-light'} size="sm" radius="full">
              {metrics.token_usage.requests} appels modèle
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Coûts estimés en USD selon les tarifs OpenAI standards ; les connecteurs et services externes ne sont pas inclus.
            Les échanges antérieurs à l’activation du suivi n’ont pas de compteurs rétroactifs.
          </p>
          {metrics.conversation_usage.length === 0 ? (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Aucune conversation enregistrée.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border/70">
              <table className="w-full min-w-[760px] border-collapse text-left text-sm">
                <caption className="sr-only">Usage de tokens et coût estimé pour chaque conversation</caption>
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-medium">Conversation</th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">Entrée</th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">Sortie</th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">Coût estimé</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/70">
                  {metrics.conversation_usage.map((conversation) => (
                    <tr key={conversation.conversation_id} className="align-top transition-colors hover:bg-muted/30">
                      <th scope="row" className="max-w-[320px] px-4 py-3 font-normal">
                        <Link to={`/conversations/${conversation.conversation_id}`} className="block truncate font-medium text-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                          {conversation.title}
                        </Link>
                        <span className="mt-1 block truncate text-xs text-muted-foreground">
                          {conversation.models.length ? conversation.models.join(', ') : 'Aucun appel modèle'} · {conversation.message_count} messages · {conversation.requests} appels · {new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' }).format(new Date(conversation.updated_at))}
                        </span>
                      </th>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {formatCount(conversation.input_tokens)}
                        {conversation.cached_input_tokens > 0 && <span className="mt-1 block text-xs text-muted-foreground">{formatCount(conversation.cached_input_tokens)} en cache</span>}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {formatCount(conversation.output_tokens)}
                        {conversation.reasoning_tokens > 0 && <span className="mt-1 block text-xs text-muted-foreground">{formatCount(conversation.reasoning_tokens)} tokens de raisonnement</span>}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        <span className="font-medium">{estimatedCost(conversation)}</span>
                        {conversation.estimated_cost_usd !== null && <span className="mt-1 block text-xs text-muted-foreground">Entrée {formatUsd((conversation.input_cost_usd ?? 0) + (conversation.cached_input_cost_usd ?? 0))} · Sortie {formatUsd(conversation.output_cost_usd ?? 0)}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">Le taux de complétion des tâches est de {metrics.task_completion_percent} %. Ces statistiques reflètent cet espace de travail.</p>
    </>}
  </div>
}

function StatusBreakdown({ title, description, statuses }: { title: string; description: string; statuses: Record<string, number> }) {
  const entries = Object.entries(statuses).filter(([, count]) => count > 0).sort(([left], [right]) => left.localeCompare(right))
  const total = entries.reduce((sum, [, count]) => sum + count, 0)
  return <Card><CardContent className="space-y-5 p-5 sm:p-6">
    <div><h2 className="font-heading font-semibold">{title}</h2><p className="mt-1 text-sm text-muted-foreground">{description}</p></div>
    {!total ? <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Aucune donnée disponible.</p> : <>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-muted" role="img" aria-label={`Répartition des statuts : ${entries.map(([status, count]) => `${statusLabels[status] ?? status}, ${count}`).join('; ')}`}>
        {entries.map(([status, count]) => <span key={status} className={`${statusColors[status] ?? 'bg-primary'} h-full`} style={{ width: `${count / total * 100}%` }} />)}
      </div>
      <ul className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
        {entries.map(([status, count]) => <li key={status} className="flex min-w-0 items-center gap-2 text-sm">
          <span aria-hidden="true" className={`size-2.5 shrink-0 rounded-full ${statusColors[status] ?? 'bg-primary'}`} />
          <span className="min-w-0 flex-1 truncate text-muted-foreground">{statusLabels[status] ?? status}</span>
          <Badge variant={status === 'completed' ? 'success-light' : status === 'failed' ? 'destructive-light' : ['blocked', 'validating', 'awaiting_approval'].includes(status) ? 'warning-light' : 'primary-light'} size="sm" radius="full" aria-label={`${count} ${statusLabels[status] ?? status}`}>{count}</Badge>
          <span className="w-10 text-right text-xs text-muted-foreground">{Math.round(count / total * 100)} %</span>
        </li>)}
      </ul>
    </>}
  </CardContent></Card>
}
