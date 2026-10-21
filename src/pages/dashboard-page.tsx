import { ArrowUpRight, Bot, CheckCircle2, CircleDot, Workflow } from 'lucide-react'
import { Link } from 'react-router'
import { ActivityChart } from '@/features/dashboard/activity-chart'
import { RecentActivity } from '@/features/dashboard/recent-activity'
import { MissionStatusBadge } from '@/features/missions/mission-status'
import { Progress } from '@/components/ui/progress'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { demoAgents } from '@/services/demo-data'
import { useMissionsStore } from '@/stores/use-missions-store'

function Metric({ label, value, note, icon: Icon }: { label: string; value: string; note: string; icon: typeof Workflow }) {
  return <Card><CardContent className="flex items-start justify-between p-4 sm:p-5"><div><p className="text-xs font-medium text-muted-foreground">{label}</p><p className="mt-2 font-heading text-2xl font-semibold tracking-tight">{value}</p><p className="mt-1 text-[11px] text-muted-foreground">{note}</p></div><span className="grid size-9 place-items-center rounded-xl bg-primary/8 text-primary"><Icon aria-hidden="true" className="size-[18px]" /></span></CardContent></Card>
}

export function DashboardPage() {
  const missions = useMissionsStore((state) => state.missions)
  const running = missions.filter((mission) => mission.status === 'running')
  const completed = missions.filter((mission) => mission.status === 'completed')
  return <div className="space-y-7">
    <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm text-muted-foreground">Mardi 21 octobre 2026</p><h2 className="mt-1 font-heading text-2xl font-semibold tracking-tight">Bonjour Maya <span aria-hidden="true">✦</span></h2><p className="mt-1 text-sm text-muted-foreground">Voici ce qui se passe dans votre espace aujourd’hui.</p></div><Button nativeButton={false} render={<Link to="/missions" />} variant="outline">Voir les missions<ArrowUpRight aria-hidden="true" /></Button></div>
    <section aria-label="Indicateurs clés" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Metric label="Missions actives" value={String(running.length)} note="En cours d’exécution" icon={Workflow} />
      <Metric label="Agents disponibles" value={`${demoAgents.filter((agent) => agent.status !== 'attention').length} / ${demoAgents.length}`} note="Prêts à intervenir" icon={Bot} />
      <Metric label="Tâches terminées" value="1 284" note="+12,8 % sur 7 jours" icon={CheckCircle2} />
      <Metric label="Taux de réussite" value="98,4 %" note="Sur les 30 derniers jours" icon={CircleDot} />
    </section>
    <section className="grid gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(300px,1fr)]"><ActivityChart /><RecentActivity /></section>
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0"><div><CardTitle>Missions récentes</CardTitle><p className="mt-1 text-xs text-muted-foreground">Suivez l’avancement de vos derniers workflows.</p></div><Button nativeButton={false} render={<Link to="/missions" />} variant="ghost" size="sm">Tout voir<ArrowUpRight aria-hidden="true" /></Button></CardHeader>
      <CardContent className="space-y-1">{missions.slice(0, 3).map((mission) => <Link to="/missions" key={mission.id} className="grid gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-muted/60 sm:grid-cols-[minmax(0,1fr)_110px_140px_100px] sm:items-center">
        <div className="min-w-0"><p className="truncate text-sm font-medium">{mission.name}</p><p className="mt-1 truncate text-xs text-muted-foreground">{mission.objective}</p></div>
        <div className="flex -space-x-1.5">{mission.agents.slice(0, 3).map((agent) => <span key={agent} title={agent} className="grid size-7 place-items-center rounded-full border-2 border-card bg-secondary text-[9px] font-semibold text-secondary-foreground">{agent.slice(0, 2).toUpperCase()}</span>)}</div>
        <div className="flex items-center gap-2"><Progress value={mission.progress} className="max-w-20" /><span className="text-[11px] text-muted-foreground">{mission.progress}%</span></div>
        <MissionStatusBadge status={mission.status} />
      </Link>)}</CardContent>
      {completed.length === 0 && <span className="sr-only">Aucune mission terminée pour le moment.</span>}
    </Card>
  </div>
}
