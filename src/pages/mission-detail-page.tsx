import { useId, useState } from 'react'
import { ArrowLeft, CalendarDays, CheckCircle2, FileText, GitBranch, ListTodo } from 'lucide-react'
import { Link, useParams } from 'react-router'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { MissionStatusBadge } from '@/features/missions/mission-status'
import { demoAgents, demoArtifacts, demoValidationResults } from '@/services/demo-data'
import { useMissionsStore } from '@/stores/use-missions-store'
import type { Agent, ExecutionEvent, Mission, MissionPriority } from '@/types/domain'

type MissionTab = 'overview' | 'workflow' | 'tasks' | 'activity' | 'results'
const tabs: { id: MissionTab; label: string }[] = [
  { id: 'overview', label: 'Overview' }, { id: 'workflow', label: 'Workflow' },
  { id: 'tasks', label: 'Tasks' }, { id: 'activity', label: 'Activity' }, { id: 'results', label: 'Results' },
]
const priorityLabels: Record<MissionPriority, string> = { low: 'Basse', medium: 'Normale', high: 'Haute', urgent: 'Urgente' }
const avatarStyles = {
  violet: 'from-violet-500/15 to-indigo-500/10 text-violet-600 dark:text-violet-300',
  blue: 'from-sky-500/15 to-blue-500/10 text-blue-600 dark:text-blue-300',
  green: 'from-emerald-500/15 to-teal-500/10 text-emerald-700 dark:text-emerald-300',
  amber: 'from-amber-500/15 to-orange-500/10 text-amber-700 dark:text-amber-300',
}

function OverviewTab({ mission }: { mission: Mission }) {
  const allTasks = mission.tasks
  const completed = allTasks.filter((task) => task.status === 'completed').length
  const agentIds = [...new Set(allTasks.map((task) => task.assignedAgentId).filter((id): id is string => Boolean(id)))]
  const agents = agentIds.map((id) => demoAgents.find((agent) => agent.id === id)).filter((agent): agent is Agent => Boolean(agent))
  const nextTasks = allTasks.filter((task) => ['ready', 'pending'].includes(task.status)).slice(0, 3)
  return <div className="space-y-4">
    <Card><CardHeader><CardTitle>Objectif</CardTitle><CardDescription>Résultat attendu et consignes globales</CardDescription></CardHeader><CardContent className="space-y-4"><p className="text-sm leading-relaxed">{mission.objective}</p>{mission.constraints && <div className="rounded-lg bg-muted/60 p-3"><p className="text-[11px] font-semibold">Contraintes et instructions</p><p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">{mission.constraints}</p></div>}{mission.requestedTasks.length > 0 && <div><p className="text-[11px] font-semibold">Tâches imposées</p><ul className="mt-1 list-inside list-disc space-y-1 text-xs text-muted-foreground">{mission.requestedTasks.map((task, index) => <li key={`${task}-${index}`}>{task}</li>)}</ul></div>}<p className="text-[10px] text-muted-foreground">Plan {mission.planningMethod === 'user-defined' ? 'à partir des tâches définies par vous' : 'de démonstration déterministe'} · Aucun modèle IA utilisé.</p></CardContent></Card>
    <section aria-label="Indicateurs de mission" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Progression</p><p className="mt-2 font-heading text-2xl font-semibold">{mission.progress}%</p><Progress value={mission.progress} className="mt-2" /></CardContent></Card><Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Tâches terminées</p><p className="mt-2 font-heading text-2xl font-semibold">{completed}<span className="text-sm font-medium text-muted-foreground"> / {allTasks.length}</span></p></CardContent></Card><Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Agents impliqués</p><p className="mt-2 font-heading text-2xl font-semibold">{agents.length}</p></CardContent></Card><Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Agents maximum</p><p className="mt-2 font-heading text-2xl font-semibold">{mission.maxAgents}</p></CardContent></Card></section>
    <section className="grid gap-4 lg:grid-cols-2"><Card><CardHeader><CardTitle>Agents impliqués</CardTitle><CardDescription>Agents associés aux tâches de la mission</CardDescription></CardHeader><CardContent>{agents.length === 0 ? <p className="py-5 text-sm text-muted-foreground">Aucun agent affecté.</p> : <ul className="space-y-3">{agents.map((agent) => <li key={agent.id} className="flex items-center gap-3"><span className={`grid size-9 place-items-center rounded-xl bg-gradient-to-br text-xs font-semibold ${avatarStyles[agent.tone]}`}>{agent.initials}</span><div><p className="text-xs font-medium">{agent.name}</p><p className="mt-0.5 text-[10px] text-muted-foreground">{agent.role}</p></div></li>)}</ul>}</CardContent></Card><Card><CardHeader><CardTitle>Prochaines tâches</CardTitle><CardDescription>À démarrer après confirmation des dépendances</CardDescription></CardHeader><CardContent>{nextTasks.length === 0 ? <p className="py-5 text-sm text-muted-foreground">Aucune tâche en attente.</p> : <ul className="space-y-3">{nextTasks.map((task) => <li key={task.id} className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs font-medium">{task.title}</p><p className="mt-1 truncate text-[10px] text-muted-foreground">{task.assignedAgentId ? demoAgents.find((agent) => agent.id === task.assignedAgentId)?.name : 'Agent à déterminer'}</p></div><MissionStatusBadge status={task.status} /></li>)}</ul>}</CardContent></Card></section>
  </div>
}

function WorkflowTab({ mission }: { mission: Mission }) {
  const taskById = new Map(mission.tasks.map((task) => [task.id, task]))
  if (!mission.tasks.length) return <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">Le workflow ne contient pas encore de tâches.</CardContent></Card>
  return <Card><CardHeader><CardTitle className="flex items-center gap-2"><GitBranch aria-hidden="true" className="size-4 text-primary" />Graphe d’exécution</CardTitle><CardDescription>Les flèches textuelles indiquent les dépendances. Les tâches sans dépendance peuvent démarrer immédiatement.</CardDescription></CardHeader><CardContent><ol className="space-y-3">{mission.tasks.map((task, index) => { const agent = demoAgents.find((item) => item.id === task.assignedAgentId); const parallel = task.parallelGroupId && mission.tasks.filter((item) => item.parallelGroupId === task.parallelGroupId).length > 1; return <li key={task.id} className="relative flex gap-3"><div className="flex w-8 shrink-0 flex-col items-center"><span className="grid size-7 place-items-center rounded-full border border-border bg-background text-[10px] font-semibold tabular-nums">{index + 1}</span>{index < mission.tasks.length - 1 && <span className="mt-1 h-full min-h-5 w-px bg-border" />}</div><div className="mb-2 min-w-0 flex-1 rounded-xl border border-border p-4"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-xs font-semibold">{task.title}</h3><MissionStatusBadge status={task.status} /></div><p className="mt-1 text-[11px] text-muted-foreground">{task.dependencies.length ? `Dépend de : ${task.dependencies.map((id) => taskById.get(id)?.title ?? id).join(', ')}` : 'Aucune dépendance · prête à démarrer'}</p><div className="mt-3 flex flex-wrap gap-1.5">{task.requiredSkills?.map((skill) => <Badge key={skill} variant="secondary" className="h-5 text-[10px]">{skill}</Badge>)}{agent && <span className="ml-auto text-[10px] text-muted-foreground">{agent.name}</span>}{parallel && <Badge variant="outline" className="h-5 border-sky-500/20 text-[10px] text-sky-700 dark:text-sky-300">Groupe parallèle</Badge>}</div></div></li> })}</ol></CardContent></Card>
}

function TasksTab({ mission }: { mission: Mission }) {
  const [expanded, setExpanded] = useState<string | null>(null)
  if (!mission.tasks.length) return <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">Aucune tâche définie. Le plan sera visible ici.</CardContent></Card>
  return <Card><CardHeader><CardTitle>Tâches</CardTitle><CardDescription>{mission.tasks.length} tâches · ouvre une ligne pour afficher instructions et dépendances</CardDescription></CardHeader><CardContent className="space-y-2">{mission.tasks.map((task) => { const agent = demoAgents.find((item) => item.id === task.assignedAgentId); const isOpen = expanded === task.id; return <article key={task.id} className="rounded-lg border border-border/80"><button type="button" aria-expanded={isOpen} onClick={() => setExpanded(isOpen ? null : task.id)} className="flex w-full flex-wrap items-center gap-3 p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><span className="min-w-0 flex-1 text-xs font-medium">{task.title}</span><MissionStatusBadge status={task.status} /><span className="text-[10px] text-muted-foreground">{agent?.name ?? 'Non affecté'}</span></button>{isOpen && <div className="space-y-3 border-t border-border px-3 py-3"><p className="whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">{task.description || 'Aucune instruction supplémentaire.'}</p><div className="flex flex-wrap gap-1.5">{task.requiredSkills?.map((skill) => <Badge key={skill} variant="secondary" className="h-5 text-[10px]">{skill}</Badge>)}</div><p className="text-[10px] text-muted-foreground">{task.dependencies.length ? `Dépendances : ${task.dependencies.map((id) => mission.tasks.find((item) => item.id === id)?.title ?? id).join(' · ')}` : 'Aucune dépendance'} · {task.attempts} tentative{task.attempts === 1 ? '' : 's'}</p></div>}</article> })}</CardContent></Card>
}

function ActivityTab({ mission, events }: { mission: Mission; events: ExecutionEvent[] }) {
  const missionEvents = events.filter((event) => event.missionId === mission.id).sort((a, b) => b.timestamp.localeCompare(a.timestamp))
  if (!missionEvents.length) return <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">Aucune activité enregistrée pour cette mission.</CardContent></Card>
  return <Card><CardHeader><CardTitle>Journal d’activité</CardTitle><CardDescription>Événements de la mission et des agents</CardDescription></CardHeader><CardContent><ol className="space-y-4">{missionEvents.map((event) => { const agent = demoAgents.find((item) => item.id === event.agentId); const task = mission.tasks.find((item) => item.id === event.taskId); const time = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(event.timestamp)); return <li key={event.id} className="flex gap-3 border-l-2 border-border pb-1 pl-4"><span className="-ml-[21px] mt-1 size-2.5 shrink-0 rounded-full border-2 border-background bg-primary" /><div className="min-w-0 flex-1"><div className="flex flex-wrap justify-between gap-2"><p className="text-xs font-medium">{agent ? `${agent.name} · ` : ''}{event.type.replaceAll('.', ' ')}</p><time className="text-[10px] text-muted-foreground">{time}</time></div><p className="mt-1 text-xs text-muted-foreground">{event.message}</p>{task && <p className="mt-1 text-[10px] text-primary">{task.title}</p>}</div></li> })}</ol></CardContent></Card>
}

function ResultsTab({ mission }: { mission: Mission }) {
  const artifacts = demoArtifacts.filter((artifact) => artifact.missionId === mission.id)
  const validations = demoValidationResults.filter((result) => mission.tasks.some((task) => task.id === result.taskId))
  return <div className="grid gap-4 lg:grid-cols-2"><Card><CardHeader><CardTitle>Artefacts</CardTitle><CardDescription>Fichiers et contenus produits par les agents</CardDescription></CardHeader><CardContent>{artifacts.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">Aucun livrable disponible pour cette mission.</p> : <ul className="space-y-3">{artifacts.map((artifact) => <li key={artifact.id} className="flex items-start gap-3 rounded-lg border border-border/80 p-3"><span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/8 text-primary"><FileText aria-hidden="true" className="size-4" /></span><div className="min-w-0"><p className="truncate text-xs font-medium">{artifact.name}</p><p className="mt-1 text-[10px] text-muted-foreground">{artifact.type.toUpperCase()} · {artifact.content}</p></div></li>)}</ul>}</CardContent></Card><Card><CardHeader><CardTitle>Validations</CardTitle><CardDescription>Résultats des contrôles humains ou automatisés</CardDescription></CardHeader><CardContent>{validations.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">Aucun résultat de validation disponible.</p> : <ul className="space-y-3">{validations.map((result) => { const task = mission.tasks.find((item) => item.id === result.taskId); const passed = result.status === 'passed'; return <li key={result.taskId} className="flex gap-3 rounded-lg border border-border/80 p-3"><span className={`mt-0.5 ${passed ? 'text-emerald-600' : result.status === 'failed' ? 'text-destructive' : 'text-amber-600'}`}><CheckCircle2 aria-hidden="true" className="size-4" /></span><div><p className="text-xs font-medium">{task?.title ?? result.taskId} · {passed ? 'Réussie' : result.status === 'failed' ? 'À corriger' : 'En attente'}</p><p className="mt-1 text-[11px] text-muted-foreground">{result.feedback}</p></div></li> })}</ul>}</CardContent></Card></div>
}

export function MissionDetailPage() {
  const { missionId } = useParams()
  const pageId = useId()
  const [activeTab, setActiveTab] = useState<MissionTab>('overview')
  const missions = useMissionsStore((state) => state.missions)
  const events = useMissionsStore((state) => state.events)
  const mission = missions.find((item) => item.id === missionId)

  if (!mission) return <Card><CardContent className="py-14 text-center"><h2 className="font-heading text-xl font-semibold">Mission introuvable</h2><p className="mt-2 text-sm text-muted-foreground">Cette mission n’est pas présente dans les données de démonstration.</p><Button render={<Link to="/missions" />} nativeButton={false} className="mt-5">Retour aux missions</Button></CardContent></Card>

  const createdAt = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(mission.createdAt))
  return <div className="space-y-6">
    <Link to="/missions" className="inline-flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground"><ArrowLeft aria-hidden="true" className="size-3.5" />Toutes les missions</Link>
    <section className="space-y-4"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="mb-2 flex flex-wrap items-center gap-2"><MissionStatusBadge status={mission.status} /><Badge variant="outline" className="h-6 text-[11px]">Priorité {priorityLabels[mission.priority].toLowerCase()}</Badge><span className="text-[11px] text-muted-foreground">{mission.id}</span></div><h2 className="max-w-4xl font-heading text-2xl font-semibold tracking-tight sm:text-3xl">{mission.title}</h2><p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">{mission.objective}</p></div></div>
      <Card><CardContent className="grid gap-4 p-4 sm:grid-cols-[1fr_auto_auto] sm:items-center"><div><div className="flex items-center justify-between gap-3 text-xs"><span className="font-medium">Progression globale</span><span className="tabular-nums text-muted-foreground">{mission.progress}%</span></div><Progress value={mission.progress} className="mt-2" /></div><span className="inline-flex items-center gap-2 text-xs text-muted-foreground"><ListTodo aria-hidden="true" className="size-4" />{mission.tasks.length} tâches</span><span className="inline-flex items-center gap-2 text-xs text-muted-foreground"><CalendarDays aria-hidden="true" className="size-4" />{createdAt}</span></CardContent></Card>
    </section>

    <div role="tablist" aria-label="Sections de la mission" className="flex max-w-full gap-1 overflow-x-auto border-b border-border">{tabs.map((tab) => <button key={tab.id} type="button" id={`${pageId}-${tab.id}-tab`} role="tab" aria-selected={activeTab === tab.id} aria-controls={`${pageId}-${tab.id}-panel`} onClick={() => setActiveTab(tab.id)} className={`shrink-0 border-b-2 px-3 py-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${activeTab === tab.id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>{tab.label}</button>)}</div>
    <section id={`${pageId}-${activeTab}-panel`} role="tabpanel" aria-labelledby={`${pageId}-${activeTab}-tab`} tabIndex={0}>
      {activeTab === 'overview' && <OverviewTab mission={mission} />}
      {activeTab === 'workflow' && <WorkflowTab mission={mission} />}
      {activeTab === 'tasks' && <TasksTab mission={mission} />}
      {activeTab === 'activity' && <ActivityTab mission={mission} events={events} />}
      {activeTab === 'results' && <ResultsTab mission={mission} />}
    </section>
  </div>
}
