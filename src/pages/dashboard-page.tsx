import { ArrowRight, Bot, CheckCircle2, ListTodo, Workflow } from 'lucide-react'
import { Link } from 'react-router'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { AgentActivity } from '@/features/dashboard/agent-activity'
import { AgentOverview } from '@/features/dashboard/agent-overview'
import { TaskStatusDistribution } from '@/features/dashboard/task-status-distribution'
import { MissionStatusBadge } from '@/features/missions/mission-status'
import { demoAgents } from '@/services/demo-data'
import { useMissionsStore } from '@/stores/use-missions-store'

function Metric({ label, value, note, icon: Icon }: { label: string; value: number; note: string; icon: typeof Workflow }) {
  return <Card><CardContent className="flex items-start justify-between p-4 sm:p-5"><div><p className="text-xs font-medium text-muted-foreground">{label}</p><p className="mt-2 font-heading text-2xl font-semibold tracking-tight tabular-nums">{value}</p><p className="mt-1 text-[11px] text-muted-foreground">{note}</p></div><span className="grid size-9 place-items-center rounded-xl bg-primary/8 text-primary"><Icon aria-hidden="true" className="size-[18px]" /></span></CardContent></Card>
}

export function DashboardPage() {
  const missions = useMissionsStore((state) => state.missions)
  const tasks = missions.flatMap((mission) => mission.tasks)
  const activeMissions = missions.filter((mission) => mission.status === 'running').length
  const completedTasks = tasks.filter((task) => task.status === 'completed').length
  const activeAgents = demoAgents.filter((agent) => agent.status === 'active').length
  const recentMissions = [...missions].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5)
  const today = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())

  return <div className="space-y-7">
    <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm capitalize text-muted-foreground">{today}</p><h2 className="mt-1 font-heading text-2xl font-semibold tracking-tight">Bonjour Maya <span aria-hidden="true">✦</span></h2><p className="mt-1 text-sm text-muted-foreground">Supervisez vos missions et l’activité de vos agents.</p></div><div className="flex items-center gap-3"><Badge variant="outline" className="h-7 gap-1.5 border-amber-500/20 bg-amber-500/5 px-2.5 text-[11px] text-amber-700 dark:text-amber-300">Données simulées</Badge><Button render={<Link to="/missions/new" />} nativeButton={false}>Nouvelle mission</Button></div></div>

    <section aria-label="Indicateurs clés" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Metric label="Missions totales" value={missions.length} note="Dans votre espace de travail" icon={Workflow} />
      <Metric label="Missions actives" value={activeMissions} note="En cours d’exécution" icon={ListTodo} />
      <Metric label="Tâches terminées" value={completedTasks} note={`Sur ${tasks.length} tâches au total`} icon={CheckCircle2} />
      <Metric label="Agents actifs" value={activeAgents} note={`Sur ${demoAgents.length} agents configurés`} icon={Bot} />
    </section>

    <section className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(300px,1fr)]">
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3 space-y-0"><div><CardTitle>Missions récentes</CardTitle><p className="mt-1 text-xs text-muted-foreground">Ouvrez une mission pour inspecter ses tâches et livrables.</p></div><Link to="/missions" aria-label="Voir toutes les missions" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><ArrowRight aria-hidden="true" className="size-4" /></Link></CardHeader>
        <CardContent className="space-y-1">{recentMissions.length === 0 ? <div className="py-10 text-center"><p className="text-sm font-medium">Aucune mission créée</p><p className="mt-1 text-xs text-muted-foreground">Créez une mission pour démarrer votre espace.</p><Button render={<Link to="/missions/new" />} nativeButton={false} size="sm" className="mt-4">Nouvelle mission</Button></div> : recentMissions.map((mission) => <Link to={`/missions/${mission.id}`} key={mission.id} className="grid gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:grid-cols-[minmax(0,1fr)_100px_130px_90px] sm:items-center"><div className="min-w-0"><p className="line-clamp-1 text-sm font-medium">{mission.title}</p><p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{mission.objective}</p></div><div className="flex -space-x-1.5">{[...new Set(mission.tasks.map((task) => task.assignedAgentId).filter((id): id is string => id !== null))].slice(0, 3).map((agentId) => { const agent = demoAgents.find((item) => item.id === agentId); return agent ? <span key={agent.id} title={agent.name} className="grid size-7 place-items-center rounded-full border-2 border-card bg-secondary text-[9px] font-semibold text-secondary-foreground">{agent.initials}</span> : null })}</div><div className="flex items-center gap-2"><Progress value={mission.progress} className="max-w-20" /><span className="text-[11px] text-muted-foreground">{mission.progress}%</span></div><MissionStatusBadge status={mission.status} /></Link>)}</CardContent>
      </Card>
      <AgentActivity />
    </section>

    <section className="grid gap-4 lg:grid-cols-2"><AgentOverview /><TaskStatusDistribution /></section>
  </div>
}
