import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { demoAgents } from '@/services/demo-data'
import { useMissionsStore } from '@/stores/use-missions-store'

const statusInfo = {
  active: { label: 'Actif', style: 'border-emerald-500/20 bg-emerald-500/8 text-emerald-700 dark:text-emerald-300' },
  idle: { label: 'Disponible', style: 'border-border bg-muted text-muted-foreground' },
  attention: { label: 'À vérifier', style: 'border-amber-500/20 bg-amber-500/8 text-amber-700 dark:text-amber-300' },
  paused: { label: 'En pause', style: 'border-border bg-muted text-muted-foreground' },
}
const avatarStyles = {
  violet: 'from-violet-500/15 to-indigo-500/10 text-violet-600 dark:text-violet-300',
  blue: 'from-sky-500/15 to-blue-500/10 text-blue-600 dark:text-blue-300',
  green: 'from-emerald-500/15 to-teal-500/10 text-emerald-700 dark:text-emerald-300',
  amber: 'from-amber-500/15 to-orange-500/10 text-amber-700 dark:text-amber-300',
}

export function AgentOverview() {
  const missions = useMissionsStore((state) => state.missions)
  const activeMissionIds = new Set(missions.filter((mission) => ['running', 'validating'].includes(mission.status)).map((mission) => mission.id))
  return <Card>
    <CardHeader className="flex-row items-center justify-between gap-3 space-y-0"><div><CardTitle>Aperçu des agents</CardTitle><CardDescription>État et charge actuelle</CardDescription></div><Link to="/agents" aria-label="Voir tous les agents" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><ArrowRight aria-hidden="true" className="size-4" /></Link></CardHeader>
    <CardContent className="space-y-3">{demoAgents.map((agent) => {
      const workload = missions.filter((mission) => activeMissionIds.has(mission.id) && mission.tasks.some((task) => task.assignedAgentId === agent.id && ['running', 'validating'].includes(task.status))).length
      return <div key={agent.id} className="flex items-center gap-3 rounded-lg px-1 py-1"><span className={`grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br text-xs font-semibold ${avatarStyles[agent.tone]}`}>{agent.initials}</span><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium">{agent.name}</p><p className="mt-0.5 truncate text-[10px] text-muted-foreground">{agent.role} · {workload} mission{workload === 1 ? '' : 's'}</p></div><Badge variant="outline" className={`h-5 px-1.5 text-[10px] ${statusInfo[agent.status].style}`}>{statusInfo[agent.status].label}</Badge></div>
    })}</CardContent>
  </Card>
}
