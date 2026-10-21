import { Link } from 'react-router'
import { Activity, Bot, CircleAlert, Play, ShieldCheck, Sparkles } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { demoAgents } from '@/services/demo-data'
import { useMissionsStore } from '@/stores/use-missions-store'

const eventMeta = {
  'mission.created': { title: 'Mission créée', icon: Sparkles, tone: 'text-primary bg-primary/10' },
  'task.started': { title: 'Tâche démarrée', icon: Play, tone: 'text-blue-600 bg-blue-500/10' },
  'task.validating': { title: 'Validation', icon: ShieldCheck, tone: 'text-violet-600 bg-violet-500/10' },
  'task.completed': { title: 'Tâche terminée', icon: Activity, tone: 'text-emerald-600 bg-emerald-500/10' },
  'task.failed': { title: 'Vérification requise', icon: CircleAlert, tone: 'text-amber-600 bg-amber-500/10' },
  'agent.assigned': { title: 'Agent affecté', icon: Bot, tone: 'text-sky-600 bg-sky-500/10' },
} as const

export function RecentActivity() {
  const events = useMissionsStore((state) => state.events)
  const missions = useMissionsStore((state) => state.missions)
  const recent = [...events].sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 4)
  return <Card>
    <CardHeader><CardTitle>Activité récente</CardTitle><CardDescription>Événements partagés avec le dashboard</CardDescription></CardHeader>
    <CardContent>{recent.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">Aucune activité pour le moment.</p> : <ul className="space-y-3">{recent.map((event) => { const meta = eventMeta[event.type]; const Icon = meta.icon; const mission = missions.find((item) => item.id === event.missionId); const agent = demoAgents.find((item) => item.id === event.agentId); const time = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(new Date(event.timestamp)); return <li key={event.id} className="flex gap-3 border-t border-border/70 pt-3 first:border-0 first:pt-0"><span className={`grid size-8 shrink-0 place-items-center rounded-lg ${meta.tone}`}><Icon aria-hidden="true" className="size-4" /></span><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-2"><p className="text-xs font-medium">{meta.title}</p><time className="shrink-0 text-[10px] text-muted-foreground">{time}</time></div><p className="mt-1 truncate text-[11px] text-muted-foreground">{agent ? `${agent.name} · ` : ''}{event.message}</p>{mission && <Link to={`/missions/${mission.id}`} className="mt-1 block truncate text-[10px] text-primary hover:underline">{mission.title}</Link>}</div></li>})}</ul>}</CardContent>
  </Card>
}
