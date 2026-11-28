import { useCallback, useEffect, useState } from 'react'
import { ArrowRight, Bot, CheckCircle2, CircleAlert, LoaderCircle, Plus, Radio } from 'lucide-react'
import { useNavigate } from 'react-router'
import { Badge } from '@/components/reui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { IconTile } from '@/components/reui/icon-tile'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/reui/alert'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AgentProfileCard } from '@/features/agents/agent-profile-card'
import { AgentProfileForm } from '@/features/agents/agent-profile-form'
import { agentService } from '@/services/agent-service'
import { chatAdapter } from '@/services/chat-adapters'
import type { AgentCatalog, AgentMergeSuggestion, AgentProfile, AgentProfileInput } from '@/types/agent'

type AgentConnection = 'checking' | 'ready' | 'missing' | 'offline' | 'demo'

export function AgentsPage() {
  const navigate = useNavigate()
  const [connection, setConnection] = useState<AgentConnection>(chatAdapter.mode === 'demo' ? 'demo' : 'checking')
  const [catalog, setCatalog] = useState<AgentCatalog | null>(null)
  const [mergeSuggestions, setMergeSuggestions] = useState<AgentMergeSuggestion[]>([])
  const [activeMerge, setActiveMerge] = useState<AgentMergeSuggestion | null>(null)
  const [sourceMcpTools, setSourceMcpTools] = useState<{ server_id: string; tool_name: string }[]>([])
  const [includeMcpTools, setIncludeMcpTools] = useState(false)
  const [mergeNotice, setMergeNotice] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [nextCatalog, nextSuggestions] = await Promise.all([agentService.list(), agentService.mergeSuggestions()])
      setCatalog(nextCatalog)
      setMergeSuggestions(nextSuggestions)
      setError('')
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Impossible de charger les profils.') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    let active = true
    void Promise.all([agentService.list(), agentService.mergeSuggestions()]).then(([result, suggestions]) => {
      if (active) { setCatalog(result); setMergeSuggestions(suggestions); setError('') }
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : 'Impossible de charger les profils.')
    }).finally(() => { if (active) setLoading(false) })
    if (chatAdapter.mode === 'demo') return () => { active = false }
    void chatAdapter.checkHealth().then((result) => {
      if (active) setConnection(result.openai_configured ? 'ready' : 'missing')
    }).catch(() => { if (active) setConnection('offline') })
    return () => { active = false }
  }, [])

  useEffect(() => {
    let active = true
    if (!activeMerge) return () => { active = false }
    void agentService.listMcpTools(activeMerge.source_profile_id).then((result) => {
      if (active) setSourceMcpTools(result.tools)
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : 'Impossible de vérifier les outils MCP de cet agent.')
    })
    return () => { active = false }
  }, [activeMerge])

  const status = ({
    checking: { label: 'Vérification…', icon: LoaderCircle, variant: 'secondary' },
    ready: { label: 'Disponible', icon: CheckCircle2, variant: 'success-light' },
    missing: { label: 'Configuration requise', icon: CircleAlert, variant: 'warning-light' },
    offline: { label: 'Backend inaccessible', icon: CircleAlert, variant: 'destructive-light' },
    demo: { label: 'Mode démo', icon: Radio, variant: 'warning-light' },
  } as const)[connection]
  const StatusIcon = status.icon

  async function create(input: AgentProfileInput) {
    setSaving(true)
    try {
      const profile = await agentService.create(input)
      setCreating(false)
      navigate(`/agents/${encodeURIComponent(profile.id)}`)
    } finally { setSaving(false) }
  }

  async function toggle(profile: AgentProfile) {
    setSaving(true)
    try { await agentService.update(profile.id, { enabled: !profile.enabled }); await refresh() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Impossible de modifier cet agent.') }
    finally { setSaving(false) }
  }

  async function remove(profile: AgentProfile) {
    if (!window.confirm(`Supprimer l’agent « ${profile.name} » ?`)) return
    setSaving(true)
    try { await agentService.remove(profile.id); await refresh() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Impossible de supprimer cet agent.') }
    finally { setSaving(false) }
  }

  async function mergeAgents() {
    if (!activeMerge) return
    setSaving(true)
    setError('')
    try {
      await agentService.merge(activeMerge.target_profile_id, activeMerge.source_profile_id, includeMcpTools)
      setMergeNotice(`« ${activeMerge.source_name} » a été fusionné dans « ${activeMerge.target_name} ». Son profil reste conservé pour l’historique.`)
      setActiveMerge(null)
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Impossible de fusionner ces agents.')
    } finally { setSaving(false) }
  }

  return <div className="mx-auto max-w-5xl space-y-6 pb-10">
    <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-sm text-muted-foreground">Votre équipe d’agents</p><h1 className="mt-1 font-heading text-2xl font-semibold tracking-tight">Agents</h1><p className="mt-1 max-w-2xl text-sm text-muted-foreground">Créez des spécialistes que l’orchestrateur pourra réutiliser selon leur rôle et leurs skills. Chaque agent se configure depuis sa fiche.</p></div><Button onClick={() => setCreating((current) => !current)} disabled={saving}><Plus />{creating ? 'Fermer' : 'Créer un agent'}</Button></header>

    <Card><CardContent className="flex items-center gap-4 p-4"><IconTile variant="soft" className="shrink-0 text-primary" aria-hidden="true"><Bot /></IconTile><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="font-medium">Assistant conversationnel</h2><Badge variant={status.variant}><StatusIcon aria-hidden="true" className={`mr-1.5 size-3.5 ${connection === 'checking' ? 'animate-spin' : ''}`} />{status.label}</Badge></div><p className="mt-1 text-sm text-muted-foreground">Analyse les demandes, choisit les spécialistes utiles et garde l’historique de vos conversations.</p>{connection === 'missing' && <p className="mt-2 text-xs text-muted-foreground">Renseignez <code>OPENAI_API_KEY</code> et <code>OPENAI_MODEL</code> dans <code>backend/.env</code>.</p>}{connection === 'offline' && <p role="alert" className="mt-2 text-xs text-destructive">Le backend ne répond pas. Lancez <code>npm run dev:all</code>.</p>}{connection === 'demo' && <p className="mt-2 text-xs text-muted-foreground">Les réponses du chat sont simulées dans ce mode.</p>}</div></CardContent></Card>

    {mergeNotice && <Alert role="status" variant="success"><CheckCircle2 aria-hidden="true" /><AlertTitle>Fusion effectuée</AlertTitle><AlertDescription>{mergeNotice}</AlertDescription></Alert>}
    {mergeSuggestions.length > 0 && <section aria-label="Suggestions de fusion" className="space-y-2">{mergeSuggestions.map((suggestion) => <Alert role="status" key={`${suggestion.source_profile_id}-${suggestion.target_profile_id}`} variant="info">
      <CircleAlert aria-hidden="true" />
      <AlertTitle>Deux agents semblent couvrir des besoins proches</AlertTitle>
      <AlertDescription>{suggestion.target_name} et {suggestion.source_name} — {suggestion.reasons.join(' ')}</AlertDescription>
      <AlertAction><Button type="button" size="xs" variant="outline" onClick={() => { setIncludeMcpTools(false); setSourceMcpTools([]); setActiveMerge(suggestion) }}>Examiner<ArrowRight /></Button></AlertAction>
    </Alert>)}</section>}

    {creating && <Card><CardContent className="space-y-4 p-5"><div><h2 className="font-semibold">Créer un agent</h2><p className="mt-1 text-sm text-muted-foreground">Définissez son nom, son rôle et les consignes générales. Ajoutez ensuite des skills et outils depuis sa fiche.</p></div><AgentProfileForm saving={saving} onSave={create} onCancel={() => setCreating(false)} /></CardContent></Card>}

    <section aria-labelledby="specialists-heading" className="space-y-3"><div className="flex items-center justify-between"><h2 id="specialists-heading" className="text-sm font-semibold">Agents spécialisés</h2>{catalog && <span className="text-xs text-muted-foreground">{catalog.profiles.length} profil{catalog.profiles.length === 1 ? '' : 's'}</span>}</div>
      {loading && <div role="status" className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Chargement des agents…</div>}
      {!loading && error && <div role="alert" className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">{error}<Button className="ml-3" size="sm" variant="outline" onClick={() => void refresh()}>Réessayer</Button></div>}
      {!loading && !error && catalog?.profiles.length === 0 && <div className="rounded-xl border border-dashed p-8 text-center"><IconTile variant="soft" className="mx-auto text-muted-foreground" aria-hidden="true"><Bot /></IconTile><p className="mt-3 font-medium">Aucun agent spécialisé pour le moment</p><p className="mt-1 text-sm text-muted-foreground">L’orchestrateur peut en créer un automatiquement lorsqu’une demande complexe le nécessite.</p></div>}
      {!loading && catalog?.profiles.map((profile) => <AgentProfileCard key={profile.id} profile={profile} disabled={saving} onToggle={(item) => void toggle(item)} onDelete={(item) => void remove(item)} />)}
    </section>

    <Dialog open={activeMerge !== null} onOpenChange={(open) => { if (!open && !saving) setActiveMerge(null) }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Fusionner deux agents ?</DialogTitle>
          <DialogDescription>Les capacités, skills et consignes générales de l’agent source seront ajoutés à l’agent cible. Le profil source restera conservé et désactivé pour préserver son historique.</DialogDescription>
        </DialogHeader>
        {activeMerge && <div className="space-y-4 text-sm">
          <div className="rounded-lg border p-3"><p className="font-medium">{activeMerge.source_name}<ArrowRight aria-hidden="true" className="mx-2 inline size-4" />{activeMerge.target_name}</p><p className="mt-1 text-muted-foreground">Similarité détectée : {Math.round(activeMerge.similarity_score * 100)} %</p><ul className="mt-2 list-inside list-disc text-muted-foreground">{activeMerge.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></div>
          {catalog && <div><p className="font-medium">Skills qui seront ajoutés</p><p className="mt-1 text-muted-foreground">{(catalog.profiles.find((profile) => profile.id === activeMerge.source_profile_id)?.skills ?? []).map((skill) => skill.name).join(' · ') || 'Aucun skill supplémentaire'}</p></div>}
          {sourceMcpTools.length > 0 && <label className="flex items-start gap-3 rounded-lg border p-3"><input type="checkbox" className="mt-1 size-4 accent-primary" checked={includeMcpTools} onChange={(event) => setIncludeMcpTools(event.target.checked)} /><span><span className="font-medium">Transférer aussi les autorisations MCP</span><span className="mt-1 block text-muted-foreground">{sourceMcpTools.length} outil{sourceMcpTools.length === 1 ? '' : 's'} seront affectés à l’agent cible : {sourceMcpTools.map((tool) => `${tool.server_id}/${tool.tool_name}`).join(', ')}.</span></span></label>}
        </div>}
        <DialogFooter><Button type="button" variant="outline" disabled={saving} onClick={() => setActiveMerge(null)}>Annuler</Button><Button type="button" disabled={saving} onClick={() => void mergeAgents()}>{saving ? 'Fusion…' : `Fusionner et désactiver « ${activeMerge?.source_name ?? '…'} »`}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
}
