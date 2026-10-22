import { Cable, CalendarDays, Check, GitBranch, HardDrive, LockKeyhole, Mail, PlugZap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import type { ConnectorCatalogItem } from '@/services/chat-adapters'

const icons = { mail: Mail, drive: HardDrive, calendar: CalendarDays, github: GitBranch, mcp: Cable } as const

interface ConnectorSelectorProps {
  connectors: ConnectorCatalogItem[]
  selectedIds: string[]
  onChange: (connectorIds: string[]) => void
}

export function ConnectorSelector({ connectors, selectedIds, onChange }: ConnectorSelectorProps) {
  const enabledCount = selectedIds.length
  return <Dialog>
    <DialogTrigger render={<Button type="button" variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-xs text-muted-foreground" aria-label="Choisir les connecteurs de cette conversation" />}>
      <PlugZap aria-hidden="true" className="size-3.5" />Connecteurs<span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums">{enabledCount}</span>
    </DialogTrigger>
    <DialogContent className="max-h-[min(80svh,620px)] max-w-lg overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Connecteurs de la conversation</DialogTitle>
        <DialogDescription>Choisissez les services que l’assistant pourra utiliser. Chaque outil sera limité aux permissions affichées.</DialogDescription>
      </DialogHeader>
      {connectors.length === 0 ? <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">Le catalogue des connecteurs n’a pas pu être chargé.</p> : <div className="space-y-2">
        {connectors.map((connector) => {
          const Icon = icons[connector.icon as keyof typeof icons] ?? Cable
          const usable = connector.availability === 'available' && connector.status === 'connected'
          const selected = selectedIds.includes(connector.id)
          return <label key={connector.id} className={`flex cursor-pointer gap-3 rounded-xl border p-3.5 transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring ${usable ? 'hover:border-primary/30 hover:bg-muted/30' : 'cursor-not-allowed bg-muted/20 opacity-80'}`}>
            <input type="checkbox" className="sr-only" checked={selected} disabled={!usable} onChange={(event) => onChange(event.target.checked ? [...selectedIds, connector.id] : selectedIds.filter((id) => id !== connector.id))} aria-label={`${selected ? 'Désactiver' : 'Activer'} ${connector.name} pour cette conversation`} />
            <span aria-hidden="true" className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg ${selected ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>{selected ? <Check className="size-4" /> : <Icon className="size-4" />}</span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2 text-sm font-medium">{connector.name}<span className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium ${usable ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-muted text-muted-foreground'}`}>{connector.status === 'error' ? 'Erreur' : connector.status === 'connected' ? 'Connecté' : 'Déconnecté'}</span>{connector.availability === 'coming_soon' && <span className="rounded-full bg-primary/5 px-1.5 py-0.5 text-[9px] text-primary">Bientôt disponible</span>}</span>
              <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{connector.description}</span>
              <span className="mt-2 flex items-start gap-1.5 text-[10px] leading-relaxed text-muted-foreground"><LockKeyhole aria-hidden="true" className="mt-0.5 size-3 shrink-0" /><span>{connector.required_scopes.map((permission) => `${permission.access === 'write' ? 'Écriture' : 'Lecture'} : ${permission.label}`).join(' · ')}</span></span>
            </span>
          </label>
        })}
      </div>}
      <p role="note" className="text-[11px] leading-relaxed text-muted-foreground">Les connecteurs « bientôt disponibles » ne peuvent pas encore être activés. Les modifications sont enregistrées sur la conversation.</p>
    </DialogContent>
  </Dialog>
}
