import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, CircleAlert, LoaderCircle, Square, Workflow } from 'lucide-react'
import { Link, useParams } from 'react-router'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { executionService } from '@/services/execution-service'
import { WorkflowGraph } from '@/features/executions/workflow-graph'
import type { Execution } from '@/types/execution'

const terminal = new Set(['completed', 'partial', 'failed', 'cancelled', 'interrupted'])

export function ExecutionPage() {
  const { executionId = '' } = useParams()
  const [execution, setExecution] = useState<Execution | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    try { setExecution(await executionService.get(executionId)); setError('') }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'L’exécution n’a pas pu être chargée.') }
  }, [executionId])
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])
  useEffect(() => {
    if (!execution || terminal.has(execution.status)) return
    const timer = window.setInterval(() => void load(), 2500)
    return () => window.clearInterval(timer)
  }, [execution, load])

  async function decide(approvalId: string, decision: 'approve' | 'reject') {
    setBusy(true)
    try { setExecution(await executionService.decide(executionId, approvalId, decision)); setError('') }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'La décision n’a pas été enregistrée.') }
    finally { setBusy(false) }
  }
  async function cancel() {
    setBusy(true)
    try { setExecution(await executionService.cancel(executionId)); setError('') }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'L’annulation a échoué.') }
    finally { setBusy(false) }
  }

  return <div className="mx-auto max-w-4xl space-y-6">
    <Link to={execution ? `/conversations/${execution.conversation_id}` : '/conversations'} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />Retour à la conversation</Link>
    <header className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm text-muted-foreground">Exécution</p><h2 className="mt-1 font-heading text-2xl font-semibold tracking-tight">Workflow</h2><p className="mt-2 max-w-2xl text-sm text-muted-foreground">{execution?.summary ?? 'Chargement du plan et de sa progression.'}</p></div>{execution && <Badge variant="outline" className="capitalize">{execution.status.replaceAll('_', ' ')}</Badge>}</header>
    {error && <p role="alert" className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive"><CircleAlert className="size-4" />{error}<Button variant="outline" size="sm" onClick={() => void load()}>Réessayer</Button></p>}
    {!execution && !error && <div role="status" className="flex items-center gap-2 py-12 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Chargement du workflow…</div>}
    {execution && <><div className="flex flex-wrap items-center gap-2"><Badge variant="secondary">{execution.tasks.filter((task) => task.status === 'completed').length}/{execution.tasks.length} tâches terminées</Badge>{!terminal.has(execution.status) && <Button variant="outline" size="sm" disabled={busy} onClick={() => void cancel()}><Square />Annuler l’exécution</Button>}</div>
      <WorkflowGraph execution={execution} />
      <section aria-label="État des tâches" className="space-y-3">{execution.tasks.map((task, index) => <Card key={task.id}><CardContent className="space-y-3 p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div className="flex items-start gap-3"><span className="grid size-7 shrink-0 place-items-center rounded-lg bg-muted text-xs font-medium">{index + 1}</span><div><h2 className="font-medium">{task.title}</h2>{task.description && <p className="mt-1 text-sm text-muted-foreground">{task.description}</p>}</div></div><Badge variant="outline" className="capitalize">{task.status.replaceAll('_', ' ')}</Badge></div>
        {task.agent_profile_snapshot && <p className="text-xs text-muted-foreground">Agent : {String(task.agent_profile_snapshot.name ?? 'Agent')}</p>}
        {task.dependencies.length > 0 && <p className="text-xs text-muted-foreground">Dépend de : {task.dependencies.join(', ')}</p>}
        {task.error && <p role="alert" className="text-sm text-destructive">{task.error}</p>}
        {task.result && <div className="rounded-lg bg-muted/60 p-3 text-sm leading-relaxed"><p className="mb-1 text-xs font-medium text-muted-foreground">Résultat</p><p className="whitespace-pre-wrap">{task.result}</p></div>}
        {task.status === 'awaiting_approval' && task.approval_id && <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3"><p className="text-sm font-medium">Cette action attend votre approbation</p><p className="mt-1 text-xs text-muted-foreground">Le système ne poursuit pas cette action avant votre décision explicite.</p><div className="mt-3 flex gap-2"><Button size="sm" disabled={busy} onClick={() => void decide(task.approval_id!, 'approve')}>Approuver</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => void decide(task.approval_id!, 'reject')}>Refuser</Button></div></div>}
      </CardContent></Card>)}</section>
      <div className="flex items-center gap-2 text-xs text-muted-foreground"><Workflow className="size-4" />Les états sont enregistrés et se rechargent depuis le backend.</div>
    </>}
  </div>
}
