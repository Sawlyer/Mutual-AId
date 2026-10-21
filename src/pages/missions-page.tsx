import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { MissionDialog } from '@/features/missions/mission-dialog'
import { MissionStatusBadge } from '@/features/missions/mission-status'
import { Progress } from '@/components/ui/progress'
import { useMissionsStore } from '@/stores/use-missions-store'
import type { MissionStatus } from '@/types/domain'

const filters: { label: string; value: MissionStatus | 'all' }[] = [
  { label: 'Toutes', value: 'all' }, { label: 'En cours', value: 'running' }, { label: 'En attente', value: 'queued' }, { label: 'Terminées', value: 'completed' }, { label: 'En pause', value: 'paused' },
]

export function MissionsPage() {
  const missions = useMissionsStore((state) => state.missions)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<MissionStatus | 'all'>('all')
  const visible = useMemo(() => missions.filter((mission) => (filter === 'all' || mission.status === filter) && `${mission.name} ${mission.objective}`.toLocaleLowerCase('fr').includes(query.toLocaleLowerCase('fr'))), [filter, missions, query])
  return <div className="space-y-6">
    <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm text-muted-foreground">Orchestration</p><h2 className="mt-1 font-heading text-2xl font-semibold tracking-tight">Missions</h2><p className="mt-1 text-sm text-muted-foreground">Organisez et suivez vos missions multi-agents.</p></div><MissionDialog /></div>
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="relative w-full sm:max-w-xs"><Search aria-hidden="true" className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input aria-label="Rechercher une mission" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher une mission…" className="h-9 pl-9" /></div><div className="flex max-w-full gap-1 overflow-x-auto pb-1" aria-label="Filtrer par état">{filters.map((item) => <button key={item.value} type="button" aria-pressed={filter === item.value} onClick={() => setFilter(item.value)} className={`shrink-0 rounded-lg px-3 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${filter === item.value ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}>{item.label}</button>)}</div></div>
    <div className="grid gap-3 lg:grid-cols-2">{visible.map((mission) => <Card key={mission.id}><CardContent className="space-y-4 p-5"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate font-medium">{mission.name}</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{mission.objective}</p></div><MissionStatusBadge status={mission.status} /></div><div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-3"><div className="flex items-center gap-2">{mission.agents.map((agent) => <span key={agent} className="rounded-md bg-muted px-2 py-1 text-[10px] font-medium text-muted-foreground">{agent}</span>)}</div><time className="text-[10px] text-muted-foreground">{mission.updatedAt}</time></div><div className="flex items-center gap-2"><Progress value={mission.progress} /><span className="w-9 text-right text-[11px] tabular-nums text-muted-foreground">{mission.progress}%</span></div></CardContent></Card>)}</div>
    {visible.length === 0 && <Card><CardContent className="py-14 text-center"><p className="font-medium">Aucune mission trouvée</p><p className="mt-1 text-sm text-muted-foreground">Modifiez votre recherche ou créez une mission.</p></CardContent></Card>}
  </div>
}
