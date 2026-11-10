import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Cable, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { orderCatalogEntries } from '@/features/connectors/mcp-catalog-order'
import { McpServerCard } from '@/features/connectors/mcp-server-card'
import { McpServerForm } from '@/features/connectors/mcp-server-form'
import { ChatServiceError, chatAdapter, type McpCatalogEntry, type McpServerRecord } from '@/services/chat-adapters'

export function McpCatalogPage() {
  const [params, setParams] = useSearchParams()
  const query = params.get('q') ?? ''
  const category = params.get('category') ?? ''
  const page = Number(params.get('page') ?? '1') || 1
  const activateId = params.get('activate')
  const [draftQuery, setDraftQuery] = useState(query)
  const [entries, setEntries] = useState<McpCatalogEntry[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(chatAdapter.mode === 'openai')
  const [error, setError] = useState<string | null>(null)
  const [servers, setServers] = useState<McpServerRecord[]>([])
  const [knownEntries, setKnownEntries] = useState<McpCatalogEntry[]>([])
  const requestedCatalogIds = useRef(new Set<string>())
  const [activation, setActivation] = useState<McpCatalogEntry | null>(null)
  const [deactivatingId, setDeactivatingId] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshNotice, setRefreshNotice] = useState<string | null>(null)

  useEffect(() => {
    if (chatAdapter.mode !== 'openai') return
    let cancelled = false
    void chatAdapter.searchMcpCatalog(query, category, page)
      .then((result) => { if (!cancelled) { setEntries(result.items); setCategories(result.categories); setTotal(result.total); setError(null) } })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Le catalogue ne peut pas être chargé.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [query, category, page])

  useEffect(() => {
    if (chatAdapter.mode !== 'openai') return
    let cancelled = false
    void chatAdapter.listMcpServers().then((items) => { if (!cancelled) setServers([...items].reverse()) }).catch(() => { if (!cancelled) setServers([]) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!activateId || chatAdapter.mode !== 'openai') return
    let cancelled = false
    void chatAdapter.getMcpCatalogEntry(activateId)
      .then((entry) => { if (!cancelled) setActivation(entry) })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Cette fiche est introuvable.') })
    return () => { cancelled = true }
  }, [activateId])

  function updateSearch(next: { q?: string; category?: string; page?: number; activate?: string | null }) {
    if (chatAdapter.mode === 'openai') setLoading(true)
    const values = new URLSearchParams(params)
    const q = next.q ?? query
    const nextCategory = next.category ?? category
    const nextPage = next.page ?? 1
    if (q) values.set('q', q)
    else values.delete('q')
    if (nextCategory) values.set('category', nextCategory)
    else values.delete('category')
    if (nextPage > 1) values.set('page', String(nextPage))
    else values.delete('page')
    if (next.activate) values.set('activate', next.activate)
    else if (next.activate === null) values.delete('activate')
    setParams(values)
  }

  async function refreshCatalog() {
    setRefreshing(true)
    setRefreshNotice(null)
    try {
      const result = await chatAdapter.refreshMcpCatalog()
      setRefreshNotice(result.message)
      if (result.added > 0) {
        const refreshed = await chatAdapter.searchMcpCatalog(query, category, page)
        setEntries(refreshed.items)
        setCategories(refreshed.categories)
        setTotal(refreshed.total)
      }
    } catch (reason) {
      setRefreshNotice(reason instanceof Error ? reason.message : 'La mise à jour n’a pas abouti.')
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => {
    const missing = [...new Set(servers.flatMap((server) => server.catalog_id ? [server.catalog_id] : []))]
      .filter((catalogId) => !entries.some((entry) => entry.id === catalogId) && !requestedCatalogIds.current.has(catalogId))
    if (missing.length === 0 || chatAdapter.mode !== 'openai') return
    for (const catalogId of missing) requestedCatalogIds.current.add(catalogId)
    void Promise.all(missing.map(async (catalogId) => {
      try { return await chatAdapter.getMcpCatalogEntry(catalogId) }
      catch { return null }
    })).then((found) => {
      const entriesFound = found.filter((entry): entry is McpCatalogEntry => entry !== null)
      if (entriesFound.length === 0) return
      setKnownEntries((current) => {
        const byId = new Map(current.map((entry) => [entry.id, entry]))
        for (const entry of entriesFound) byId.set(entry.id, entry)
        return [...byId.values()]
      })
    })
  }, [servers, entries])

  function updateServer(server: McpServerRecord) {
    setServers((current) => [server, ...current.filter((item) => item.id !== server.id)])
  }

  async function deactivate(server: McpServerRecord) {
    if (!window.confirm(`Désactiver « ${server.name} » ?`)) return
    setDeactivatingId(server.id)
    setError(null)
    try {
      await chatAdapter.deleteMcpServer(server.id)
      setServers((current) => current.filter((item) => item.id !== server.id))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Le serveur n’a pas pu être désactivé.')
    } finally {
      setDeactivatingId(null)
    }
  }

  const pageCount = Math.max(1, Math.ceil(total / 24))
  const serversByCatalog = new Map<string, McpServerRecord>()
  for (const server of servers) {
    if (server.catalog_id && !serversByCatalog.has(server.catalog_id)) serversByCatalog.set(server.catalog_id, server)
  }
  const visibleEntries = orderCatalogEntries(entries, servers, knownEntries)
  return <div className="mx-auto max-w-5xl space-y-6">
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-primary/15 bg-primary/5 text-primary"><Cable aria-hidden="true" className="size-5" /></span>
        <div>
          <p className="text-sm text-muted-foreground">Connecteurs</p>
          <h2 className="mt-0.5 font-heading text-2xl font-semibold tracking-tight">Catalogue MCP</h2>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">Seuls les serveurs distants gratuits et publiés sont listés, lorsqu’ils répondent avec au moins un outil. Une adresse injoignable, sans outil, ou qui exige une connexion OAuth non prise en charge, est écartée. Une fiche qui demande un jeton reste visible, et l’activation ne le demande que dans ce cas.</p>
        </div>
      </div>
      <Button variant="outline" size="sm" render={<Link to="/connectors" />}>Retour aux connecteurs</Button>
    </div>

    {chatAdapter.mode !== 'openai' ? <Card><CardContent className="py-8 text-sm text-muted-foreground">Le catalogue MCP nécessite le backend connecté.</CardContent></Card> : <>
      <form className="flex flex-col gap-3 sm:flex-row" onSubmit={(event) => { event.preventDefault(); updateSearch({ q: draftQuery.trim(), page: 1 }) }}>
        <div className="relative min-w-0 flex-1">
          <Search aria-hidden="true" className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" />
          <Input value={draftQuery} onChange={(event) => setDraftQuery(event.target.value)} placeholder="Rechercher un serveur, une catégorie ou une capacité" aria-label="Rechercher dans le catalogue MCP" className="pl-9" />
        </div>
        <select value={category} onChange={(event) => updateSearch({ category: event.target.value, page: 1 })} aria-label="Filtrer par catégorie" className="h-9 rounded-md border border-input bg-background px-3 text-sm">
          <option value="">Toutes les catégories</option>
          {categories.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <Button type="submit" size="sm">Rechercher</Button>
        <Button type="button" size="sm" variant="outline" disabled={refreshing} onClick={() => void refreshCatalog()}>{refreshing ? 'Mise à jour…' : 'Mettre à jour'}</Button>
      </form>
      {refreshNotice && <p role="status" className="text-sm text-muted-foreground">{refreshNotice}</p>}
      {loading && <p role="status" className="text-sm text-muted-foreground">Chargement du catalogue…</p>}
      {error && <p role="alert" className="rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
      {!loading && visibleEntries.length === 0 && <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">Aucune fiche ne correspond à cette recherche.</CardContent></Card>}
      <div className="grid gap-3 md:grid-cols-2">
        {visibleEntries.map((entry) => {
          const server = serversByCatalog.get(entry.id)
          return <Card key={entry.id}><CardContent className="flex h-full flex-col gap-3 p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold">{entry.name}</h3>
                  {server && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300"><span className="size-1.5 rounded-full bg-emerald-500" aria-hidden="true" />Activé</span>}
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">{entry.category}</p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                {entry.badges.length > 0 && <span className="rounded-full bg-muted px-2 py-1 text-[10px] text-muted-foreground">{entry.badges.join(' · ')}</span>}
                {entry.requires_token && <span className="rounded-full bg-muted px-2 py-1 text-[10px] text-muted-foreground">Jeton requis</span>}
              </div>
            </div>
            <p className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">{entry.description || 'Aucune description publiée.'}</p>
            <div className="mt-auto flex items-center justify-between gap-2">
              <a className="text-[11px] text-primary underline underline-offset-4" href={entry.source_url} target="_blank" rel="noreferrer">Fiche du répertoire</a>
              {server
                ? <Button type="button" size="sm" variant="outline" disabled={deactivatingId === server.id} onClick={() => void deactivate(server)}>{deactivatingId === server.id ? 'Désactivation…' : 'Désactiver'}</Button>
                : <Button type="button" size="sm" variant="outline" onClick={() => { setActivation(entry); updateSearch({ q: query, category, page, activate: entry.id }) }}>Activer</Button>}
            </div>
          </CardContent></Card>
        })}
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{total} fiche{total > 1 ? 's' : ''}</span>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="outline" disabled={page <= 1} onClick={() => updateSearch({ page: page - 1 })}>Précédent</Button>
          <span className="self-center tabular-nums">{page} / {pageCount}</span>
          <Button type="button" size="sm" variant="outline" disabled={page >= pageCount} onClick={() => updateSearch({ page: page + 1 })}>Suivant</Button>
        </div>
      </div>

      <section className="space-y-3 border-t border-border/70 pt-6">
        <div><h3 className="font-heading text-lg font-semibold">Serveurs de ce compte</h3><p className="mt-1 text-xs text-muted-foreground">Un serveur reste inutilisable tant qu’il n’est pas testé, approuvé pour la lecture, activé, puis sélectionné dans une conversation.</p></div>
        <McpServerForm onCreated={updateServer} onUpdated={updateServer} />
        {servers.length > 0 ? <div className="grid gap-3 lg:grid-cols-2">{servers.map((server) => <McpServerCard key={server.id} server={server} onChange={updateServer} onDelete={(serverId) => setServers((current) => current.filter((item) => item.id !== serverId))} />)}</div> : <Card><CardContent className="py-8 text-center text-xs text-muted-foreground">Aucun serveur MCP ajouté pour ce compte.</CardContent></Card>}
      </section>
    </>}
    <ActivationDialog entry={activation} onOpenChange={(open) => { if (!open) { setActivation(null); updateSearch({ q: query, category, page, activate: null }) } }} onCreated={updateServer} />
  </div>
}

function ActivationDialog({ entry, onOpenChange, onCreated }: { entry: McpCatalogEntry | null; onOpenChange: (open: boolean) => void; onCreated: (server: McpServerRecord) => void }) {
  return <Dialog open={entry !== null} onOpenChange={onOpenChange}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Activer {entry?.name}</DialogTitle>
        <DialogDescription>L’adresse publiée par l’éditeur est exactement celle que le backend appellera après validation.</DialogDescription>
      </DialogHeader>
      {entry && <ActivationForm key={entry.id} entry={entry} onOpenChange={onOpenChange} onCreated={onCreated} />}
    </DialogContent>
  </Dialog>
}

function ActivationForm({ entry, onOpenChange, onCreated }: { entry: McpCatalogEntry; onOpenChange: (open: boolean) => void; onCreated: (server: McpServerRecord) => void }) {
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [connectUrl, setConnectUrl] = useState<string | null>(null)
  const [askToken, setAskToken] = useState(entry.requires_token)
  const [createdId, setCreatedId] = useState<string | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    if (askToken && !token.trim()) {
      setError('Ce serveur MCP demande un jeton utilisateur.')
      return
    }
    setBusy(true)
    try {
      let serverId = createdId
      let latest: McpServerRecord
      if (!serverId) {
        latest = await chatAdapter.createMcpServer({
          name: entry.name.slice(0, 80),
          url: entry.endpoint,
          catalog_id: entry.id,
          ...(entry.requires_token ? { auth_token: token } : {}),
        })
        serverId = latest.id
        setCreatedId(serverId)
      } else {
        const servers = await chatAdapter.listMcpServers()
        const existing = servers.find((item) => item.id === serverId)
        if (!existing) throw new Error('Le serveur n’a pas pu être ajouté.')
        latest = existing
      }
      if (!entry.requires_token && askToken && token.trim()) {
        latest = await chatAdapter.replaceMcpCredential(serverId, token.trim())
      }
      let discoveryFailed = false
      try { latest = await chatAdapter.refreshMcpServer(serverId) }
      catch (reason) {
        discoveryFailed = true
        const servers = await chatAdapter.listMcpServers()
        latest = servers.find((item) => item.id === serverId) ?? latest
        if (reason instanceof ChatServiceError && reason.connectUrl) {
          setConnectUrl(reason.connectUrl)
          setAskToken(false)
          setError(reason.message)
        } else if (reason instanceof ChatServiceError && reason.needsToken) {
          setConnectUrl(null)
          setAskToken(true)
          setError(reason.message)
        } else {
          setConnectUrl(null)
          setError(reason instanceof Error ? reason.message : 'Le serveur a été ajouté, mais la découverte a échoué.')
        }
      }
      if (!discoveryFailed) {
        const readNames = latest.tools.filter((tool) => tool.access === 'read' && !tool.requires_human_approval).map((tool) => tool.name)
        if (readNames.length > 0) {
          try {
            latest = await chatAdapter.setMcpServerTools(latest.id, readNames)
            latest = await chatAdapter.setMcpServerEnabled(latest.id, true)
          } catch { /* The fiche stays listed as activated when no read tool can be enabled. */ }
        }
      }
      onCreated(latest)
      if (!discoveryFailed) onOpenChange(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Le serveur n’a pas pu être ajouté.')
    } finally { setBusy(false) }
  }

  return <form className="space-y-3" onSubmit={(event) => void submit(event)}>
        <div className="space-y-1.5">
          <p className="text-xs font-medium">URL publiée</p>
          <p className="break-all rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-xs">{entry.endpoint}</p>
        </div>
        {askToken && <div className="space-y-1.5">
          <Label htmlFor="catalog-mcp-token">Jeton utilisateur</Label>
          <Input id="catalog-mcp-token" value={token} onChange={(event) => setToken(event.target.value)} required type="password" autoComplete="new-password" />
          <p className="text-[11px] text-muted-foreground">Le jeton est chiffré côté serveur et n’est jamais réaffiché.</p>
        </div>}
        {connectUrl && <a href={connectUrl} target="_blank" rel="noreferrer" className="text-xs text-primary underline underline-offset-4">Ouvrir la page de connexion</a>}
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        <div className="flex justify-end"><Button type="submit" size="sm" disabled={busy}>{busy ? 'Vérification…' : 'Ajouter et tester'}</Button></div>
      </form>
}
