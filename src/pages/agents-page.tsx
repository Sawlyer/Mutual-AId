import { useCallback, useEffect, useState } from 'react'
import { Bot, CheckCircle2, CircleAlert, LoaderCircle, Plus, Radio } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { AgentProfileCard } from '@/features/agents/agent-profile-card'
import { AgentProfileForm } from '@/features/agents/agent-profile-form'
import { agentService } from '@/services/agent-service'
import { chatAdapter } from '@/services/chat-adapters'
import type { AgentCatalog, AgentProfile, AgentProfileInput } from '@/types/agent'

type AgentConnection = 'checking' | 'ready' | 'missing' | 'offline' | 'demo'

export function AgentsPage() {
  const [connection, setConnection] = useState<AgentConnection>(chatAdapter.mode === 'demo' ? 'demo' : 'checking')
  const [catalog, setCatalog] = useState<AgentCatalog | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [editor, setEditor] = useState<AgentProfile | 'new' | null>(null)

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
    if (chatAdapter.mode === 'demo') return
    void chatAdapter.checkHealth().then((result) => {
      if (active) setConnection(result.openai_configured ? 'ready' : 'missing')
    }).catch(() => { if (active) setConnection('offline') })
    return () => { active = false }
  }, [])

  const status = {
    checking: { label: 'Vérification…', icon: LoaderCircle, style: 'border-border bg-muted text-muted-foreground' },
    ready: { label: 'Disponible', icon: CheckCircle2, style: 'border-emerald-500/20 bg-emerald-500/8 text-emerald-700 dark:text-emerald-300' },
    missing: { label: 'Configuration requise', icon: CircleAlert, style: 'border-amber-500/20 bg-amber-500/8 text-amber-700 dark:text-amber-300' },
    offline: { label: 'Backend inaccessible', icon: CircleAlert, style: 'border-destructive/20 bg-destructive/5 text-destructive' },
    demo: { label: 'Mode démo', icon: Radio, style: 'border-amber-500/20 bg-amber-500/8 text-amber-700 dark:text-amber-300' },
  }[connection]
  const StatusIcon = status.icon

  async function save(input: AgentProfileInput) {
    setSaving(true)
    try {
      if (editor === 'new') await agentService.create(input)
      else if (editor) await agentService.update(editor.id, input)
      setEditor(null)
      await refresh()
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

  return <div className="max-w-4xl space-y-6">
    <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-sm text-muted-foreground">Spécialistes personnels</p><h2 className="mt-1 font-heading text-2xl font-semibold tracking-tight">Agents</h2><p className="mt-1 max-w-2xl text-sm text-muted-foreground">Les agents spécialisés sont créés depuis des modèles vérifiés lorsque le chat en a besoin. Vous pouvez ensuite les modifier, désactiver ou supprimer.</p></div><Button onClick={() => setEditor('new')} disabled={!!editor}><Plus />Créer un agent</Button></header>
    <Card><CardContent className="flex gap-4 p-4"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><Bot aria-hidden="true" className="size-5" /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="font-medium">Assistant conversationnel</h3><Badge variant="outline" className={status.style}><StatusIcon aria-hidden="true" className={`mr-1.5 size-3.5 ${connection === 'checking' ? 'animate-spin' : ''}`} />{status.label}</Badge></div><p className="mt-1 text-sm text-muted-foreground">Répond aux demandes et conserve l’historique des conversations.</p>{connection === 'missing' && <p className="mt-3 text-xs text-muted-foreground">Renseignez <code>OPENAI_API_KEY</code> et <code>OPENAI_MODEL</code> dans <code>backend/.env</code>.</p>}{connection === 'offline' && <p role="alert" className="mt-3 text-xs text-destructive">Le backend ne répond pas. Lancez <code>npm run dev:all</code>.</p>}{connection === 'demo' && <p className="mt-3 text-xs text-muted-foreground">Les réponses du chat sont simulées dans ce mode.</p>}</div></CardContent></Card>
    {editor && <Card><CardContent className="space-y-4 p-5"><div><h3 className="font-semibold">{editor === 'new' ? 'Créer un profil' : `Modifier ${editor.name}`}</h3><p className="text-sm text-muted-foreground">Les profils définissent le rôle et les compétences. Les permissions de connecteurs se règlent séparément.</p></div><AgentProfileForm capabilities={catalog?.capabilities ?? []} profile={editor === 'new' ? undefined : editor} saving={saving} onSave={save} onCancel={() => setEditor(null)} /></CardContent></Card>}
    <section aria-labelledby="specialists-heading" className="space-y-3"><div className="flex items-center justify-between"><h3 id="specialists-heading" className="text-sm font-semibold">Agents spécialisés</h3>{catalog && <span className="text-xs text-muted-foreground">{catalog.profiles.length} profil{catalog.profiles.length === 1 ? '' : 's'}</span>}</div>
      {loading && <div role="status" className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Chargement des agents…</div>}
      {!loading && error && <div role="alert" className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">{error}<Button className="ml-3" size="sm" variant="outline" onClick={() => void refresh()}>Réessayer</Button></div>}
      {!loading && !error && catalog?.profiles.length === 0 && <div className="rounded-xl border border-dashed p-8 text-center"><Bot className="mx-auto size-7 text-muted-foreground" /><p className="mt-3 font-medium">Aucun spécialiste pour le moment</p><p className="mt-1 text-sm text-muted-foreground">Un agent adapté sera créé automatiquement quand une demande complexe le nécessitera.</p></div>}
      {!loading && catalog?.profiles.map((profile) => <AgentProfileCard key={profile.id} profile={profile} capabilities={catalog.capabilities} onEdit={setEditor} onToggle={(item) => void toggle(item)} onDelete={(item) => void remove(item)} />)}
    </section>
  </div>
}
