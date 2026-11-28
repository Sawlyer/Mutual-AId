import { useEffect, useMemo, useState } from 'react'
import { Cable, LoaderCircle, ShieldCheck, Sparkles } from 'lucide-react'
import { Link } from 'react-router'
import { Badge } from '@/components/reui/badge'
import { Button } from '@/components/ui/button'
import { agentService } from '@/services/agent-service'
import { chatAdapter, type McpServerRecord } from '@/services/chat-adapters'
import { rankMcpTools } from './resource-recommendations'
import type { AgentProfile } from '@/types/agent'

interface Grant { server_id: string; tool_name: string }

export function AgentMcpGrants({ profile, onSaved }: { profile: AgentProfile; onSaved?: () => void }) {
  const { id: profileId, name: profileName } = profile
  const [servers, setServers] = useState<McpServerRecord[]>([])
  const [selected, setSelected] = useState<Grant[]>([])
  const [loading, setLoading] = useState(chatAdapter.mode === 'openai')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    if (chatAdapter.mode !== 'openai') return
    let cancelled = false
    void Promise.all([chatAdapter.listMcpServers(), agentService.listMcpTools(profileId)])
      .then(([items, grants]) => {
        if (cancelled) return
        setServers(items)
        setSelected(grants.tools)
        setError(null)
      })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Les outils MCP n’ont pas pu être chargés.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [profileId])

  const readyServers = useMemo(() => servers.filter((server) => server.status === 'ready'), [servers])
  const activeServers = useMemo(() => readyServers.filter((server) => server.enabled), [readyServers])
  const available = useMemo(() => activeServers
    .map((server) => ({
      server,
      tools: server.tools.filter((tool) => tool.access === 'read' && !tool.requires_human_approval && server.approved_tool_names.includes(tool.name)),
    }))
    .filter(({ tools }) => tools.length > 0), [activeServers])
  const recommendations = useMemo(() => rankMcpTools(profile, servers), [profile, servers])
  const recommendedKeys = useMemo(() => new Set(recommendations.map(({ server, tool }) => `${server.id}:${tool.name}`)), [recommendations])

  function toggle(grant: Grant, checked: boolean) {
    setSelected((current) => checked
      ? current.some((item) => item.server_id === grant.server_id && item.tool_name === grant.tool_name) ? current : [...current, grant]
      : current.filter((item) => item.server_id !== grant.server_id || item.tool_name !== grant.tool_name))
  }

  async function save() {
    setBusy(true)
    setError(null)
    setNotice('')
    try {
      const saved = await agentService.setMcpTools(profileId, selected)
      setSelected(saved.tools)
      setNotice('Les outils autorisés pour cet agent sont enregistrés.')
      onSaved?.()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Les outils n’ont pas pu être enregistrés.')
    } finally { setBusy(false) }
  }

  return <section aria-labelledby="agent-mcp-title" className="space-y-4">
    <div className="flex items-start gap-3"><span className="mt-0.5 text-primary"><Cable aria-hidden="true" className="size-4" /></span><div><h3 id="agent-mcp-title" className="text-sm font-semibold">Outils MCP</h3><p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">Pour utiliser un outil : approuvez-le dans Connecteurs, affectez-le à {profileName}, puis sélectionnez son serveur dans le chat.</p></div></div>
    {chatAdapter.mode !== 'openai' ? <p className="rounded-lg border border-dashed px-4 py-5 text-sm text-muted-foreground">La gestion MCP nécessite le backend connecté.</p> : <>
      {loading && <p role="status" className="flex items-center gap-2 py-3 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Chargement des outils approuvés…</p>}
      {!loading && error && <div role="alert" className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">{error}<Button size="sm" variant="outline" className="ml-3" onClick={() => { setLoading(true); setError(null); void Promise.all([chatAdapter.listMcpServers(), agentService.listMcpTools(profileId)]).then(([items, grants]) => { setServers(items); setSelected(grants.tools) }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Les outils MCP n’ont pas pu être chargés.')).finally(() => setLoading(false)) }}>Réessayer</Button></div>}
      {!loading && !error && available.length === 0 && <div className="rounded-lg border border-dashed px-4 py-5 text-sm text-muted-foreground"><p>{readyServers.length === 0 ? 'Aucun serveur MCP prêt. Ajoutez et testez un serveur pour continuer.' : activeServers.length === 0 ? 'Les serveurs prêts sont désactivés dans l’espace de travail.' : 'Aucun outil de lecture n’est encore approuvé sur un serveur actif.'}</p><Link className="mt-2 inline-flex items-center gap-1 font-medium text-primary hover:underline" to={`/connectors/mcp?for_agent=${encodeURIComponent(profileId)}`}>{readyServers.length === 0 ? 'Ajouter un serveur MCP' : 'Gérer les serveurs et les outils'} <span aria-hidden="true">→</span></Link></div>}
      {!loading && !error && available.length > 0 && <div className="space-y-4" aria-label={`Outils MCP disponibles pour ${profileName}`}>{available.map(({ server, tools }) => <section key={server.id} className="space-y-2" aria-label={`Outils de ${server.name}`}>
        <div className="flex flex-wrap items-center gap-2 border-b border-border/60 pb-2"><h4 className="text-xs font-semibold">{server.name}</h4><Badge variant="success-light" size="xs">Serveur actif</Badge><span className="text-[11px] text-muted-foreground">Outils approuvés dans Connecteurs</span></div>
        {recommendations.some((item) => item.server.id === server.id) && <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><Sparkles aria-hidden="true" className="size-3.5 text-primary" />Suggestions locales selon le rôle et les compétences de {profileName}.</p>}
        <ul className="space-y-2">{[...tools].sort((left, right) => Number(recommendedKeys.has(`${server.id}:${right.name}`)) - Number(recommendedKeys.has(`${server.id}:${left.name}`))).map((tool) => {
          const checked = selected.some((item) => item.server_id === server.id && item.tool_name === tool.name)
          const recommended = recommendedKeys.has(`${server.id}:${tool.name}`)
          return <li key={`${server.id}:${tool.name}`}><label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/70 bg-card p-3"><input type="checkbox" className="mt-1 accent-primary" checked={checked} disabled={busy} onChange={(event) => toggle({ server_id: server.id, tool_name: tool.name }, event.target.checked)} /><span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2 text-sm font-medium">{tool.name}<Badge variant="success-light" size="xs"><ShieldCheck />Lecture</Badge>{recommended && <Badge variant="primary-light" size="xs"><Sparkles aria-hidden="true" />Pertinent pour cet agent</Badge>}</span>{tool.description && <span className="mt-1 block text-xs text-muted-foreground">{tool.description}</span>}</span></label></li>
        })}</ul>
      </section>)}</div>}
      {error && !loading && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {notice && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">{notice}</p>}
      {!loading && available.length > 0 && <div className="flex justify-end"><Button type="button" size="sm" disabled={busy || error !== null} onClick={() => void save()}>{busy ? <><LoaderCircle className="size-4 animate-spin" />Enregistrement…</> : 'Enregistrer pour cet agent'}</Button></div>}
    </>}
  </section>
}
