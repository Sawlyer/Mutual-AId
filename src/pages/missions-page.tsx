import { useMemo, useState } from 'react'
import { ArrowUpRight, Search } from 'lucide-react'
import { Link } from 'react-router'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { MissionStatusBadge } from '@/features/missions/mission-status'
import { Progress } from '@/components/ui/progress'
import { useMissionsStore } from '@/stores/use-missions-store'
import type { MissionStatus } from '@/types/domain'

const filters: { label: string; value: MissionStatus | 'all' }[] = [
  { label: 'Toutes', value: 'all' }, { label: 'À faire', value: 'pending' },
  { label: 'Prêtes', value: 'ready' }, { label: 'En cours', value: 'running' },
  { label: 'Terminées', value: 'completed' }, { label: 'En échec', value: 'failed' },
  { label: 'Bloquées', value: 'blocked' }, { label: 'En pause', value: 'paused' },
]

const priorityStyles = {
  low: 'border-border text-muted-foreground', medium: 'border-sky-500/20 text-sky-700 dark:text-sky-300',
  high: 'border-amber-500/20 text-amber-700 dark:text-amber-300', urgent: 'border-destructive/20 text-destructive',
}

export function MissionsPage() {
  const missions = useMissionsStore((state) => state.missions)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<MissionStatus | 'all'>('all')
  const visible = useMemo(() => missions.filter((mission) => (filter === 'all' || mission.status === filter) && `${mission.title} ${mission.objective}`.toLocaleLowerCase('fr').includes(query.toLocaleLowerCase('fr'))), [filter, missions, query])

  return <div className="space-y-6">
    <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm text-muted-foreground">Orchestration</p><h2 className="mt-1 font-heading text-2xl font-semibold tracking-tight">Missions</h2><p className="mt-1 text-sm text-muted-foreground">Organisez et suivez vos missions multi-agents.</p></div><Button render={<Link to="/missions/new" />} nativeButton={false}>Nouvelle mission<ArrowUpRight aria-hidden="true" /></Button></div>
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="relative w-full sm:max-w-xs"><Search aria-hidden="true" className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input aria-label="Rechercher une mission" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher une mission…" className="h-9 pl-9" /></div><div className="flex max-w-full gap-1 overflow-x-auto pb-1" aria-label="Filtrer par état">{filters.map((item) => <button key={item.value} type="button" aria-pressed={filter === item.value} onClick={() => setFilter(item.value)} className={`shrink-0 rounded-lg px-3 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${filter === item.value ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}>{item.label}</button>)}</div></div>
    <div className="grid gap-3 lg:grid-cols-2">{visible.map((mission) => <Link key={mission.id} to={`/missions/${mission.id}`} aria-label={`${mission.title}, ${mission.progress}% terminé`} className="group block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Card className="h-full transition-colors group-hover:border-primary/30"><CardContent className="space-y-4 p-5"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="line-clamp-2 font-medium group-hover:text-primary">{mission.title}</p><p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{mission.objective}</p></div><MissionStatusBadge status={mission.status} /></div><div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-3"><div className="flex items-center gap-2"><Badge variant="outline" className={`h-5 text-[10px] ${priorityStyles[mission.priority]}`}>{mission.priority === 'urgent' ? 'Urgente' : mission.priority === 'high' ? 'Haute' : mission.priority === 'medium' ? 'Normale' : 'Basse'}</Badge><span className="text-[10px] text-muted-foreground">{mission.tasks.length} tâches</span></div><time className="text-[10px] text-muted-foreground">{new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' }).format(new Date(mission.createdAt))}</time></div><div className="flex items-center gap-2"><Progress value={mission.progress} /><span className="w-9 text-right text-[11px] tabular-nums text-muted-foreground">{mission.progress}%</span></div></CardContent></Card></Link>)}</div>
    {visible.length === 0 && <Card><CardContent className="py-14 text-center"><p className="font-medium">{missions.length === 0 ? 'Aucune mission pour le moment' : 'Aucune mission trouvée'}</p><p className="mt-1 text-sm text-muted-foreground">{missions.length === 0 ? 'Créez votre première mission pour commencer.' : 'Modifiez votre recherche ou votre filtre.'}</p>{missions.length === 0 && <Button render={<Link to="/missions/new" />} nativeButton={false} className="mt-4">Créer une mission</Button>}</CardContent></Card>}
  </div>
}
