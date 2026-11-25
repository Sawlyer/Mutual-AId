import { useEffect, useRef, useState } from 'react'
import { ArrowRight, CircleAlert, LoaderCircle, Workflow } from 'lucide-react'
import { useNavigate } from 'react-router'
import { Badge } from '@/components/reui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { executionService } from '@/services/execution-service'
import type { Execution } from '@/types/execution'
import type { ExecutionEvent } from '@/types/execution'
import { ExecutionStepper } from '@/components/examples/c-stepper-7'

const terminal = new Set<Execution['status']>(['completed', 'partial', 'failed', 'cancelled', 'interrupted'])
const statusLabel: Record<Execution['status'], string> = {
  planning: 'Planification',
  running: 'En cours',
  pausing: 'Mise en pause',
  paused: 'En pause',
  awaiting_approval: 'Approbation requise',
  validating: 'Revue du résultat',
  completed: 'Terminée',
  partial: 'Partiellement terminée',
  failed: 'Échec',
  cancelled: 'Annulée',
  interrupted: 'Interrompue',
}

interface ExecutionCardProps {
  executionId: string
  onComplete?: () => void
}

export function ExecutionCard({ executionId, onComplete }: ExecutionCardProps) {
  const [execution, setExecution] = useState<Execution | null>(null)
  const [events, setEvents] = useState<ExecutionEvent[]>([])
  const [activeTaskStep, setActiveTaskStep] = useState(1)
  const [error, setError] = useState('')
  const notified = useRef(false)
  const onCompleteRef = useRef(onComplete)
  const navigate = useNavigate()

  useEffect(() => { onCompleteRef.current = onComplete }, [onComplete])

  useEffect(() => {
    let active = true
    let unsubscribe = () => {}
    notified.current = false

    const refresh = async () => {
      try {
        const next = await executionService.get(executionId)
        if (!active) return
        setExecution(next)
        setError('')
        if (terminal.has(next.status) && !notified.current) {
          notified.current = true
          onCompleteRef.current?.()
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'Le suivi est indisponible.')
      }
    }

    const connect = async () => {
      try {
        const [current, initialEvents] = await Promise.all([
          executionService.get(executionId),
          executionService.listEvents(executionId),
        ])
        if (!active) return
        setExecution(current)
        setEvents(initialEvents)
        const activeIndex = current.tasks.findIndex((task) => ['running', 'awaiting_approval', 'validating', 'ready'].includes(task.status))
        const nextIndex = activeIndex >= 0 ? activeIndex : current.tasks.findIndex((task) => task.status !== 'completed')
        setActiveTaskStep(nextIndex >= 0 ? nextIndex + 1 : Math.max(1, current.tasks.length))
        setError('')
        if (terminal.has(current.status)) {
          if (!notified.current) {
            notified.current = true
            onCompleteRef.current?.()
          }
          return
        }
        unsubscribe = executionService.subscribe(executionId, {
          onEvent: (event) => {
            setEvents((previous) => previous.some((item) => item.id === event.id) ? previous : [...previous, event])
            void refresh()
          },
          onTerminal: () => { void refresh() },
        }, initialEvents.at(-1)?.id ?? 0)
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'Le suivi est indisponible.')
      }
    }

    void connect()
    return () => {
      active = false
      unsubscribe()
    }
  }, [executionId])

  const agentNames = execution
    ? [...new Set(execution.tasks.flatMap((task) => {
      const name = task.agent_profile_snapshot?.name
      return typeof name === 'string' && name.trim() ? [name.trim()] : []
    }))]
    : []
  const plannedConnectorIds = execution ? [...new Set(execution.tasks.flatMap((task) => task.connector_ids))] : []
  const completedTasks = execution?.tasks.filter((task) => task.status === 'completed').length ?? 0
  const assignmentReasons = Object.fromEntries(events
    .filter((event) => event.event_type === 'task.assigned' && event.task_id && event.message)
    .map((event) => [event.task_id as string, event.message]))

  return (
    <Card className="mt-4 max-w-2xl border-primary/15 bg-card/80">
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Workflow className="size-4 text-primary" />
            Orchestration multi-agents
          </div>
          {execution && <Badge variant="outline">{statusLabel[execution.status]}</Badge>}
        </div>

        {execution ? (
          <>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>{completedTasks}/{execution.tasks.length} tâches terminées</span>
              {agentNames.length > 0 && <span>{agentNames.length === 1 ? 'Agent' : 'Agents'} · {agentNames.join(', ')}</span>}
              {plannedConnectorIds.length > 0 && <span>{plannedConnectorIds.length} connecteur{plannedConnectorIds.length > 1 ? 's' : ''} prévu{plannedConnectorIds.length > 1 ? 's' : ''}</span>}
            </div>
            <ExecutionStepper
              tasks={execution.tasks}
              value={Math.min(activeTaskStep, execution.tasks.length)}
              onValueChange={setActiveTaskStep}
              assignmentReasons={assignmentReasons}
            />
            {terminal.has(execution.status) && <div className="flex flex-wrap items-start gap-2 rounded-lg border border-border/70 bg-muted/20 px-3 py-2 text-xs">
              <Badge variant={execution.result_review_status === 'verified' ? 'success-light' : execution.result_review_status === 'needs_review' || execution.result_review_status === 'unavailable' ? 'warning-light' : 'secondary'}>
                {execution.result_review_status === 'verified' ? 'Revue IA cohérente' : execution.result_review_status === 'needs_review' ? 'Revue IA : à vérifier' : execution.result_review_status === 'unavailable' ? 'Revue indisponible' : execution.result_review_status === 'skipped' ? 'Revue ignorée' : 'Revue en attente'}
              </Badge>
              {execution.result_review_feedback && <p className="min-w-0 flex-1 text-muted-foreground">{execution.result_review_feedback}</p>}
            </div>}
          </>
        ) : error ? (
          <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
            <CircleAlert className="size-4" />
            {error}
          </p>
        ) : (
          <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" />
            Chargement de l’exécution…
          </p>
        )}

        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={() => navigate(`/executions/${executionId}`)}>
            Voir le workflow
            <ArrowRight />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
