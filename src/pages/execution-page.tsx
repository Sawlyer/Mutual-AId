import { useEffect, useState } from 'react'
import { ArrowLeft, CircleAlert, Clock3, Download, LoaderCircle, Pause, Play, Square, Workflow } from 'lucide-react'
import { Link, useParams } from 'react-router'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { executionService } from '@/services/execution-service'
import type { Execution, ExecutionArtifact, ExecutionEvent } from '@/types/execution'
import { WorkflowGraph } from '@/features/executions/workflow-graph'

const terminal = new Set<Execution['status']>(['completed', 'partial', 'failed', 'cancelled', 'interrupted'])
const executionStatusLabels: Record<Execution['status'], string> = {
  planning: 'Planification',
  running: 'En cours',
  pausing: 'Mise en pause',
  paused: 'En pause',
  awaiting_approval: 'Approbation requise',
  completed: 'Terminée',
  partial: 'Partielle',
  failed: 'Échec',
  cancelled: 'Annulée',
  interrupted: 'Interrompue',
}
const taskStatusLabels: Record<string, string> = {
  pending: 'En attente',
  ready: 'Prête',
  running: 'En cours',
  awaiting_approval: 'Approbation requise',
  validating: 'Vérification',
  completed: 'Terminée',
  failed: 'Échec',
  blocked: 'Bloquée',
  paused: 'En pause',
  interrupted: 'Interrompue',
  cancelled: 'Annulée',
}
const eventLabels: Record<string, string> = {
  'execution.created': 'Exécution créée',
  'execution.running': 'Exécution démarrée',
  'execution.pausing': 'Mise en pause demandée',
  'execution.paused': 'Exécution mise en pause',
  'execution.awaiting_approval': 'Une action attend votre approbation',
  'execution.completed': 'Exécution terminée',
  'execution.partial': 'Exécution partielle',
  'execution.failed': 'Exécution échouée',
  'execution.cancelled': 'Exécution annulée',
  'execution.interrupted': 'Exécution interrompue',
  'task.ready': 'Tâche prête',
  'task.started': 'Agent au travail',
  'task.retrying': 'Nouvelle tentative planifiée',
  'task.validating': 'Vérification du résultat',
  'task.completed': 'Tâche terminée',
  'task.failed': 'Échec de la tâche',
  'task.blocked': 'Tâche bloquée',
  'task.cancelled': 'Tâche annulée',
  'task.resume_blocked': 'Reprise suspendue pour vérification',
  'approval.required': 'Approbation requise',
  'approval.decided': 'Décision enregistrée',
  'artifact.created': 'Résultat enregistré',
}

function eventDescription(event: ExecutionEvent) {
  if (event.event_type === 'artifact.created') return 'Un résultat est disponible dans la section Résultats.'
  return event.message
}

function displayTime(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

function artifactFileName(name: string) {
  const safeName = name.normalize('NFKD').replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '')
  return `${safeName || 'resultat'}.txt`
}

export function ExecutionPage() {
  const { executionId = '' } = useParams()
  const [execution, setExecution] = useState<Execution | null>(null)
  const [events, setEvents] = useState<ExecutionEvent[]>([])
  const [artifacts, setArtifacts] = useState<ExecutionArtifact[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [streamConnected, setStreamConnected] = useState<boolean | null>(null)
  const [streamEpoch, setStreamEpoch] = useState(0)

  useEffect(() => {
    let active = true
    let unsubscribe = () => {}

    const refreshExecution = async () => {
      try {
        const next = await executionService.get(executionId)
        if (!active) return
        setExecution(next)
        setError('')
        if (terminal.has(next.status)) {
          setStreamConnected(false)
          const items = await executionService.listArtifacts(executionId)
          if (active) setArtifacts(items)
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'L’exécution n’a pas pu être chargée.')
      }
    }

    const connect = async () => {
      try {
        const [initial, initialEvents, initialArtifacts] = await Promise.all([
          executionService.get(executionId),
          executionService.listAllEvents(executionId),
          executionService.listArtifacts(executionId),
        ])
        if (!active) return
        setExecution(initial)
        setEvents(initialEvents)
        setArtifacts(initialArtifacts)
        setError('')
        if (terminal.has(initial.status)) {
          setStreamConnected(false)
          return
        }
        setStreamConnected(null)
        unsubscribe = executionService.subscribe(executionId, {
          onEvent: (event) => {
            if (!active) return
            setEvents((current) => current.some((item) => item.id === event.id)
              ? current
              : [...current, event].sort((left, right) => left.id - right.id))
            void refreshExecution()
            if (event.event_type === 'artifact.created') {
              void executionService.listArtifacts(executionId).then((items) => {
                if (active) setArtifacts(items)
              }).catch(() => setError('Les résultats de cette exécution n’ont pas pu être chargés.'))
            }
          },
          onTerminal: () => {
            if (!active) return
            setStreamConnected(false)
            void refreshExecution()
          },
          onConnectionChange: (connected) => { if (active) setStreamConnected(connected) },
        }, initialEvents.at(-1)?.id ?? 0)
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'L’exécution n’a pas pu être chargée.')
      }
    }

    void connect()
    return () => {
      active = false
      unsubscribe()
    }
  }, [executionId, streamEpoch])

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

  async function pause() {
    setBusy(true)
    try { setExecution(await executionService.pause(executionId)); setError('') }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'La mise en pause a échoué.') }
    finally { setBusy(false) }
  }

  async function resume() {
    setBusy(true)
    try {
      setExecution(await executionService.resume(executionId))
      setError('')
      setStreamEpoch((epoch) => epoch + 1)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'L’exécution n’a pas pu être reprise.')
    } finally {
      setBusy(false)
    }
  }

  async function downloadArtifact(artifactId: string, name: string) {
    setDownloadingId(artifactId)
    try {
      const artifact = await executionService.getArtifact(executionId, artifactId)
      const url = URL.createObjectURL(new Blob([artifact.content], { type: artifact.media_type }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = artifactFileName(name)
      anchor.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 0)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Le résultat n’a pas pu être téléchargé.')
    } finally {
      setDownloadingId(null)
    }
  }

  const completedTasks = execution?.tasks.filter((task) => task.status === 'completed').length ?? 0

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link
        to={execution ? `/conversations/${execution.conversation_id}` : '/conversations'}
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Retour à la conversation
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">Exécution</p>
          <h2 className="mt-1 font-heading text-2xl font-semibold tracking-tight">Workflow</h2>
          {execution && <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{execution.summary}</p>}
        </div>
        {execution && (
          <Badge variant={terminal.has(execution.status) ? 'secondary' : 'outline'}>
            {executionStatusLabels[execution.status]}
          </Badge>
        )}
      </header>

      {error && (
        <p role="alert" className="flex items-center gap-2 text-sm text-destructive">
          <CircleAlert className="size-4" />
          {error}
        </p>
      )}

      {!execution && !error && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" />
          Chargement du workflow…
        </div>
      )}

      {execution && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{completedTasks}/{execution.tasks.length} tâches terminées</Badge>
            {!terminal.has(execution.status) && (
              <Button variant="outline" size="sm" disabled={busy} onClick={() => void cancel()}>
                <Square />
                Annuler l’exécution
              </Button>
            )}
            {(execution.status === 'running' || execution.status === 'awaiting_approval') && (
              <Button variant="outline" size="sm" disabled={busy} onClick={() => void pause()}>
                <Pause />
                Mettre en pause
              </Button>
            )}
            {execution.status === 'pausing' && (
              <Button variant="outline" size="sm" disabled>
                <LoaderCircle className="animate-spin" />
                Mise en pause…
              </Button>
            )}
            {(execution.status === 'interrupted' || execution.status === 'paused') && (
              <Button size="sm" disabled={busy} onClick={() => void resume()}>
                {busy ? <LoaderCircle className="animate-spin" /> : <Play />}
                {execution.status === 'paused' ? 'Reprendre' : 'Reprendre l’exécution'}
              </Button>
            )}
            <span role="status" className="ml-auto text-xs text-muted-foreground">
              {streamConnected
                ? 'Suivi en temps réel'
                : streamConnected === false && terminal.has(execution.status)
                  ? 'Suivi terminé'
                  : streamConnected === false
                    ? 'Reconnexion au suivi…'
                    : 'Connexion au suivi…'}
            </span>
          </div>

          <WorkflowGraph execution={execution} />

          <section aria-label="État des tâches" className="space-y-3">
            <h2 className="text-sm font-semibold">Tâches</h2>
            {execution.tasks.map((task, index) => (
              <Card key={task.id}>
                <CardContent className="space-y-3 p-4 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-muted text-xs font-medium">
                        {index + 1}
                      </span>
                      <div>
                        <h3 className="font-medium">{task.title}</h3>
                        {task.description && <p className="mt-1 text-sm text-muted-foreground">{task.description}</p>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{taskStatusLabels[task.status] ?? task.status}</Badge>
                      {task.attempts > 0 && (
                        <Badge variant="secondary">
                          {task.attempts} {task.attempts === 1 ? 'tentative' : 'tentatives'}
                        </Badge>
                      )}
                    </div>
                  </div>

                  {task.agent_profile_snapshot && (
                    <p className="text-xs text-muted-foreground">
                      Agent : {String(task.agent_profile_snapshot.name ?? 'Agent')}
                    </p>
                  )}
                  {task.dependencies.length > 0 && (
                    <p className="text-xs text-muted-foreground">Dépend de : {task.dependencies.join(', ')}</p>
                  )}
                  {task.error && <p role="alert" className="text-sm text-destructive">{task.error}</p>}
                  {task.result && (
                    <div className="rounded-lg bg-muted/60 p-3 text-sm leading-relaxed">
                      <p className="mb-1 text-xs font-medium text-muted-foreground">Résultat</p>
                      <p className="whitespace-pre-wrap">{task.result}</p>
                    </div>
                  )}
                  {task.status === 'awaiting_approval' && task.approval_id && (
                    <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                      <p className="text-sm font-medium">Cette action attend votre approbation</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Le système ne poursuit pas cette action avant votre décision explicite.
                      </p>
                      <div className="mt-3 flex gap-2">
                        <Button size="sm" disabled={busy} onClick={() => void decide(task.approval_id!, 'approve')}>
                          Approuver
                        </Button>
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => void decide(task.approval_id!, 'reject')}>
                          Refuser
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </section>

          <section aria-label="Résultats" className="space-y-3">
            <div>
              <h2 className="text-sm font-semibold">Résultats</h2>
              <p className="mt-1 text-xs text-muted-foreground">Fichiers produits par les tâches terminées.</p>
            </div>
            {artifacts.length > 0 ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {artifacts.map((artifact) => (
                  <Card key={artifact.id}>
                    <CardContent className="flex items-center justify-between gap-3 p-4">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{artifact.name}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {execution.tasks.find((task) => task.id === artifact.task_id)?.title ?? 'Tâche'}
                          {' · '}
                          {displayTime(artifact.created_at)}
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={downloadingId === artifact.id}
                        onClick={() => void downloadArtifact(artifact.id, artifact.name)}
                        aria-label={`Télécharger ${artifact.name}`}
                      >
                        {downloadingId === artifact.id
                          ? <LoaderCircle className="animate-spin" />
                          : <Download />}
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <Card><CardContent className="p-4 text-sm text-muted-foreground">Aucun résultat n’est disponible pour le moment.</CardContent></Card>
            )}
          </section>

          <section aria-label="Activité" className="space-y-3">
            <div className="flex items-center gap-2">
              <Clock3 className="size-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">Activité</h2>
            </div>
            {events.length > 0 ? (
              <ol aria-live="polite" className="space-y-0">
                {events.map((event) => (
                  <li key={event.id} className="relative flex gap-3 pb-4 last:pb-0">
                    <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary/70" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                        <p className="text-sm font-medium">{eventLabels[event.event_type] ?? 'Mise à jour'}</p>
                        <time className="text-xs text-muted-foreground">{displayTime(event.created_at)}</time>
                      </div>
                      <p className="mt-0.5 text-sm text-muted-foreground">{eventDescription(event)}</p>
                      <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                        <span>État : {taskStatusLabels[event.status] ?? executionStatusLabels[event.status as Execution['status']] ?? 'Inconnu'}</span>
                        {event.agent_id && (
                          <span>
                            Agent : {String(execution.tasks.find((task) => task.id === event.task_id)?.agent_profile_snapshot?.name ?? event.agent_id)}
                          </span>
                        )}
                      </div>
                      {event.task_id && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {execution.tasks.find((task) => task.id === event.task_id)?.title ?? 'Tâche'}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <Card><CardContent className="p-4 text-sm text-muted-foreground">Les événements apparaîtront ici au démarrage du workflow.</CardContent></Card>
            )}
          </section>

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Workflow className="size-4" />
            Les événements et résultats proviennent de l’exécution enregistrée.
          </div>
        </>
      )}
    </div>
  )
}
