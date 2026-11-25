import { useEffect, useState } from 'react'
import { ArrowLeft, Check, Circle, CircleAlert, Clock3, Download, Eye, LoaderCircle, Pause, Play, Square, X } from 'lucide-react'
import { Link, useParams } from 'react-router'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { executionService } from '@/services/execution-service'
import type { Execution, ExecutionArtifact, ExecutionArtifactContent, ExecutionEvent } from '@/types/execution'
import { WorkflowGraph } from '@/features/executions/workflow-graph'
import { ArtifactPreview } from '@/features/executions/artifact-preview'
import { inspectResultCompleteness } from '@/features/executions/result-completeness'
import { Timeline, TimelineContent, TimelineDate, TimelineHeader, TimelineIndicator, TimelineItem, TimelineSeparator, TimelineTitle } from '@/components/reui/timeline'

const terminal = new Set<Execution['status']>(['completed', 'partial', 'failed', 'cancelled', 'interrupted'])
const executionStatusLabels: Record<Execution['status'], string> = {
  planning: 'Planification',
  running: 'En cours',
  pausing: 'Mise en pause',
  paused: 'En pause',
  awaiting_approval: 'Approbation requise',
  validating: 'Revue du résultat',
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
  'execution.validating': 'Revue du résultat en cours',
  'execution.review_verified': 'Résultat vérifié par l’agent IA',
  'execution.review_needs_attention': 'La revue IA recommande une vérification',
  'execution.review_unavailable': 'Revue IA indisponible',
  'execution.review_skipped': 'Revue IA ignorée',
  'execution.completed': 'Exécution terminée',
  'execution.partial': 'Exécution partielle',
  'execution.failed': 'Exécution échouée',
  'execution.cancelled': 'Exécution annulée',
  'execution.interrupted': 'Exécution interrompue',
  'task.ready': 'Tâche prête',
  'task.assigned': 'Agent sélectionné',
  'task.started': 'Agent au travail',
  'task.retrying': 'Nouvelle tentative planifiée',
  'task.replanned': 'Consigne de tâche révisée',
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
  const [previewingId, setPreviewingId] = useState<string | null>(null)
  const [previewArtifact, setPreviewArtifact] = useState<ExecutionArtifactContent | null>(null)
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

  async function previewArtifactContent(artifactId: string) {
    setPreviewingId(artifactId)
    try {
      setPreviewArtifact(await executionService.getArtifact(executionId, artifactId))
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Le résultat n’a pas pu être affiché.')
    } finally {
      setPreviewingId(null)
    }
  }

  const resultCompleteness = execution
    ? inspectResultCompleteness(execution.status, execution.tasks, artifacts)
    : null

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

          <WorkflowGraph execution={execution} busy={busy} onDecide={decide} />

          {resultCompleteness && (
            <Card aria-live="polite">
              <CardContent className="space-y-1 p-4">
                <p className="text-sm font-medium">
                  {resultCompleteness.status === 'complete'
                    ? execution.result_review_status === 'verified'
                      ? 'Résultat vérifié par l’agent IA'
                      : execution.result_review_status === 'needs_review'
                        ? 'Résultat à vérifier'
                        : execution.result_review_status === 'unavailable'
                          ? 'Revue IA indisponible'
                          : execution.result_review_status === 'skipped'
                            ? 'Revue IA ignorée'
                            : execution.status === 'validating'
                              ? 'Vérification du résultat en cours'
                              : 'Résultat complet'
                    : resultCompleteness.status === 'partial'
                      ? 'Résultat partiel'
                      : 'Vérification de complétude en cours'}
                </p>
                <p className="text-sm text-muted-foreground">
                  {resultCompleteness.status === 'complete'
                    ? execution.result_review_feedback ?? 'Chaque tâche terminée possède un résultat archivé.'
                    : resultCompleteness.status === 'partial'
                      ? `${resultCompleteness.completedTasks}/${resultCompleteness.totalTasks} tâches ont produit un résultat archivé.`
                      : 'Les résultats seront vérifiés lorsque les tâches et leurs fichiers seront enregistrés.'}
                </p>
                {resultCompleteness.missingTaskIds.length > 0 && terminal.has(execution.status) && (
                  <p className="text-xs text-muted-foreground">
                    À vérifier : {resultCompleteness.missingTaskIds.map((id) => execution.tasks.find((task) => task.id === id)?.title ?? id).join(', ')}
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {(artifacts.length > 0 || previewArtifact) && <section aria-label="Résultats" className="space-y-3">
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
                        variant="ghost"
                        size="sm"
                        disabled={previewingId === artifact.id}
                        onClick={() => void previewArtifactContent(artifact.id)}
                        aria-label={`Afficher ${artifact.name}`}
                      >
                        {previewingId === artifact.id ? <LoaderCircle className="animate-spin" /> : <Eye />}
                        <span className="sr-only sm:not-sr-only">Aperçu</span>
                      </Button>
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
            ) : null}
            {previewArtifact && (
              <Card>
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground">Aperçu du résultat</p>
                      <h3 className="truncate text-sm font-medium">{previewArtifact.name}</h3>
                    </div>
                    <Button variant="ghost" size="icon" aria-label="Fermer l’aperçu" onClick={() => setPreviewArtifact(null)}>
                      <X />
                    </Button>
                  </div>
                  <ArtifactPreview content={previewArtifact.content} mediaType={previewArtifact.media_type} />
                </CardContent>
              </Card>
            )}
          </section>}

          <section aria-label="Activité" className="space-y-3">
            <div className="flex items-center gap-2">
              <Clock3 className="size-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">Activité</h2>
            </div>
            {events.length > 0 ? (
              <Timeline value={events.length} aria-live="polite" className="w-full">
                {events.map((event, index) => {
                  const failed = ['failed', 'blocked', 'cancelled'].includes(event.status)
                  const done = ['completed', 'verified'].includes(event.status)
                  const running = ['running', 'validating'].includes(event.status)
                  const Icon = failed ? CircleAlert : done ? Check : running ? LoaderCircle : Circle
                  const task = execution.tasks.find((item) => item.id === event.task_id)
                  return <TimelineItem key={event.id} step={index + 1} className="group-data-[orientation=vertical]/timeline:ms-9 group-data-[orientation=vertical]/timeline:not-last:pb-5">
                    <TimelineHeader>
                      {index < events.length - 1 && <TimelineSeparator className="group-data-[orientation=vertical]/timeline:-left-6 group-data-[orientation=vertical]/timeline:h-[calc(100%-1.5rem)] group-data-[orientation=vertical]/timeline:translate-y-6" />}
                      <TimelineTitle className="mt-0.5 text-sm font-medium">{eventLabels[event.event_type] ?? 'Mise à jour'}</TimelineTitle>
                      <TimelineIndicator className={`group-data-[orientation=vertical]/timeline:-left-6 flex size-5 items-center justify-center border-none text-muted-foreground ${done ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : failed ? 'bg-destructive/10 text-destructive' : running ? 'bg-primary/10 text-primary' : 'bg-muted'}`}>
                        <Icon aria-hidden="true" className="size-3" />
                      </TimelineIndicator>
                    </TimelineHeader>
                    <TimelineContent className="text-sm">
                      <p>{eventDescription(event)}</p>
                      <div className="mt-1 flex flex-wrap gap-x-3 text-xs">
                        <span>{taskStatusLabels[event.status] ?? executionStatusLabels[event.status as Execution['status']] ?? event.status}</span>
                        {task && <span>{task.title}</span>}
                        {event.agent_id && <span>Agent · {String(task?.agent_profile_snapshot?.name ?? event.agent_id)}</span>}
                      </div>
                      <TimelineDate dateTime={event.created_at} className="mt-1 mb-0 text-xs">{displayTime(event.created_at)}</TimelineDate>
                    </TimelineContent>
                  </TimelineItem>
                })}
              </Timeline>
            ) : (
              <Card><CardContent className="p-4 text-sm text-muted-foreground">Les événements apparaîtront ici au démarrage du workflow.</CardContent></Card>
            )}
          </section>

        </>
      )}
    </div>
  )
}
