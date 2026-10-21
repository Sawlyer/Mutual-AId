import { useState } from 'react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { activityMonth, activityWeek } from '@/services/demo-data'

export function ActivityChart() {
  const [period, setPeriod] = useState<'7 jours' | '30 jours'>('7 jours')
  const data = period === '7 jours' ? activityWeek : activityMonth
  return <Card className="min-w-0">
    <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
      <div><CardTitle>Activité des missions</CardTitle><CardDescription className="mt-1">Volume de missions et tâches traitées</CardDescription></div>
      <div className="flex rounded-lg border border-border p-0.5" aria-label="Période du graphique">
        {(['7 jours', '30 jours'] as const).map((item) => <Button key={item} type="button" size="sm" variant={period === item ? 'secondary' : 'ghost'} className="h-7 px-2 text-[11px]" aria-pressed={period === item} onClick={() => setPeriod(item)}>{item}</Button>)}
      </div>
    </CardHeader>
    <CardContent className="pt-3">
      <div className="h-[240px] w-full" role="img" aria-label={`Graphique d'activité sur ${period}`}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
            <defs><linearGradient id="missions-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--primary)" stopOpacity={0.18} /><stop offset="95%" stopColor="var(--primary)" stopOpacity={0} /></linearGradient></defs>
            <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 5" />
            <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }} dy={9} />
            <YAxis axisLine={false} tickLine={false} tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }} />
            <Tooltip cursor={{ stroke: 'var(--border)', strokeDasharray: '4 4' }} contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--popover-foreground)', fontSize: 12 }} />
            <Area type="monotone" dataKey="tasks" name="Tâches" stroke="var(--primary)" strokeWidth={2} fill="url(#missions-fill)" />
            <Area type="monotone" dataKey="missions" name="Missions" stroke="var(--chart-2)" strokeWidth={1.7} fill="transparent" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-1 flex justify-center gap-5 text-[11px] text-muted-foreground"><span className="inline-flex items-center gap-2"><i className="size-2 rounded-full bg-primary" />Tâches</span><span className="inline-flex items-center gap-2"><i className="size-2 rounded-full bg-[var(--chart-2)]" />Missions</span></div>
    </CardContent>
  </Card>
}
