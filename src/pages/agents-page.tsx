import { useCallback, useEffect, useState } from 'react'
import { Bot, CheckCircle2, CircleAlert, LoaderCircle, Plus, Radio } from 'lucide-react'
import { useNavigate } from 'react-router'
import { Badge } from '@/components/reui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { IconTile } from '@/components/reui/icon-tile'
import { AgentProfileCard } from '@/features/agents/agent-profile-card'
import { AgentProfileForm } from '@/features/agents/agent-profile-form'
import { agentService } from '@/services/agent-service'
import { chatAdapter } from '@/services/chat-adapters'
import type { AgentCatalog, AgentProfile, AgentProfileInput } from '@/types/agent'

type AgentConnection = 'checking' | 'ready' | 'missing' | 'offline' | 'demo'

export function AgentsPage() {
  const navigate = useNavigate()
  const [connection, setConnection] = useState<AgentConnection>(chatAdapter.mode === 'demo' ? 'demo' : 'checking')
  const [catalog, setCatalog] = useState<AgentCatalog | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try { setCatalog(await agentService.list()); setError('') }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Impossible de charger les profils.') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    let active = true
    void agentService.list().then((result) => {
      if (active) { setCatalog(result); setError('') }
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : 'Impossible de charger les profils.')
    }).finally(() => { if (active) setLoading(false) })
    if (chatAdapter.mode === 'demo') return () => { active = false }
    void chatAdapter.checkHealth().then((result) => {
      if (active) setConnection(result.openai_configured ? 'ready' : 'missing')
    }).catch(() => { if (active) setConnection('offline') })
    return () => { active = false }
  }, [])

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

  return <div className="mx-auto max-w-5xl space-y-6 pb-10">
    <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-sm text-muted-foreground">Votre équipe d’agents</p><h1 className="mt-1 font-heading text-2xl font-semibold tracking-tight">Agents</h1><p className="mt-1 max-w-2xl text-sm text-muted-foreground">Créez des spécialistes que l’orchestrateur pourra réutiliser selon leur rôle et leurs skills. Chaque agent se configure depuis sa fiche.</p></div><Button onClick={() => setCreating((current) => !current)} disabled={saving}><Plus />{creating ? 'Fermer' : 'Créer un agent'}</Button></header>

    <Card><CardContent className="flex items-center gap-4 p-4"><IconTile variant="soft" className="shrink-0 text-primary" aria-hidden="true"><Bot /></IconTile><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="font-medium">Assistant conversationnel</h2><Badge variant={status.variant}><StatusIcon aria-hidden="true" className={`mr-1.5 size-3.5 ${connection === 'checking' ? 'animate-spin' : ''}`} />{status.label}</Badge></div><p className="mt-1 text-sm text-muted-foreground">Analyse les demandes, choisit les spécialistes utiles et garde l’historique de vos conversations.</p>{connection === 'missing' && <p className="mt-2 text-xs text-muted-foreground">Renseignez <code>OPENAI_API_KEY</code> et <code>OPENAI_MODEL</code> dans <code>backend/.env</code>.</p>}{connection === 'offline' && <p role="alert" className="mt-2 text-xs text-destructive">Le backend ne répond pas. Lancez <code>npm run dev:all</code>.</p>}{connection === 'demo' && <p className="mt-2 text-xs text-muted-foreground">Les réponses du chat sont simulées dans ce mode.</p>}</div></CardContent></Card>

    {creating && <Card><CardContent className="space-y-4 p-5"><div><h2 className="font-semibold">Créer un agent</h2><p className="mt-1 text-sm text-muted-foreground">Définissez son nom, son rôle et les consignes générales. Ajoutez ensuite des skills et outils depuis sa fiche.</p></div><AgentProfileForm saving={saving} onSave={create} onCancel={() => setCreating(false)} /></CardContent></Card>}

    <section aria-labelledby="specialists-heading" className="space-y-3"><div className="flex items-center justify-between"><h2 id="specialists-heading" className="text-sm font-semibold">Agents spécialisés</h2>{catalog && <span className="text-xs text-muted-foreground">{catalog.profiles.length} profil{catalog.profiles.length === 1 ? '' : 's'}</span>}</div>
      {loading && <div role="status" className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Chargement des agents…</div>}
      {!loading && error && <div role="alert" className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">{error}<Button className="ml-3" size="sm" variant="outline" onClick={() => void refresh()}>Réessayer</Button></div>}
      {!loading && !error && catalog?.profiles.length === 0 && <div className="rounded-xl border border-dashed p-8 text-center"><IconTile variant="soft" className="mx-auto text-muted-foreground" aria-hidden="true"><Bot /></IconTile><p className="mt-3 font-medium">Aucun agent spécialisé pour le moment</p><p className="mt-1 text-sm text-muted-foreground">L’orchestrateur peut en créer un automatiquement lorsqu’une demande complexe le nécessite.</p></div>}
      {!loading && catalog?.profiles.map((profile) => <AgentProfileCard key={profile.id} profile={profile} disabled={saving} onToggle={(item) => void toggle(item)} onDelete={(item) => void remove(item)} />)}
    </section>
  </div>
}
