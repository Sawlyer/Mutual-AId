import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, Clock3, RefreshCw, Search, Sparkles, Store } from 'lucide-react'
import { Badge } from '@/components/reui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { agentService } from '@/services/agent-service'
import type { AgentProfile, AgentSkill, SkillCatalogComparison, SkillCatalogItem } from '@/types/agent'
import { rankMarketplaceSkills } from './resource-recommendations'

const categories = [
  { id: '', label: 'Toutes les catégories' },
  { id: 'analysis', label: 'Analyse' },
  { id: 'planning', label: 'Planification' },
  { id: 'research', label: 'Recherche' },
  { id: 'writing', label: 'Rédaction' },
]

const sourceLabel: Record<AgentSkill['source'], string> = {
  user: 'Créée par vous', marketplace: 'Marketplace Mutual-AId', generated: 'Générée par l’orchestrateur',
}

export function SkillMarketplace({ profileId, profile, onProfileChanged, showHeading = true }: { profileId?: string; profile?: AgentProfile; onProfileChanged?: () => void | Promise<void>; showHeading?: boolean }) {
  const [catalog, setCatalog] = useState<SkillCatalogItem[]>([])
  const [skills, setSkills] = useState<AgentSkill[]>([])
  const [audit, setAudit] = useState<Awaited<ReturnType<typeof agentService.skillAudit>>>([])
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [comparison, setComparison] = useState<SkillCatalogComparison | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const pendingSkills = useMemo(() => skills.filter((skill) => skill.source === 'generated' && skill.review_status === 'pending'), [skills])
  const recommendations = useMemo(() => profile ? rankMarketplaceSkills(profile, catalog) : [], [profile, catalog])
  const recommendedIds = useMemo(() => new Set(recommendations.map(({ item }) => item.id)), [recommendations])
  const orderedCatalog = useMemo(() => recommendations.length
    ? [...recommendations.map(({ item }) => item), ...catalog.filter((item) => !recommendedIds.has(item.id))]
    : catalog, [catalog, recommendations, recommendedIds])

  async function refresh() {
    setLoading(true)
    try {
      const [items, library, events] = await Promise.all([
        agentService.searchSkillMarketplace(query, category), agentService.listSkills(), agentService.skillAudit(),
      ])
      setCatalog(items)
      setSkills(library)
      setAudit(events)
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Impossible de charger la marketplace locale.')
    } finally { setLoading(false) }
  }

  useEffect(() => {
    let active = true
    void Promise.all([agentService.searchSkillMarketplace(query, category), agentService.listSkills(), agentService.skillAudit()])
      .then(([items, library, events]) => {
        if (!active) return
        setCatalog(items)
        setSkills(library)
        setAudit(events)
        setError('')
      })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Impossible de charger la marketplace locale.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [query, category])

  async function install(item: SkillCatalogItem) {
    setBusyId(item.id)
    setError('')
    setNotice('')
    try {
      const skill = await agentService.installMarketplaceSkill(item.id, profileId)
      setNotice(profileId
        ? `« ${skill.name} » est installée et affectée à cet agent.`
        : `« ${skill.name} » est ajoutée à votre bibliothèque. Affectez-la à un agent depuis sa fiche.`)
      if (profileId) await onProfileChanged?.()
      await refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Installation impossible.') }
    finally { setBusyId('') }
  }

  async function compare(catalogId: string, targetVersion?: number) {
    const installed = skills.find((skill) => skill.catalog_id === catalogId) ?? skills.find((skill) => skill.id === catalogId)
    if (!installed) return
    setBusyId(catalogId)
    try { setComparison(await agentService.compareCatalogSkill(installed.id, targetVersion)); setError('') }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Comparaison impossible.') }
    finally { setBusyId('') }
  }

  async function upgrade(strategy: 'keep_customizations' | 'replace_customizations') {
    if (!comparison) return
    setBusyId(comparison.local.id)
    setError('')
    try {
      const result = await agentService.upgradeCatalogSkill(comparison.local.id, strategy, comparison.catalog.version)
      if (result.status === 'conflict') {
        setNotice('Votre version contient des changements. Comparez les instructions puis choisissez explicitement de les remplacer ou de les garder.')
      } else if (result.status === 'updated') {
        setNotice(result.message)
        setComparison(null)
      } else {
        setNotice(result.message)
      }
      await refresh()
      if (result.status === 'conflict') setComparison(await agentService.compareCatalogSkill(comparison.local.id, comparison.catalog.version))
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Mise à jour impossible.') }
    finally { setBusyId('') }
  }

  async function review(skill: AgentSkill, decision: 'approved' | 'rejected') {
    setBusyId(skill.id)
    setError('')
    try {
      await agentService.reviewGeneratedSkill(skill.id, decision)
      setNotice(decision === 'approved' ? `« ${skill.name} » est approuvée. Vous pouvez maintenant l’affecter à un agent.` : `« ${skill.name} » a été rejetée et restera inactive.`)
      await refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Revue impossible.') }
    finally { setBusyId('') }
  }

  return <section aria-labelledby={showHeading ? 'skill-marketplace-title' : undefined} className="space-y-4">
    {showHeading && <div className="flex items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><Store aria-hidden="true" className="size-5" /></span><div><h3 id="skill-marketplace-title" className="font-semibold">Bibliothèque de compétences</h3><p className="mt-1 max-w-3xl text-sm text-muted-foreground">Des consignes maintenues localement par Mutual-AId et affectées aux agents selon leurs besoins.</p></div></div>}

    <Card><CardContent className="space-y-4 p-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_220px]"><label className="relative"><span className="sr-only">Rechercher une compétence</span><Search aria-hidden="true" className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={(event) => { setLoading(true); setQuery(event.target.value) }} placeholder="Rechercher par nom, usage ou mot-clé…" className="pl-9" /></label><label><span className="sr-only">Filtrer par catégorie</span><select value={category} onChange={(event) => { setLoading(true); setCategory(event.target.value) }} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="">Toutes les catégories</option>{categories.filter((item) => item.id).map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label></div>
      {profileId && profile && <div className="rounded-lg border border-primary/15 bg-primary/5 px-3 py-2.5 text-xs"><p className="flex items-center gap-1.5 font-medium"><Sparkles aria-hidden="true" className="size-3.5 text-primary" />Suggestions pour {profile.name}</p><p className="mt-1 text-muted-foreground">{recommendations.length ? 'Classement local selon son rôle, sa description et ses compétences. Rien n’est ajouté sans votre action.' : 'Aucune compétence du catalogue ne correspond clairement à son rôle. Vous pouvez en créer une depuis la fiche de l’agent.'}</p></div>}
      {loading && <p role="status" className="flex items-center gap-2 py-5 text-sm text-muted-foreground"><RefreshCw className="size-4 animate-spin" />Chargement du catalogue local…</p>}
      {!loading && error && <div role="alert" className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">{error}<Button size="sm" variant="outline" className="ml-3" onClick={() => void refresh()}>Réessayer</Button></div>}
      {!loading && !error && catalog.length === 0 && <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Aucune compétence ne correspond à cette recherche.</p>}
      {!loading && orderedCatalog.length > 0 && <ul className="grid gap-3 md:grid-cols-2">{orderedCatalog.map((item) => {
        const installed = skills.find((skill) => skill.catalog_id === item.id)
        const assigned = profileId ? Boolean(installed?.assigned_profile_ids.includes(profileId)) : Boolean(installed)
        return <li key={item.id} className="rounded-xl border border-border/80 bg-background p-4">
          <div className="flex items-start justify-between gap-3"><div><h4 className="text-sm font-semibold">{item.name}</h4><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{item.description}</p></div><div className="flex shrink-0 items-center gap-1.5">{recommendedIds.has(item.id) && <Badge variant="primary-light" size="xs"><Sparkles aria-hidden="true" />Suggestion</Badge>}<Badge variant="outline">v{item.version}</Badge></div></div>
          <div className="mt-3 flex flex-wrap gap-1.5">{item.tags.map((tag) => <Badge key={tag} variant="secondary" size="xs">{tag}</Badge>)}<Badge variant="outline" size="xs">{categories.find((entry) => entry.id === item.category)?.label ?? item.category}</Badge></div>
          <p className="mt-3 text-xs text-muted-foreground">Par {item.author} · Mis à jour le {item.updated_at}</p>
          <div className="mt-3 flex justify-end gap-2">{assigned && installed ? <><Badge className="self-center" variant="secondary"><Check aria-hidden="true" className="mr-1 size-3" />{profileId ? 'Affectée' : 'Installée'} · v{installed.catalog_version}</Badge><Button size="sm" variant="outline" disabled={!!busyId} onClick={() => void compare(item.id)}>{busyId === item.id ? 'Comparaison…' : 'Comparer'}</Button></> : <Button size="sm" disabled={!!busyId} onClick={() => void install(item)}>{busyId === item.id ? 'Enregistrement…' : profileId ? installed ? 'Affecter à cet agent' : 'Installer pour cet agent' : 'Installer'}</Button>}</div>
        </li>
      })}</ul>}
    </CardContent></Card>

    {comparison && <Card><CardContent className="space-y-4 p-4"><div className="flex items-start justify-between gap-3"><div><h4 className="font-semibold">Comparer « {comparison.local.name} »</h4><p className="text-xs text-muted-foreground">Installée v{comparison.local.catalog_version} · Version choisie v{comparison.catalog.version}</p></div><div className="flex items-center gap-2"><label className="sr-only" htmlFor="skill-version">Version du catalogue</label><select id="skill-version" value={comparison.catalog.version} onChange={(event) => void compare(comparison.local.id, Number(event.target.value))} className="h-8 rounded-md border border-input bg-background px-2 text-xs">{comparison.available_versions.map((version) => <option key={version} value={version}>Version {version}</option>)}</select><Button variant="ghost" size="sm" onClick={() => setComparison(null)}>Fermer</Button></div></div>
      {comparison.customized && <p className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-800 dark:text-amber-200"><AlertTriangle aria-hidden="true" className="size-4 shrink-0" />Votre copie a été modifiée. La marketplace ne remplacera pas ces changements sans action explicite.</p>}
      <div className="grid gap-3 md:grid-cols-2"><div className="rounded-lg border p-3"><p className="mb-2 text-xs font-semibold">Votre copie</p><pre className="whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">{comparison.local.instructions}</pre></div><div className="rounded-lg border p-3"><p className="mb-2 text-xs font-semibold">Catalogue v{comparison.catalog.version}</p><pre className="whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">{comparison.catalog.instructions}</pre></div></div>
      {comparison.catalog.version !== comparison.local.catalog_version && <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" disabled={!!busyId} onClick={() => setComparison(null)}>Garder ma copie</Button>{comparison.customized && <Button variant="destructive" disabled={!!busyId} onClick={() => { if (window.confirm(`Remplacer vos modifications par la version ${comparison.catalog.version} du catalogue ? Cette action ne peut pas être annulée.`)) void upgrade('replace_customizations') }}>Remplacer par v{comparison.catalog.version}</Button>}{!comparison.customized && <Button disabled={!!busyId} onClick={() => void upgrade('keep_customizations')}>{comparison.catalog.version < (comparison.local.catalog_version ?? 0) ? `Revenir à v${comparison.catalog.version}` : `Mettre à jour vers v${comparison.catalog.version}`}</Button>}</div>}
    </CardContent></Card>}

      {pendingSkills.length > 0 && <Card><CardContent className="space-y-3 p-4"><div className="flex items-center gap-2"><Clock3 aria-hidden="true" className="size-4 text-amber-600" /><h4 className="text-sm font-semibold">Compétences générées à vérifier</h4><Badge variant="secondary">{pendingSkills.length}</Badge></div><p className="text-xs text-muted-foreground">Ces compétences restent désactivées et inutilisables jusqu’à votre approbation.</p><ul className="space-y-2">{pendingSkills.map((skill) => <li key={skill.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"><div className="min-w-0"><p className="text-sm font-medium">{skill.name}</p><p className="text-xs text-muted-foreground">{sourceLabel[skill.source]} · {skill.description || skill.instructions}</p></div><div className="flex gap-2"><Button size="sm" variant="outline" disabled={!!busyId} onClick={() => void review(skill, 'rejected')}>Rejeter</Button><Button size="sm" disabled={!!busyId} onClick={() => void review(skill, 'approved')}>{busyId === skill.id ? 'Enregistrement…' : 'Approuver'}</Button></div></li>)}</ul></CardContent></Card>}

    {notice && <p role="status" className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs text-emerald-800 dark:text-emerald-200">{notice}</p>}
    <details className="rounded-xl border border-border/70 bg-card px-4 py-3"><summary className="cursor-pointer text-sm font-medium">Historique des affectations et modifications</summary><ul className="mt-3 max-h-64 space-y-2 overflow-auto">{audit.length === 0 && <li className="text-xs text-muted-foreground">Aucune activité enregistrée.</li>}{audit.map((event) => <li key={event.id} className="flex flex-wrap justify-between gap-2 border-t border-border/60 pt-2 text-xs"><span>{event.action.replaceAll('_', ' ')} · skill {event.skill_id.slice(0, 8)}{event.profile_id ? ` · agent ${event.profile_id.slice(0, 8)}` : ''}</span><time className="text-muted-foreground">{new Date(event.created_at).toLocaleString('fr-FR')}</time></li>)}</ul></details>
  </section>
}
