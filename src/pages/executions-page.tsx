import { useEffect, useState } from 'react'
import { ArrowRight, CircleAlert, LoaderCircle, Workflow } from 'lucide-react'
import { Link } from 'react-router'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { executionService } from '@/services/execution-service'
import type { Execution } from '@/types/execution'

const labels: Record<string, string> = { planning: 'Planification', running: 'En cours', awaiting_approval: 'Approbation requise', completed: 'Terminée', partial: 'Partielle', failed: 'Échec', cancelled: 'Annulée', interrupted: 'Interrompue' }

export function ExecutionsPage() {
  const [executions, setExecutions] = useState<Execution[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    void executionService.list().then((items) => { if (active) setExecutions(items) })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Les exécutions sont inaccessibles.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])
  return <div className="mx-auto max-w-4xl space-y-6">
    <header><p className="text-sm text-muted-foreground">Historique des orchestrations</p><h2 className="mt-1 font-heading text-2xl font-semibold tracking-tight">Exécutions</h2><p className="mt-1 text-sm text-muted-foreground">Les demandes complexes démarrées depuis le chat apparaissent ici.</p></header>
    {loading && <div role="status" className="flex items-center gap-2 py-10 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Chargement des exécutions…</div>}
    {!loading && error && <div role="alert" className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive"><CircleAlert className="size-4" />{error}</div>}
    {!loading && !error && executions.length === 0 && <div className="rounded-xl border border-dashed p-10 text-center"><Workflow className="mx-auto size-8 text-muted-foreground" /><h2 className="mt-3 font-medium">Aucune exécution</h2><p className="mt-1 text-sm text-muted-foreground">Décrivez un objectif complexe dans le chat pour commencer.</p><Button nativeButton={false} className="mt-4" render={<Link to="/" />}>Ouvrir le chat<ArrowRight /></Button></div>}
    <section className="space-y-3" aria-label="Historique des exécutions">{executions.map((execution) => {
      const complete = execution.tasks.filter((task) => task.status === 'completed').length
      return <Card key={execution.id}><CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="font-medium">{execution.summary}</h2><Badge variant="outline">{labels[execution.status] ?? execution.status}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{complete}/{execution.tasks.length} tâches · {new Date(execution.updated_at).toLocaleString('fr-FR')}</p></div><div className="flex gap-2"><Button nativeButton={false} variant="outline" size="sm" render={<Link to={`/conversations/${execution.conversation_id}`} />}>Conversation</Button><Button nativeButton={false} size="sm" render={<Link to={`/executions/${execution.id}`} />}>Workflow<ArrowRight /></Button></div></CardContent></Card>
    })}</section>
  </div>
}
