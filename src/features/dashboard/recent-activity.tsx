import { Activity, Check, CircleAlert, Sparkles } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { recentActivity } from '@/services/demo-data'

const icons = [Check, Sparkles, Activity, CircleAlert]
const tones = ['text-emerald-600 bg-emerald-500/10', 'text-primary bg-primary/10', 'text-blue-600 bg-blue-500/10', 'text-amber-600 bg-amber-500/10']

export function RecentActivity() {
  return <Card>
    <CardHeader><CardTitle>Activité récente</CardTitle><CardDescription>Les derniers événements de votre espace</CardDescription></CardHeader>
    <CardContent className="space-y-0">
      {recentActivity.map((item, index) => { const Icon = icons[index]; return <div key={item.id} className="flex gap-3 border-t border-border/70 py-3 first:border-0 first:pt-0 last:pb-0">
        <span className={`grid size-8 shrink-0 place-items-center rounded-lg ${tones[index]}`}><Icon aria-hidden="true" className="size-4" /></span>
        <div className="min-w-0 flex-1"><p className="text-xs font-medium">{item.title}</p><p className="mt-1 truncate text-[11px] text-muted-foreground">{item.detail}</p></div>
        <time className="shrink-0 pt-0.5 text-[10px] text-muted-foreground">{item.time}</time>
      </div> })}
    </CardContent>
  </Card>
}
