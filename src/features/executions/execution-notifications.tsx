import { useCallback, useEffect, useRef, useState } from 'react'
import { CircleAlert, CircleCheck, ExternalLink, X } from 'lucide-react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { chatAdapter } from '@/services/chat-adapters'
import { executionService } from '@/services/execution-service'
import type { Execution, ExecutionStatus } from '@/types/execution'
import { shouldNotifyExecution, subscribeToExecutionTracking } from './execution-tracking'

const terminalStatuses = new Set<ExecutionStatus>(['completed', 'partial', 'failed', 'cancelled', 'interrupted'])
const terminalLabels: Record<ExecutionStatus, string> = {
  planning: 'Planification', running: 'En cours', pausing: 'Pause demandée', paused: 'En pause',
  awaiting_approval: 'Approbation requise', validating: 'Vérification', completed: 'Terminée',
  partial: 'Partielle', failed: 'En échec', cancelled: 'Annulée', interrupted: 'Interrompue',
}

interface ExecutionNotice {
  execution: Execution
}

export function ExecutionNotifications() {
  const [notices, setNotices] = useState<ExecutionNotice[]>([])
  const subscriptions = useRef(new Map<string, () => void>())
  const seenTerminalIds = useRef(new Set<string>())
  const timers = useRef(new Map<string, number>())
  const dismissNotice = useCallback((id: string) => {
    setNotices((current) => current.filter((notice) => notice.execution.id !== id))
    const timer = timers.current.get(id)
    if (timer !== undefined) window.clearTimeout(timer)
    timers.current.delete(id)
  }, [])

  useEffect(() => {
    if (chatAdapter.mode !== 'openai') return
    let active = true
    let refreshing = false
    const activeSubscriptions = subscriptions.current
    const activeSeenTerminalIds = seenTerminalIds.current
    const activeTimers = timers.current

    const showNotice = (execution: Execution) => {
      if (!active || !shouldNotifyExecution(execution.conversation_id, window.location.pathname) || activeSeenTerminalIds.has(execution.id)) return
      activeSeenTerminalIds.add(execution.id)
      setNotices((current) => [...current.filter((notice) => notice.execution.id !== execution.id), { execution }].slice(-3))
      timers.current.set(execution.id, window.setTimeout(() => dismissNotice(execution.id), 9000))
    }

    const handleTerminal = async (id: string, status: ExecutionStatus) => {
      if (!terminalStatuses.has(status) || activeSeenTerminalIds.has(id)) return
      activeSubscriptions.get(id)?.()
      activeSubscriptions.delete(id)
      try {
        const execution = await executionService.get(id)
        if (active && execution.status === status) showNotice(execution)
      } catch {
        // A failed status fetch should not expose stale or incomplete execution data.
      }
    }

    const attach = (execution: Execution, notifyIfAlreadyTerminal = false) => {
      if (!active || activeSubscriptions.has(execution.id)) return
      if (terminalStatuses.has(execution.status)) {
        if (notifyIfAlreadyTerminal) showNotice(execution)
        return
      }
      const unsubscribe = executionService.subscribe(execution.id, {
        onEvent: () => undefined,
        onTerminal: (terminal) => { void handleTerminal(execution.id, terminal.status) },
      })
      activeSubscriptions.set(execution.id, unsubscribe)
    }

    const track = (id: string) => {
      void executionService.get(id).then((execution) => attach(execution, true)).catch(() => undefined)
    }

    const refreshActive = async () => {
      if (refreshing) return
      refreshing = true
      try {
        const executions = await executionService.list()
        if (active) executions.filter((execution) => !terminalStatuses.has(execution.status)).forEach((execution) => attach(execution))
      } catch {
        // Existing event streams continue if the list endpoint is briefly unavailable.
      } finally {
        refreshing = false
      }
    }

    const unsubscribeTracking = subscribeToExecutionTracking(track)
    void refreshActive()
    const poll = window.setInterval(() => { void refreshActive() }, 15_000)

    return () => {
      active = false
      unsubscribeTracking()
      window.clearInterval(poll)
      activeSubscriptions.forEach((unsubscribe) => unsubscribe())
      activeSubscriptions.clear()
      activeTimers.forEach((timer) => window.clearTimeout(timer))
      activeTimers.clear()
      activeSeenTerminalIds.clear()
    }
  }, [dismissNotice])

  if (notices.length === 0) return null

  return (
    <div aria-live="polite" aria-relevant="additions" className="fixed right-4 top-20 z-[70] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2">
      {notices.map(({ execution }) => {
        const successful = execution.status === 'completed'
        const Icon = successful ? CircleCheck : CircleAlert
        const title = successful ? 'Exécution terminée' : `Exécution ${terminalLabels[execution.status].toLocaleLowerCase('fr')}`
        return (
          <div key={execution.id} className="flex items-start gap-3 rounded-xl border border-border/80 bg-card p-4 text-card-foreground shadow-lg shadow-black/10 ring-1 ring-foreground/5">
            <span className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg ${successful ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning-foreground'}`}>
              <Icon aria-hidden="true" className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{title}</p>
              <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{execution.summary || 'Votre workflow a terminé.'}</p>
              <Link to={`/executions/${execution.id}`} className="mt-2 inline-flex min-h-7 items-center gap-1 text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                Voir le résultat <ExternalLink aria-hidden="true" className="size-3" />
              </Link>
            </div>
            <Button variant="ghost" size="icon-xs" onClick={() => dismissNotice(execution.id)} aria-label="Fermer la notification">
              <X aria-hidden="true" />
            </Button>
          </div>
        )
      })}
    </div>
  )
}
