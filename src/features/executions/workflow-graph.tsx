import { memo, useMemo, useState } from 'react'
import {
  Background, BackgroundVariant, Controls, Handle, MiniMap, Position, ReactFlow,
  type Edge, type Node, type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Badge } from '@/components/ui/badge'
import type { Execution, ExecutionTask } from '@/types/execution'

type TaskNodeData = { task: ExecutionTask }
type TaskNodeType = Node<TaskNodeData, 'task'>

const statusStyles: Record<string, string> = {
  pending: 'border-border bg-card text-muted-foreground', ready: 'border-blue-500/30 bg-blue-500/5 text-blue-700 dark:text-blue-300',
  running: 'border-violet-500/40 bg-violet-500/8 text-violet-700 dark:text-violet-300', completed: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300',
  failed: 'border-destructive/30 bg-destructive/5 text-destructive', blocked: 'border-orange-500/30 bg-orange-500/5 text-orange-700 dark:text-orange-300',
  awaiting_approval: 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300', validating: 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300',
}

const TaskNodeView = memo(function TaskNodeView({ data }: NodeProps<TaskNodeType>) {
  const { task } = data
  const agent = task.agent_profile_snapshot?.name
  return <div className={`w-[232px] rounded-xl border p-3 shadow-sm ${statusStyles[task.status] ?? statusStyles.pending} ${task.status === 'running' ? 'ring-2 ring-violet-500/15' : ''}`}>
    <Handle type="target" position={Position.Left} className="!size-2 !border-0 !bg-muted-foreground/60" />
    <div className="flex items-start justify-between gap-2"><p className="line-clamp-2 min-h-10 text-xs font-semibold leading-5 text-foreground">{task.title}</p><Badge variant="outline" className="h-5 shrink-0 px-1.5 text-[9px] capitalize">{task.status.replaceAll('_', ' ')}</Badge></div>
    <p className="mt-2 truncate text-[10px] text-muted-foreground">{typeof agent === 'string' ? agent : task.capability_ids.join(' · ') || 'Assistant'}</p>
    {task.result && <p className="mt-2 line-clamp-2 border-t border-border/60 pt-2 text-[10px] leading-4 text-muted-foreground">{task.result}</p>}
    <Handle type="source" position={Position.Right} className="!size-2 !border-0 !bg-primary/70" />
  </div>
})

const nodeTypes = { task: TaskNodeView }

function positionTasks(tasks: ExecutionTask[]): TaskNodeType[] {
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const levels = new Map<string, number>()
  const resolveLevel = (id: string, visiting = new Set<string>()): number => {
    if (levels.has(id)) return levels.get(id) ?? 0
    if (visiting.has(id)) return 0
    visiting.add(id)
    const task = byId.get(id)
    const level = task?.dependencies.length
      ? 1 + Math.max(...task.dependencies.map((dependency) => byId.has(dependency) ? resolveLevel(dependency, new Set(visiting)) : -1))
      : 0
    levels.set(id, Math.max(0, level))
    return Math.max(0, level)
  }
  tasks.forEach((task) => resolveLevel(task.id))
  const rowsByLevel = new Map<number, number>()
  return tasks.map((task) => {
    const level = levels.get(task.id) ?? 0
    const row = rowsByLevel.get(level) ?? 0
    rowsByLevel.set(level, row + 1)
    return { id: task.id, type: 'task', position: { x: level * 300, y: row * 150 }, data: { task }, draggable: false, selectable: true } as TaskNodeType
  })
}

export function WorkflowGraph({ execution }: { execution: Execution }) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const nodes = useMemo(() => positionTasks(execution.tasks), [execution.tasks])
  const edges: Edge[] = useMemo(() => {
    const validIds = new Set(execution.tasks.map((task) => task.id))
    return execution.tasks.flatMap((task) => task.dependencies
      .filter((dependency) => validIds.has(dependency))
      .map((dependency) => ({ id: `${dependency}-${task.id}`, source: dependency, target: task.id, animated: task.status === 'running', style: { stroke: 'var(--color-border)', strokeWidth: 1.5 } })))
  }, [execution.tasks])
  const selected = execution.tasks.find((task) => task.id === selectedId) ?? null
  if (execution.tasks.length === 0) return <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">Cette exécution ne contient aucune tâche.</div>

  return <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
    <section className="space-y-2 sm:hidden" aria-label="Liste du workflow">
      {execution.tasks.map((task, index) => <button type="button" key={task.id} onClick={() => setSelectedId(task.id)} aria-pressed={selectedId === task.id} className="w-full rounded-xl border bg-card p-4 text-left shadow-sm aria-pressed:border-primary/50 aria-pressed:ring-2 aria-pressed:ring-primary/10">
        <span className="flex items-start justify-between gap-3"><span className="flex items-start gap-3"><span className="grid size-6 shrink-0 place-items-center rounded-md bg-muted text-xs">{index + 1}</span><span className="font-medium">{task.title}</span></span><Badge variant="outline" className="shrink-0 capitalize">{task.status.replaceAll('_', ' ')}</Badge></span>
        {task.dependencies.length > 0 && <span className="mt-2 block pl-9 text-xs text-muted-foreground">Dépend de : {task.dependencies.join(', ')}</span>}
      </button>)}
    </section>
    <div className="hidden h-[540px] overflow-hidden rounded-xl border bg-muted/15 sm:block xl:h-[620px]" aria-label="Graphe des dépendances">
      <ReactFlow<TaskNodeType, Edge> nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.2 }} minZoom={0.2} maxZoom={1.5} nodesConnectable={false} nodesDraggable={false} onNodeClick={(_, node) => setSelectedId(node.id)}>
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--color-border)" />
        <Controls position="bottom-left" />
        <MiniMap position="bottom-right" pannable zoomable nodeColor={(node) => statusStyles[(node.data as TaskNodeData).task.status]?.includes('emerald') ? '#10b981' : '#818cf8'} />
      </ReactFlow>
    </div>
    <aside aria-label="Détails de la tâche" className="rounded-xl border bg-card p-4">
      {selected ? <TaskDetails task={selected} /> : <div className="flex min-h-24 items-center justify-center text-center text-sm text-muted-foreground">Sélectionnez une tâche pour voir ses détails.</div>}
    </aside>
  </div>
}

function TaskDetails({ task }: { task: ExecutionTask }) {
  const agent = task.agent_profile_snapshot?.name
  return <div className="space-y-4"><div><p className="text-xs text-muted-foreground">Tâche</p><h2 className="mt-1 font-semibold">{task.title}</h2><Badge className="mt-2 capitalize" variant="outline">{task.status.replaceAll('_', ' ')}</Badge></div>
    {task.description && <section><h3 className="text-xs font-medium">Description</h3><p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{task.description}</p></section>}
    <section><h3 className="text-xs font-medium">Agent</h3><p className="mt-1 text-sm text-muted-foreground">{typeof agent === 'string' ? agent : 'Assistant'}</p></section>
    {task.dependencies.length > 0 && <section><h3 className="text-xs font-medium">Dépendances</h3><ul className="mt-1 list-inside list-disc text-sm text-muted-foreground">{task.dependencies.map((item) => <li key={item}>{item}</li>)}</ul></section>}
    {task.expected_output && <section><h3 className="text-xs font-medium">Résultat attendu</h3><p className="mt-1 text-sm text-muted-foreground">{task.expected_output}</p></section>}
    {task.result && <section><h3 className="text-xs font-medium">Résultat</h3><p className="mt-1 max-h-56 overflow-y-auto whitespace-pre-wrap rounded-lg bg-muted/60 p-3 text-sm">{task.result}</p></section>}
    {task.error && <section><h3 className="text-xs font-medium text-destructive">Erreur</h3><p className="mt-1 text-sm text-destructive">{task.error}</p></section>}
  </div>
}
