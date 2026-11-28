import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, Bot, Check, LoaderCircle, Pencil, Power, RefreshCw, Trash2 } from 'lucide-react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { Badge } from '@/components/reui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { IconTile } from '@/components/reui/icon-tile'
import { AgentMcpGrants } from '@/features/agents/agent-mcp-grants'
import { AgentProfileForm } from '@/features/agents/agent-profile-form'
import { AgentSkillsEditor } from '@/features/agents/agent-skills-editor'
import { SkillMarketplace } from '@/features/agents/skill-marketplace'
import { AgentServiceError, agentService } from '@/services/agent-service'
import type { AgentProfile, AgentProfileInput } from '@/types/agent'

function originLabel(profile: AgentProfile) {
  if (profile.origin === 'auto_created') return 'Créé automatiquement'
  if (profile.origin === 'system_template') return 'Modèle Mutual-AId'
  return 'Créé par vous'
}

export function AgentDetailPage() {
  const { profileId = '' } = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [profile, setProfile] = useState<AgentProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState('')
  const [notFound, setNotFound] = useState(false)
  const [marketplaceOpen, setMarketplaceOpen] = useState(false)
  const mcpServerAdded = searchParams.get('mcp_added') === '1'

  const refresh = useCallback(async () => {
    if (!profileId) return
    setLoading(true)
    setError('')
    setNotFound(false)
    try {
      setProfile(await agentService.getProfile(profileId))
    } catch (cause) {
      if (cause instanceof AgentServiceError && cause.status === 404) {
        setNotFound(true)
        setProfile(null)
      } else {
        setError(cause instanceof Error ? cause.message : 'Impossible de charger cet agent.')
      }
    } finally { setLoading(false) }
  }, [profileId])

  useEffect(() => {
    let active = true
    if (!profileId) {
      return () => { active = false }
    }
    void agentService.getProfile(profileId).then((result) => {
      if (!active) return
      setProfile(result)
      setError('')
      setNotFound(false)
    }).catch((cause: unknown) => {
      if (!active) return
      if (cause instanceof AgentServiceError && cause.status === 404) {
        setNotFound(true)
        setProfile(null)
      } else {
        setError(cause instanceof Error ? cause.message : 'Impossible de charger cet agent.')
      }
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [profileId])

  async function save(input: AgentProfileInput) {
    if (!profile) return
    setSaving(true)
    setError('')
    try {
      setProfile(await agentService.update(profile.id, input))
      setEditing(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Impossible d’enregistrer cet agent.')
      throw cause
    } finally { setSaving(false) }
  }

  async function toggleEnabled() {
    if (!profile) return
    setSaving(true)
    setError('')
    try { setProfile(await agentService.update(profile.id, { enabled: !profile.enabled })) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Impossible de modifier cet agent.') }
    finally { setSaving(false) }
  }

  async function remove() {
    if (!profile || !window.confirm(`Supprimer l’agent « ${profile.name} » ?`)) return
    setSaving(true)
    try { await agentService.remove(profile.id); navigate('/agents', { replace: true }) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Impossible de supprimer cet agent.') }
    finally { setSaving(false) }
  }

  if (loading && !profile) return <div role="status" className="flex items-center gap-2 py-10 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Chargement de la fiche agent…</div>
  if (notFound) return <div className="mx-auto max-w-xl space-y-4 py-10 text-center"><IconTile className="mx-auto text-muted-foreground" aria-hidden="true"><Bot /></IconTile><h2 className="text-xl font-semibold">Agent introuvable</h2><p className="text-sm text-muted-foreground">Cet agent n’existe plus ou n’est pas accessible depuis votre compte.</p><Button render={<Link to="/agents" />}><ArrowLeft />Retour aux agents</Button></div>
  if (error && !profile) return <div className="mx-auto max-w-xl space-y-4 py-10 text-center"><p role="alert" className="text-sm text-destructive">{error}</p><div className="flex justify-center gap-2"><Button variant="outline" render={<Link to="/agents" />}><ArrowLeft />Retour aux agents</Button><Button onClick={() => void refresh()}><RefreshCw />Réessayer</Button></div></div>
  if (!profile) return null

  return <div className="mx-auto max-w-5xl space-y-6 pb-10">
    <Link to="/agents" className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"><ArrowLeft aria-hidden="true" className="size-4" />Tous les agents</Link>
    <header className="flex flex-col gap-5 rounded-2xl border border-border/70 bg-card p-5 sm:flex-row sm:items-start sm:p-6">
      <IconTile variant="soft" size="lg" className="shrink-0 text-primary" aria-hidden="true"><Bot /></IconTile>
      <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h1 className="font-heading text-2xl font-semibold tracking-tight">{profile.name}</h1><Badge variant={profile.merged_into_id ? 'outline' : profile.enabled ? 'success-light' : 'secondary'}>{profile.merged_into_id ? 'Fusionné' : profile.enabled ? 'Actif' : 'Inactif'}</Badge><Badge variant="outline">{originLabel(profile)}</Badge></div><p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">{profile.description}</p></div>
      <div className="flex shrink-0 flex-wrap gap-2"><Button type="button" size="sm" variant="outline" disabled={saving || Boolean(profile.merged_into_id)} onClick={() => setEditing((current) => !current)}><Pencil />{editing ? 'Fermer l’édition' : 'Modifier le profil'}</Button><Button type="button" size="sm" variant="outline" disabled={saving || Boolean(profile.merged_into_id)} onClick={() => void toggleEnabled()}><Power />{profile.enabled ? 'Désactiver' : 'Activer'}</Button><Button type="button" size="icon-sm" variant="ghost" disabled={saving} aria-label={`Supprimer ${profile.name}`} onClick={() => void remove()} className="text-muted-foreground hover:text-destructive"><Trash2 /></Button></div>
    </header>

    {error && <p role="alert" className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">{error}</p>}
    {profile.merged_into_id && <p role="status" className="rounded-lg border border-info/30 bg-info/4 px-4 py-3 text-sm text-muted-foreground">Cet agent a été fusionné dans un autre profil. Sa fiche reste accessible pour consulter les informations liées à son historique.</p>}
    {mcpServerAdded && <p role="status" className="flex items-center gap-2 rounded-lg border border-success/20 bg-success/5 px-4 py-3 text-sm text-success"><Check aria-hidden="true" className="size-4" />Serveur ajouté. Choisissez maintenant les outils à autoriser pour cet agent.</p>}
    {editing && <Card><CardContent className="space-y-4 p-5"><div><h2 className="font-semibold">Profil de l’agent</h2><p className="mt-1 text-sm text-muted-foreground">Définis son rôle, sa description et les consignes générales qui guident son travail.</p></div><AgentProfileForm key={profile.id} profile={profile} saving={saving} onSave={save} onCancel={() => setEditing(false)} /></CardContent></Card>}

    <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
      <Card><CardContent className="space-y-5 p-5"><AgentSkillsEditor key={`${profile.id}-${(profile.skill_ids ?? []).join(':')}`} profile={profile} onChange={setProfile} onOpenMarketplace={() => setMarketplaceOpen(true)} /></CardContent></Card>
      <Card><CardContent className="space-y-5 p-5"><AgentMcpGrants profile={profile} onSaved={() => void refresh()} /><div className="border-t border-border/70 pt-5"><h3 className="text-sm font-semibold">À propos de cet agent</h3><dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-xs text-muted-foreground">État</dt><dd className="mt-1 font-medium">{profile.enabled ? 'Actif pour les prochaines missions' : 'Mis en pause'}</dd></div><div><dt className="text-xs text-muted-foreground">Origine</dt><dd className="mt-1 font-medium">{originLabel(profile)}</dd></div><div className="sm:col-span-2"><dt className="text-xs text-muted-foreground">Créé le</dt><dd className="mt-1 font-medium">{new Date(profile.created_at).toLocaleDateString('fr-FR', { dateStyle: 'long' })}</dd></div></dl></div></CardContent></Card>
    </div>
    <Dialog open={marketplaceOpen} onOpenChange={setMarketplaceOpen}>
      <DialogContent className="max-h-[88svh] w-[min(960px,calc(100vw-2rem))] overflow-y-auto sm:max-w-none">
        <DialogHeader>
          <DialogTitle>Bibliothèque de compétences</DialogTitle>
          <DialogDescription>Choisissez une compétence du catalogue local pour l’affecter à {profile.name}.</DialogDescription>
        </DialogHeader>
        <SkillMarketplace profileId={profile.id} profile={profile} onProfileChanged={refresh} showHeading={false} />
      </DialogContent>
    </Dialog>
  </div>
}
