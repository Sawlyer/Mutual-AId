import { ActivityChart } from '@/features/dashboard/activity-chart'
import { RecentActivity } from '@/features/dashboard/recent-activity'
import { Card, CardContent } from '@/components/ui/card'
import { ArrowUpRight, CheckCircle2, Gauge, Workflow } from 'lucide-react'

const stats = [
  { label: 'Missions exécutées', value: '642', delta: '+8,2 %', icon: Workflow },
  { label: 'Tâches terminées', value: '4 812', delta: '+12,8 %', icon: CheckCircle2 },
  { label: 'Temps moyen', value: '2 min 18 s', delta: '−6,4 %', icon: Gauge },
]

export function AnalyticsPage() {
  return <div className="space-y-6">
    <div><p className="text-sm text-muted-foreground">Vue d’ensemble</p><h2 className="mt-1 font-heading text-2xl font-semibold tracking-tight">Analytics</h2><p className="mt-1 text-sm text-muted-foreground">Les indicateurs de votre orchestration, en un seul endroit.</p></div>
    <section className="grid gap-3 sm:grid-cols-3" aria-label="Indicateurs d’activité">{stats.map(({ label, value, delta, icon: Icon }) => <Card key={label}><CardContent className="p-4"><div className="flex items-center justify-between"><span className="text-xs font-medium text-muted-foreground">{label}</span><Icon aria-hidden="true" className="size-4 text-muted-foreground" /></div><div className="mt-3 flex items-end justify-between"><span className="font-heading text-2xl font-semibold tracking-tight">{value}</span><span className="inline-flex items-center gap-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300"><ArrowUpRight aria-hidden="true" className="size-3" />{delta}</span></div></CardContent></Card>)}</section>
    <section className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(300px,1fr)]"><ActivityChart /><RecentActivity /></section>
    <Card><CardContent className="p-5"><p className="text-sm font-medium">Période de référence</p><p className="mt-1 text-xs text-muted-foreground">Indicateurs simulés pour les 30 derniers jours. Les données détaillées seront connectées au backend dans une prochaine étape.</p></CardContent></Card>
  </div>
}
