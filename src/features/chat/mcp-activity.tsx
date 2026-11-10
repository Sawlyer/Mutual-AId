import { Cable, LoaderCircle } from 'lucide-react'
import type { McpActivity } from '@/types/domain'

function byServer(items: McpActivity[]) {
  const groups: { server: string; calls: McpActivity[] }[] = []
  for (const item of items) {
    const current = groups.find((group) => group.server === item.server)
    if (current) current.calls.push(item)
    else groups.push({ server: item.server, calls: [item] })
  }
  return groups
}

export function McpActivityList({ items, live = false }: { items: McpActivity[]; live?: boolean }) {
  if (items.length === 0) return null
  return <section aria-label="Serveurs MCP appelés" aria-live={live ? 'polite' : undefined} className="mb-2 rounded-xl border border-border/80 bg-muted/40 px-3 py-2">
    <p className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground"><Cable aria-hidden="true" className="size-3" />Serveurs MCP appelés</p>
    <ul className="mt-1.5 space-y-1.5">
      {byServer(items).map((group) => <li key={group.server}>
        <p className="text-xs font-medium text-foreground">{group.server}</p>
        <ul className="mt-0.5 space-y-0.5">
          {group.calls.map((call) => <li key={call.id} className="flex min-w-0 items-center gap-2 pl-1 text-xs text-muted-foreground">
            {call.status === 'running'
              ? <LoaderCircle aria-hidden="true" className="size-3 shrink-0 animate-spin text-primary" />
              : <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${call.status === 'failed' ? 'bg-destructive' : 'bg-primary/70'}`} />}
            <span className="min-w-0 truncate">{call.tool}</span>
            {call.status === 'running' && <span className="shrink-0">en cours</span>}
            {call.status === 'failed' && <span className="shrink-0 text-destructive">échec</span>}
          </li>)}
        </ul>
      </li>)}
    </ul>
  </section>
}
