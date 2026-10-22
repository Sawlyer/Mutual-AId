import { useEffect, useState } from 'react'
import { CalendarDays, Cable, Check, Clock3, GitBranch, HardDrive, Mail, PlugZap, ShieldCheck, TriangleAlert, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { chatAdapter, type ConnectorCatalogItem, type ConnectorStatus } from '@/services/chat-adapters'

const icons = { mail: Mail, drive: HardDrive, calendar: CalendarDays, github: GitBranch, mcp: Cable } as const
const statusLabels: Record<ConnectorStatus, string> = { connected: 'Connecté', disconnected: 'Déconnecté', error: 'Erreur' }

export function ConnectorsPage() {
  const [connectors, setConnectors] = useState<ConnectorCatalogItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const oauthParams = new URLSearchParams(window.location.search)
  const notice = oauthParams.get('connected') === 'google_calendar' ? 'Google Calendar est connecté en lecture seule.' : null
  const oauthError = oauthParams.get('oauth_error')
  const oauthErrorMessage = oauthError ? oauthError === 'denied' ? 'La connexion Google a été annulée.' : 'La connexion Google n’a pas abouti. Vérifiez la configuration OAuth puis réessayez.' : null

  useEffect(() => {
    let cancelled = false
    void chatAdapter.listConnectors()
      .then((items) => { if (!cancelled) { setConnectors(items); setError(null) } })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Le catalogue ne peut pas être chargé.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])


  return <div className="mx-auto max-w-5xl space-y-6">
    <div className="flex items-start gap-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-primary/15 bg-primary/5 text-primary"><PlugZap aria-hidden="true" className="size-5" /></span>
      <div><p className="text-sm text-muted-foreground">Services externes</p><h2 className="mt-0.5 font-heading text-2xl font-semibold tracking-tight">Connecteurs</h2><p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">Les agents n’accèdent qu’aux services connectés et sélectionnés pour la conversation.</p></div>
    </div>

    <div className="grid gap-3 md:grid-cols-2">
      {connectors.map((connector) => {
        const Icon = icons[connector.icon as keyof typeof icons] ?? Cable
        return <ConnectorCard key={connector.id} connector={connector} Icon={Icon} />
      })}
    </div>

    {loading && <p role="status" className="text-sm text-muted-foreground">Chargement du catalogue…</p>}
    {(error || oauthErrorMessage) && <p role="alert" className="rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive">{error || oauthErrorMessage}</p>}
    {notice && <p role="status" className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-sm text-emerald-700 dark:text-emerald-300">{notice}</p>}
    {!loading && !error && connectors.length === 0 && <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">Aucun connecteur au catalogue.</CardContent></Card>}
    <p className="flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck aria-hidden="true" className="size-4 shrink-0" />Les identifiants et jetons restent côté backend. Les connecteurs en préparation ne sont pas accessibles aux agents.</p>
  </div>
}

function ConnectorCard({ connector, Icon }: { connector: ConnectorCatalogItem; Icon: LucideIcon }) {
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const comingSoon = connector.availability === 'coming_soon'
  const setupRequired = connector.availability === 'setup_required'
  const [setupOpen, setSetupOpen] = useState(false)
  const statusTone = connector.status === 'connected' ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300'
    : connector.status === 'error' ? 'border-destructive/20 bg-destructive/5 text-destructive'
      : 'border-border bg-muted/40 text-muted-foreground'
  return <Card className="h-full border-border/80 shadow-sm shadow-black/[0.02]">
    <CardContent className="flex h-full flex-col gap-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <span className="grid size-10 place-items-center rounded-xl border border-border/80 bg-muted/50 text-foreground"><Icon aria-hidden="true" className="size-[18px]" /></span>
        <div className="flex flex-wrap justify-end gap-1.5">
          <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-medium ${statusTone}`}>{connector.status === 'connected' ? <Check className="size-3" /> : connector.status === 'error' ? <TriangleAlert className="size-3" /> : null}{statusLabels[connector.status]}</span>
          {comingSoon && <span className="inline-flex items-center gap-1 rounded-full border border-primary/15 bg-primary/5 px-2 py-1 text-[10px] font-medium text-primary"><Clock3 aria-hidden="true" className="size-3" />Bientôt disponible</span>}
          {setupRequired && <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/20 bg-amber-500/5 px-2 py-1 text-[10px] font-medium text-amber-700 dark:text-amber-300"><TriangleAlert aria-hidden="true" className="size-3" />Configuration requise</span>}
        </div>
      </div>
      <div><h3 className="font-heading text-base font-semibold">{connector.name}</h3><p className="mt-1 min-h-10 text-xs leading-relaxed text-muted-foreground">{connector.description}</p></div>
      <div><p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Capacités prévues</p><ul className="mt-2 flex flex-wrap gap-1.5">{connector.capabilities.map((capability) => <li key={capability} className="rounded-md bg-muted/60 px-2 py-1 text-[10px] text-muted-foreground">{capability}</li>)}</ul></div>
      <div className="mt-auto border-t border-border/60 pt-3">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Permissions envisagées</p>
        <ul className="mt-2 space-y-1.5">{connector.required_scopes.map((permission) => <li key={permission.id} className="flex items-start gap-2 text-[11px] leading-relaxed text-muted-foreground"><span className={`mt-0.5 rounded px-1 py-0.5 text-[9px] font-semibold uppercase ${permission.access === 'write' ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300' : 'bg-blue-500/10 text-blue-700 dark:text-blue-300'}`}>{permission.access === 'write' ? 'écriture' : 'lecture'}</span><span><span className="text-foreground">{permission.label}</span><br />{permission.description}</span></li>)}</ul>
      </div>
      {connector.available_tools.length > 0 && <p className="text-[10px] text-muted-foreground">{connector.available_tools.length} outil(s) réellement disponible(s)</p>}
      {actionError && <p role="alert" className="text-xs text-destructive">{actionError}</p>}
      {setupRequired && setupOpen && <div className="space-y-3 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs leading-relaxed">
        <p className="font-medium text-foreground">Google OAuth n’est pas encore configuré dans le backend.</p>
        <ol className="list-decimal space-y-1.5 pl-4 text-muted-foreground">
          <li>Dans Google Cloud, active Google Calendar API et crée un identifiant OAuth de type application Web.</li>
          <li>Ajoute cette URI de redirection autorisée : <code className="break-all rounded bg-background px-1 py-0.5 text-[10px]">http://127.0.0.1:8000/api/connectors/google_calendar/callback</code></li>
          <li>Dans <code className="rounded bg-background px-1 py-0.5">backend/.env</code>, définis <code>GOOGLE_OAUTH_CLIENT_ID</code>, <code>GOOGLE_OAUTH_CLIENT_SECRET</code>, <code>GOOGLE_OAUTH_REDIRECT_URI</code> et <code>CONNECTOR_TOKEN_ENCRYPTION_KEY</code>.</li>
        </ol>
        <p className="text-muted-foreground">Génère la clé de chiffrement dans le dossier <code>backend/</code> avec <code className="break-all">uv run python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"</code>, puis relance <code>npm run dev:all</code>. Garde le secret Google et la clé uniquement dans le fichier local.</p>
        <a className="inline-flex font-medium text-primary underline underline-offset-4" href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer">Ouvrir les identifiants Google Cloud</a>
      </div>}
      <Button variant="outline" size="sm" className="w-full" disabled={busy || comingSoon} onClick={() => {
        if (setupRequired) { setSetupOpen((open) => !open); return }
        setBusy(true); setActionError(null)
        const action = connector.id === 'google_calendar'
          ? connector.status === 'connected'
            ? chatAdapter.disconnectGoogleCalendar().then(() => window.location.reload())
            : chatAdapter.connectGoogleCalendar().then((url) => { window.location.assign(url) })
          : Promise.reject(new Error('Ce connecteur n’est pas disponible.'))
        void action.catch((reason: unknown) => setActionError(reason instanceof Error ? reason.message : 'Action impossible.')).finally(() => setBusy(false))
      }}>{busy ? 'Connexion…' : comingSoon ? 'Bientôt disponible' : setupRequired ? setupOpen ? 'Masquer les étapes' : 'Configurer Google Calendar' : connector.status === 'connected' ? 'Déconnecter' : 'Connecter'}</Button>
    </CardContent>
  </Card>
}
