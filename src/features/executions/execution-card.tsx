import { useEffect, useRef, useState } from 'react'
import { ArrowRight, CircleAlert, LoaderCircle, Workflow } from 'lucide-react'
import { useNavigate } from 'react-router'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { executionService } from '@/services/execution-service'
import type { Execution } from '@/types/execution'
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
          onEvent: () => { void refresh() },
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
            <p className="text-sm text-muted-foreground">{execution.summary}</p>
            <ExecutionStepper
              tasks={execution.tasks}
              value={Math.min(activeTaskStep, execution.tasks.length)}
              onValueChange={setActiveTaskStep}
            />
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
