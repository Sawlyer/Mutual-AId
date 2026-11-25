import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  ArrowUpRight,
  Cable,
  CalendarDays,
  Check,
  CircleAlert,
  GitBranch,
  HardDrive,
  LoaderCircle,
  Mail,
  PlugZap,
  RefreshCw,
  Search,
  ShieldCheck,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react'
import { Badge } from '@/components/reui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { chatAdapter, type ConnectorCatalogItem, type ConnectorStatus } from '@/services/chat-adapters'

const icons = { mail: Mail, drive: HardDrive, calendar: CalendarDays, github: GitBranch, mcp: Cable } as const
const statusLabels: Record<ConnectorStatus, string> = {
  connected: 'Connecté',
  disconnected: 'À connecter',
  error: 'Erreur',
}
type ConnectorFilter = 'all' | 'connected' | 'disconnected'

export function ConnectorsPage() {
  const [connectors, setConnectors] = useState<ConnectorCatalogItem[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<ConnectorFilter>('all')
  const [query, setQuery] = useState('')
  const oauthParams = new URLSearchParams(window.location.search)
  const connectedId = oauthParams.get('connected')
  const notice = connectedId
    ? `${({ gmail: 'Gmail', google_drive: 'Google Drive', google_calendar: 'Google Calendar', github: 'GitHub' } as Record<string, string>)[connectedId] ?? 'Le service'} est connecté en lecture seule.`
    : null
  const oauthError = oauthParams.get('oauth_error')
  const oauthErrorMessage = oauthError
    ? oauthError === 'denied'
      ? 'La connexion a été annulée.'
      : 'La connexion n’a pas abouti. Vérifiez la configuration OAuth puis réessayez.'
    : null

  const loadConnectors = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    else setLoading(true)
    try {
      const items = await chatAdapter.listConnectors()
      setConnectors(items.filter((item) => !item.id.startsWith('mcp:')))
      setError(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Le catalogue ne peut pas être chargé.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    void chatAdapter.listConnectors()
      .then((items) => {
        if (!cancelled) {
          setConnectors(items.filter((item) => !item.id.startsWith('mcp:')))
          setError(null)
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'Le catalogue ne peut pas être chargé.')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const connectedCount = connectors.filter((connector) => connector.status === 'connected').length
  const attentionCount = connectors.filter((connector) => connector.status === 'error').length
  const filteredConnectors = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('fr')
    return connectors.filter((connector) => {
      const matchesStatus = filter === 'all' || (filter === 'connected' ? connector.status === 'connected' : connector.status !== 'connected')
      const searchable = [connector.name, connector.description, ...connector.capabilities].join(' ').toLocaleLowerCase('fr')
      return matchesStatus && (!normalizedQuery || searchable.includes(normalizedQuery))
    })
  }, [connectors, filter, query])

  return (
    <div className="mx-auto max-w-6xl space-y-8 pb-8">
      <header className="relative isolate overflow-hidden rounded-2xl border border-border/70 bg-card px-5 py-6 shadow-sm sm:px-7 sm:py-8">
        <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 -z-10 w-2/3 bg-[radial-gradient(ellipse_at_top_right,color-mix(in_oklab,var(--primary)_12%,transparent),transparent_65%)]" />
        <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
          <div className="max-w-2xl">
            <Badge variant="primary-light" size="sm" radius="full" className="mb-3 gap-1.5">
              <PlugZap aria-hidden="true" className="size-3" /> Outils de l’assistant
            </Badge>
            <h1 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">Connecteurs</h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground sm:text-base">
              Reliez vos services pour donner à vos agents le contexte dont ils ont besoin. Vous gardez le contrôle des accès à chaque étape.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:min-w-64">
            <Summary value={connectedCount} label="Connectés" tone="success" />
            <Summary value={connectors.length - connectedCount} label="Disponibles" tone="neutral" />
          </div>
        </div>
      </header>

      {(error || oauthErrorMessage) && (
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-destructive/25 bg-destructive/5 p-4 text-sm text-destructive">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <p>{error || oauthErrorMessage}</p>
        </div>
      )}
      {notice && (
        <div role="status" className="flex items-start gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-sm text-emerald-800 dark:text-emerald-300">
          <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <p>{notice}</p>
        </div>
      )}

      <section aria-labelledby="connector-catalog-title" className="space-y-4 pt-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="connector-catalog-title" className="font-heading text-lg font-semibold">Votre espace de travail</h2>
            <p className="mt-1 text-sm text-muted-foreground">Gérez les services accessibles à vos conversations.</p>
          </div>
          <Button variant="outline" size="sm" className="self-start sm:self-auto" onClick={() => void loadConnectors(true)} disabled={loading || refreshing}>
            <RefreshCw aria-hidden="true" className={refreshing ? 'animate-spin' : ''} />
            Actualiser
          </Button>
        </div>

        <div className="flex flex-col gap-3 rounded-xl border border-border/70 bg-muted/20 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-1.5" aria-label="Filtrer les connecteurs">
            <FilterButton active={filter === 'all'} onClick={() => setFilter('all')}>
              Tous <span className="tabular-nums text-muted-foreground">{connectors.length}</span>
            </FilterButton>
            <FilterButton active={filter === 'connected'} onClick={() => setFilter('connected')}>
              Connectés <span className="tabular-nums text-muted-foreground">{connectedCount}</span>
            </FilterButton>
            <FilterButton active={filter === 'disconnected'} onClick={() => setFilter('disconnected')}>
              À connecter <span className="tabular-nums text-muted-foreground">{connectors.length - connectedCount}</span>
            </FilterButton>
            {attentionCount > 0 && <Badge variant="destructive-light" size="sm" radius="full" className="self-center">{attentionCount} à vérifier</Badge>}
          </div>
          <label className="relative block w-full sm:max-w-64">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher un service…" className="pl-9" />
            <span className="sr-only">Rechercher un connecteur</span>
          </label>
        </div>

        {loading ? (
          <div role="status" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <span className="sr-only">Chargement des connecteurs…</span>
            {Array.from({ length: 3 }, (_, index) => <Card key={index} className="h-64 animate-pulse"><CardContent className="space-y-4 p-5"><div className="size-10 rounded-xl bg-muted" /><div className="h-4 w-1/3 rounded bg-muted" /><div className="h-3 w-full rounded bg-muted" /><div className="h-8 w-full rounded bg-muted" /></CardContent></Card>)}
          </div>
        ) : filteredConnectors.length ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {filteredConnectors.map((connector) => {
              const Icon = icons[connector.icon as keyof typeof icons] ?? Cable
              return <ConnectorCard key={connector.id} connector={connector} Icon={Icon} />
            })}
          </div>
        ) : (
          <Card>
            <CardContent className="flex flex-col items-center px-5 py-12 text-center">
              <span className="grid size-12 place-items-center rounded-2xl bg-muted text-muted-foreground"><Search aria-hidden="true" className="size-5" /></span>
              <h3 className="mt-4 font-medium">Aucun service trouvé</h3>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">Modifiez votre recherche ou choisissez un autre filtre pour retrouver un connecteur.</p>
              {(query || filter !== 'all') && <Button variant="ghost" size="sm" className="mt-3" onClick={() => { setQuery(''); setFilter('all') }}>Effacer les filtres</Button>}
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  )
}

function Summary({ value, label, tone }: { value: number; label: string; tone: 'success' | 'neutral' }) {
  return (
    <div className="rounded-xl border border-border/70 bg-background/80 px-3 py-2.5">
      <p className={`font-heading text-xl font-semibold tabular-nums ${tone === 'success' ? 'text-emerald-700 dark:text-emerald-300' : 'text-foreground'}`}>{value}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  )
}

function FilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? 'bg-background text-foreground shadow-sm ring-1 ring-border' : 'text-muted-foreground hover:bg-background/70 hover:text-foreground'}`}
    >
      {children}
    </button>
  )
}

function ConnectorCard({ connector, Icon }: { connector: ConnectorCatalogItem; Icon: LucideIcon }) {
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [setupOpen, setSetupOpen] = useState(false)
  const setupRequired = connector.availability === 'setup_required'
  const backendRequired = chatAdapter.mode === 'demo'
  const googleConnector = ['gmail', 'google_drive', 'google_calendar'].includes(connector.id)
  const setup = googleConnector
    ? { title: 'Google OAuth n’est pas encore configuré dans le backend.', api: connector.id === 'gmail' ? 'Gmail API' : connector.id === 'google_drive' ? 'Google Drive API' : 'Google Calendar API', callback: 'http://127.0.0.1:8000/api/connectors/google_calendar/callback', variables: 'GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REDIRECT_URI' }
    : { title: 'L’application OAuth GitHub n’est pas configurée dans le backend.', api: null, callback: 'http://127.0.0.1:8000/api/connectors/github/callback', variables: 'GITHUB_APP_CLIENT_ID, GITHUB_APP_CLIENT_SECRET, GITHUB_APP_REDIRECT_URI' }

  const handleAction = () => {
    if (setupRequired) {
      setSetupOpen((open) => !open)
      return
    }
    setBusy(true)
    setActionError(null)
    const action = connector.status === 'connected'
      ? chatAdapter.disconnectConnector(connector.id).then(() => window.location.reload())
      : chatAdapter.connectConnector(connector.id).then((url) => { window.location.assign(url) })
    void action
      .catch((reason: unknown) => setActionError(reason instanceof Error ? reason.message : 'Action impossible.'))
      .finally(() => setBusy(false))
  }

  return (
    <Card className="group h-full border-border/70 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-md hover:shadow-primary/5">
      <CardContent className="flex h-full flex-col p-5">
        <div className="flex items-start justify-between gap-3">
          <span className="grid size-11 place-items-center rounded-xl border border-border/70 bg-muted/40 text-foreground transition-colors group-hover:border-primary/20 group-hover:bg-primary/5 group-hover:text-primary">
            <Icon aria-hidden="true" className="size-5" />
          </span>
          <StatusBadge status={connector.status} />
        </div>

        <div className="mt-4 min-h-[4.5rem]">
          <h3 className="font-heading text-base font-semibold tracking-tight">{connector.name}</h3>
          <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-muted-foreground">{connector.description}</p>
        </div>

        <div className="mt-4 flex min-h-8 flex-wrap content-start gap-1.5" aria-label="Capacités du connecteur">
          {connector.capabilities.slice(0, 3).map((capability) => (
            <Badge key={capability} variant="outline" size="sm" radius="full" className="max-w-full truncate text-muted-foreground">{capability}</Badge>
          ))}
          {connector.capabilities.length > 3 && <Badge variant="secondary" size="sm" radius="full">+{connector.capabilities.length - 3}</Badge>}
        </div>

        <div className="mt-4 rounded-lg bg-muted/35 px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground"><ShieldCheck aria-hidden="true" className="size-3.5" /> Accès demandés</span>
            <span className="text-[10px] text-muted-foreground">{connector.required_scopes.length} permission{connector.required_scopes.length === 1 ? '' : 's'}</span>
          </div>
          {connector.required_scopes.length ? (
            <ul className="mt-2 space-y-1.5">
              {connector.required_scopes.slice(0, 2).map((permission) => (
                <li key={permission.id} className="flex min-w-0 items-center gap-2 text-xs">
                  <Badge variant={permission.access === 'write' ? 'warning-light' : 'info-light'} size="xs" radius="full">{permission.access === 'write' ? 'Écriture' : 'Lecture'}</Badge>
                  <span className="truncate text-muted-foreground" title={permission.label}>{permission.label}</span>
                </li>
              ))}
              {connector.required_scopes.length > 2 && <li className="pl-1 text-[11px] text-muted-foreground">et {connector.required_scopes.length - 2} autre{connector.required_scopes.length > 3 ? 's' : ''}</li>}
            </ul>
          ) : <p className="mt-2 text-xs text-muted-foreground">Aucune permission déclarée.</p>}
        </div>

        {connector.available_tools.length > 0 && <p className="mt-3 text-[11px] text-muted-foreground">{connector.available_tools.length} outil{connector.available_tools.length === 1 ? '' : 's'} disponible{connector.available_tools.length === 1 ? '' : 's'}</p>}
        {backendRequired && <p className="mt-3 rounded-lg border border-warning/20 bg-warning/5 p-2.5 text-xs text-warning-foreground">Passez en mode backend pour connecter un service. Le mode démo ne réalise aucune connexion OAuth.</p>}

        {!backendRequired && setupRequired && setupOpen && (
          <div className="mt-4 space-y-3 rounded-lg border border-warning/20 bg-warning/5 p-3 text-xs leading-relaxed">
            <p className="font-medium text-foreground">{setup.title}</p>
            <ol className="list-decimal space-y-1.5 pl-4 text-muted-foreground">
              {googleConnector ? <li>Dans Google Cloud, active {setup.api} et crée un identifiant OAuth de type application Web.</li> : <li>Dans les paramètres développeur GitHub, crée une OAuth App et configure l’URL d’accueil locale.</li>}
              <li>Ajoute cette URI de redirection autorisée : <code className="break-all rounded bg-background px-1 py-0.5 text-[10px]">{setup.callback}</code></li>
              <li>Dans <code className="rounded bg-background px-1 py-0.5">backend/.env</code>, définis <code>{setup.variables}</code> et <code>CONNECTOR_TOKEN_ENCRYPTION_KEY</code>.</li>
            </ol>
            <p className="text-muted-foreground">Génère la clé de chiffrement avec <code className="break-all">uv run python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"</code>. Garde les secrets OAuth et la clé uniquement dans le fichier local.</p>
            {googleConnector
              ? <a className="inline-flex items-center gap-1 font-medium text-primary underline underline-offset-4" href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer">Ouvrir Google Cloud <ArrowUpRight aria-hidden="true" className="size-3" /></a>
              : <a className="inline-flex items-center gap-1 font-medium text-primary underline underline-offset-4" href="https://github.com/settings/developers" target="_blank" rel="noreferrer">Ouvrir GitHub <ArrowUpRight aria-hidden="true" className="size-3" /></a>}
          </div>
        )}

        {actionError && <p role="alert" className="mt-3 text-xs text-destructive">{actionError}</p>}
        <Button variant={connector.status === 'connected' ? 'outline' : 'default'} size="sm" className="mt-auto w-full" disabled={busy || backendRequired} onClick={handleAction}>
          {busy ? <><LoaderCircle aria-hidden="true" className="animate-spin" /> Connexion…</> : backendRequired ? 'Backend requis' : setupRequired ? setupOpen ? 'Masquer la configuration' : 'Configurer' : connector.status === 'connected' ? 'Déconnecter' : 'Connecter'}
        </Button>
      </CardContent>
    </Card>
  )
}

function StatusBadge({ status }: { status: ConnectorStatus }) {
  const variant = status === 'connected' ? 'success-light' : status === 'error' ? 'destructive-light' : 'outline'
  const Icon = status === 'connected' ? Check : status === 'error' ? TriangleAlert : undefined
  return <Badge variant={variant} size="sm" radius="full" className="gap-1.5">
    {Icon && <Icon aria-hidden="true" className="size-3" />}
    {statusLabels[status]}
  </Badge>
}
