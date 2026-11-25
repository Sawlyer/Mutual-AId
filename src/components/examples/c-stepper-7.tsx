import { Badge } from '@/components/reui/badge'
import {
  Stepper,
  StepperContent,
  StepperIndicator,
  StepperItem,
  StepperNav,
  StepperPanel,
  StepperSeparator,
  StepperTitle,
  StepperTrigger,
} from '@/components/reui/stepper'
import { CheckIcon, CircleAlertIcon, LoaderCircleIcon } from 'lucide-react'
import type { ExecutionTask } from '@/types/execution'

interface ExecutionStepperProps {
  tasks: ExecutionTask[]
  value: number
  onValueChange: (step: number) => void
  assignmentReasons?: Record<string, string>
}

function taskStatusLabel(task: ExecutionTask) {
  switch (task.status) {
    case 'ready': return 'Prête'
    case 'running': return 'En cours'
    case 'awaiting_approval': return 'Approbation requise'
    case 'validating': return 'Vérification'
    case 'completed': return 'Terminée'
    case 'failed': return 'Échec'
    case 'blocked': return 'Bloquée'
    case 'paused': return 'En pause'
    case 'interrupted': return 'Interrompue'
    case 'cancelled': return 'Annulée'
    default: return 'En attente'
  }
}

function taskStatusVariant(task: ExecutionTask) {
  switch (task.status) {
    case 'completed': return 'success-light' as const
    case 'failed': return 'destructive-light' as const
    case 'blocked':
    case 'awaiting_approval': return 'warning-light' as const
    case 'ready':
    case 'running': return 'primary-light' as const
    case 'validating': return 'info-light' as const
    default: return 'secondary' as const
  }
}

function taskStatusIcon(task: ExecutionTask, index: number) {
  if (task.status === 'completed') return <CheckIcon className="size-4" />
  if (task.status === 'running') return <LoaderCircleIcon className="size-4" />
  if (task.status === 'failed' || task.status === 'blocked') return <CircleAlertIcon className="size-4" />
  return <span className="text-xs font-semibold">{index + 1}</span>
}

export function ExecutionStepper({ tasks, value, onValueChange, assignmentReasons = {} }: ExecutionStepperProps) {
  if (tasks.length === 0) return null

  return (
    <Stepper
      value={value}
      onValueChange={onValueChange}
      indicators={{ loading: <LoaderCircleIcon className="size-3.5 animate-spin" /> }}
      className="w-full space-y-4"
    >
      <StepperNav className="gap-1.5 overflow-x-auto pb-2">
        {tasks.map((task, index) => (
          <StepperItem
            key={task.id}
            step={index + 1}
            completed={task.status === 'completed'}
            loading={task.status === 'running'}
            className="relative min-w-[132px] max-w-[180px] flex-1 items-start"
          >
            <StepperTrigger
              aria-label={`Étape ${index + 1} : ${task.title}, ${taskStatusLabel(task)}`}
              className="flex min-h-[88px] min-w-0 grow flex-col items-start justify-start gap-1.5 rounded-lg border border-border/60 bg-background/50 p-2.5 text-left transition-colors hover:border-border hover:bg-muted/40 aria-selected:border-primary/35 aria-selected:bg-primary/[0.04] aria-selected:shadow-sm"
            >
              <StepperIndicator className="size-6 border-2 data-[state=inactive]:border-border data-[state=inactive]:bg-transparent data-[state=inactive]:text-muted-foreground data-[state=completed]:bg-success data-[state=completed]:text-white">
                {taskStatusIcon(task, index)}
              </StepperIndicator>
              <div className="flex min-w-0 flex-col items-start gap-1">
                <StepperTitle className="line-clamp-2 text-start text-xs font-semibold leading-snug group-data-[state=inactive]/step:text-muted-foreground">
                  {task.title}
                </StepperTitle>
                <Badge size="xs" variant={taskStatusVariant(task)}>{taskStatusLabel(task)}</Badge>
              </div>
            </StepperTrigger>

            {index < tasks.length - 1 && (
              <StepperSeparator className="group-data-[state=completed]/step:bg-success absolute inset-x-0 start-9 top-4 m-0 group-data-[orientation=horizontal]/stepper-nav:w-[calc(100%-2rem)] group-data-[orientation=horizontal]/stepper-nav:flex-none" />
            )}
          </StepperItem>
        ))}
      </StepperNav>

      <StepperPanel className="border-t pt-3 text-sm">
        {tasks.map((task, index) => (
          <StepperContent key={task.id} value={index + 1} className="space-y-1">
            {task.description && <p className="line-clamp-2 text-muted-foreground">{task.description}</p>}
            {typeof task.agent_profile_snapshot?.name === 'string' && task.agent_profile_snapshot.name.length > 0 && (
              <p className="text-xs text-muted-foreground">Agent affecté · {String(task.agent_profile_snapshot.name)}</p>
            )}
            {assignmentReasons[task.id] && <p className="text-xs text-muted-foreground">Pourquoi cet agent : {assignmentReasons[task.id]}</p>}
          </StepperContent>
        ))}
      </StepperPanel>
    </Stepper>
  )
}
