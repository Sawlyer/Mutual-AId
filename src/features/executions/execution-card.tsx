import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Bot, CircleAlert, LoaderCircle, Workflow } from 'lucide-react'
import { useNavigate } from 'react-router'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { executionService } from '@/services/execution-service'
import type { Execution } from '@/types/execution'

const terminal = new Set<Execution['status']>(['completed', 'partial', 'failed', 'cancelled', 'interrupted'])
const statusLabel: Record<Execution['status'], string> = {
  planning: 'Planification',
  running: 'En cours',
  pausing: 'Mise en pause',
  paused: 'En pause',
  awaiting_approval: 'Approbation requise',
  completed: 'Terminée',
  partial: 'Partiellement terminée',
  failed: 'Échec',
  cancelled: 'Annulée',
  interrupted: 'Interrompue',
}

interface ExecutionCardProps {
  executionId: string
  compact?: boolean
  onComplete?: () => void
}

export function ExecutionCard({ executionId, compact = false, onComplete }: ExecutionCardProps) {
  const [execution, setExecution] = useState<Execution | null>(null)
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
        const [current, events] = await Promise.all([
          executionService.get(executionId),
          executionService.listEvents(executionId),
        ])
        if (!active) return
        setExecution(current)
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
        }, events.at(-1)?.id ?? 0)
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

  const completed = execution?.tasks.filter((task) => task.status === 'completed').length ?? 0
  const total = execution?.tasks.length ?? 0
  const progress = total ? Math.round(completed / total * 100) : 0

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
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Bot className="size-3.5" />
                {new Set(execution.tasks.map((task) => task.agent_profile_id).filter(Boolean)).size} agents mobilisés
              </span>
              <span>{completed}/{total} tâches</span>
            </div>
            <Progress value={progress} aria-label={`Progression ${progress}%`} />
            {!compact && (
              <div className="space-y-2">
                {execution.tasks.map((task) => (
                  <div key={task.id} className="flex items-center justify-between gap-3 text-xs">
                    <span className="truncate">{task.title}</span>
                    <Badge variant="secondary">{task.status.replaceAll('_', ' ')}</Badge>
                  </div>
                ))}
              </div>
            )}
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
