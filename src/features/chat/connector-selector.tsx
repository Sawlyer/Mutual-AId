import { Cable, CalendarDays, Check, CircleAlert, GitBranch, HardDrive, LockKeyhole, Mail, PlugZap, X } from 'lucide-react'
import { Link } from 'react-router'
import { Badge } from '@/components/reui/badge'
import { Frame, FramePanel } from '@/components/reui/frame'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import type { ConnectorCatalogItem } from '@/services/chat-adapters'

const icons = { mail: Mail, drive: HardDrive, calendar: CalendarDays, github: GitBranch, mcp: Cable } as const

interface ConnectorSelectorProps {
  connectors: ConnectorCatalogItem[]
  selectedIds: string[]
  onChange: (connectorIds: string[]) => void
}

function connectorStatus(connector: ConnectorCatalogItem, usable: boolean, selected: boolean) {
  if (connector.status === 'error') return { label: 'Erreur', variant: 'destructive-light' as const }
  if (usable && selected) return { label: 'Dans le chat', variant: 'success-light' as const }
  if (usable) return { label: 'Connecté', variant: 'info-light' as const }
  if (connector.id.startsWith('mcp:')) {
    return connector.available_tools.length
      ? { label: 'Désactivé', variant: 'warning-light' as const }
      : { label: 'À approuver', variant: 'warning-light' as const }
  }
  return connector.status === 'connected'
    ? { label: 'Indisponible', variant: 'warning-light' as const }
    : { label: 'Déconnecté', variant: 'warning-light' as const }
}

export function ConnectorSelector({ connectors, selectedIds, onChange }: ConnectorSelectorProps) {
  const enabledCount = selectedIds.length
  const hasUnavailable = connectors.some((connector) => connector.availability !== 'available' || connector.status !== 'connected')

  function toggle(connectorId: string, selected: boolean) {
    onChange(selected
      ? [...selectedIds, connectorId]
      : selectedIds.filter((id) => id !== connectorId))
  }

  return <Dialog>
    <DialogTrigger render={<Button type="button" variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-xs text-muted-foreground" aria-label="Choisir les connecteurs de cette conversation" />}>
      <PlugZap aria-hidden="true" className="size-3.5" />Connecteurs<span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums">{enabledCount}</span>
    </DialogTrigger>
    <DialogContent showCloseButton={false} className="max-h-[min(82svh,680px)] w-[min(680px,calc(100vw-1rem))] max-w-none overflow-hidden border-0 bg-transparent p-0 text-sm shadow-none ring-0 sm:max-w-none">
      <Frame spacing="sm" className="min-h-0 min-w-0">
        <FramePanel className="flex min-h-0 min-w-0 flex-col gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><PlugZap className="size-4" /></span>
            <DialogHeader className="min-w-0 flex-1 gap-1">
              <DialogTitle>Connecteurs</DialogTitle>
              <DialogDescription>Choisis les services disponibles pour cette conversation.</DialogDescription>
            </DialogHeader>
            <DialogClose render={<Button type="button" variant="ghost" size="icon-sm" aria-label="Fermer les connecteurs" />}><X /></DialogClose>
          </div>

          {connectors.length === 0 ? <div className="space-y-3 rounded-lg border border-dashed p-5 text-center"><p className="text-sm text-muted-foreground">Aucun connecteur disponible pour le moment.</p><Link to="/connectors" className="text-sm font-medium text-primary underline-offset-4 transition-colors hover:underline">Ouvrir les connecteurs</Link></div> : <>
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-medium text-muted-foreground">Applications</p>
              <Badge variant={enabledCount ? 'primary-light' : 'outline'}>{enabledCount} active{enabledCount === 1 ? '' : 's'}</Badge>
            </div>

            <div className="grid min-h-0 grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3" aria-label="Services connectés">
              {connectors.map((connector) => {
                const Icon = icons[connector.icon as keyof typeof icons] ?? Cable
                const usable = connector.availability === 'available' && connector.status === 'connected'
                const selected = selectedIds.includes(connector.id)
                const status = connectorStatus(connector, usable, selected)
                const permissions = connector.required_scopes.map((permission) => `${permission.access === 'write' ? 'Écriture' : 'Lecture'} · ${permission.label}`).join(' · ')

                return <button
                  type="button"
                  key={connector.id}
                  aria-pressed={selected}
                  aria-label={`${selected ? 'Désactiver' : 'Activer'} ${connector.name} pour cette conversation`}
                  disabled={!usable && !selected}
                  onClick={() => toggle(connector.id, !selected)}
                  className={`flex min-w-0 flex-col items-start gap-2 rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-65 ${selected ? 'border-primary/45 bg-primary/5' : 'border-border bg-card hover:bg-muted/40'} ${!usable && !selected ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  <span className="flex w-full items-center justify-between gap-2">
                    <span aria-hidden="true" className={`grid size-8 shrink-0 place-items-center rounded-lg ${selected ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
                      {selected ? <Check className="size-4" /> : connector.status === 'error' ? <CircleAlert className="size-4" /> : <Icon className="size-4" />}
                    </span>
                    <Badge variant={status.variant}>{status.label}</Badge>
                  </span>
                  <span className="w-full truncate text-sm font-medium text-foreground">{connector.name}</span>
                  <span className="line-clamp-2 min-h-8 text-xs leading-relaxed text-muted-foreground">{connector.description}</span>
                  <span className="flex items-start gap-1.5 border-t border-border/70 pt-2 text-xs leading-relaxed text-muted-foreground">
                    <LockKeyhole aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                    <span className="line-clamp-2">{permissions || 'Aucune permission supplémentaire'}</span>
                  </span>
                </button>
              })}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 pt-3">
              <p className="text-xs text-muted-foreground">{enabledCount} service{enabledCount === 1 ? '' : 's'} autorisé{enabledCount === 1 ? '' : 's'} dans ce chat</p>
              {hasUnavailable && <Link to="/connectors" className="text-xs font-medium text-primary underline-offset-4 transition-colors hover:underline">Gérer les connecteurs</Link>}
            </div>
            <p role="note" className="text-xs leading-relaxed text-muted-foreground">Les accès indiqués sont limités aux permissions affichées.</p>
          </>}
        </FramePanel>
      </Frame>
    </DialogContent>
  </Dialog>
}
