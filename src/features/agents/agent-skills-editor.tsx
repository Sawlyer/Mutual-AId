import { useEffect, useState, type FormEvent } from 'react'
import { LoaderCircle, Minus, Pencil, Plus, ShieldCheck, Trash2 } from 'lucide-react'
import { Badge } from '@/components/reui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { agentService } from '@/services/agent-service'
import type { AgentProfile, AgentSkill } from '@/types/agent'

interface AgentSkillsEditorProps {
  profile: AgentProfile
  onChange?: (profile: AgentProfile) => void
}

export function AgentSkillsEditor({ profile, onChange }: AgentSkillsEditorProps) {
  const [skills, setSkills] = useState<AgentSkill[]>(profile.skills ?? [])
  const [assignedIds, setAssignedIds] = useState<string[]>(profile.skill_ids ?? [])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<AgentSkill | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [instructions, setInstructions] = useState('')

  useEffect(() => {
    let active = true
    void agentService.listSkills().then((items) => {
      if (active) setSkills(items)
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : 'Impossible de charger les compétences.')
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  const assignedSkills = skills.filter((skill) => assignedIds.includes(skill.id))
  const availableSkills = skills.filter((skill) => !assignedIds.includes(skill.id))

  function resetForm() {
    setEditing(null)
    setName('')
    setDescription('')
    setInstructions('')
  }

  function beginEdit(skill: AgentSkill) {
    setEditing(skill)
    setName(skill.name)
    setDescription(skill.description)
    setInstructions(skill.instructions)
  }

  async function refreshProfile() {
    const canonical = await agentService.getProfile(profile.id)
    setAssignedIds(canonical.skill_ids ?? [])
    onChange?.(canonical)
  }

  async function persistAssignment(skillIds: string[]) {
    setBusy(true)
    setError('')
    try {
      const updated = await agentService.update(profile.id, { skill_ids: skillIds })
      setAssignedIds(updated.skill_ids ?? [])
      setSkills((current) => {
        const updatedById = new Map((updated.skills ?? []).map((skill) => [skill.id, skill]))
        return current.map((skill) => updatedById.get(skill.id) ?? skill)
      })
      onChange?.(updated)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Les compétences de cet agent n’ont pas pu être enregistrées.')
    } finally { setBusy(false) }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const input = { name: name.trim(), description: description.trim(), instructions: instructions.trim() }
    if (!input.name || !input.instructions) {
      setError('Le nom et les instructions sont obligatoires.')
      return
    }
    setBusy(true)
    setError('')
    try {
      if (editing) {
        const updated = await agentService.updateSkill(editing.id, input)
        setSkills((current) => current.map((item) => item.id === updated.id ? updated : item))
      } else {
        const created = await agentService.createSkill(input)
        setSkills((current) => [...current, created].sort((a, b) => a.name.localeCompare(b.name, 'fr')))
        await agentService.update(profile.id, { skill_ids: [...assignedIds, created.id] })
      }
      await refreshProfile()
      resetForm()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'La compétence n’a pas pu être enregistrée.')
    } finally { setBusy(false) }
  }

  async function toggleEnabled(skill: AgentSkill) {
    setBusy(true)
    setError('')
    try {
      const updated = await agentService.updateSkill(skill.id, { enabled: !skill.enabled })
      setSkills((current) => current.map((item) => item.id === updated.id ? updated : item))
      if (assignedIds.includes(updated.id)) await refreshProfile()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Impossible de modifier cette compétence.') }
    finally { setBusy(false) }
  }

  async function deleteSkill(skill: AgentSkill) {
    if (!window.confirm(`Supprimer la compétence « ${skill.name} » et la retirer de tous les agents ?`)) return
    setBusy(true)
    setError('')
    try {
      await agentService.deleteSkill(skill.id)
      setSkills((current) => current.filter((item) => item.id !== skill.id))
      if (assignedIds.includes(skill.id)) await refreshProfile()
      if (editing?.id === skill.id) resetForm()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Impossible de supprimer cette compétence.') }
    finally { setBusy(false) }
  }

  function skillRow(skill: AgentSkill, assigned: boolean) {
    return <li key={skill.id} className="flex flex-wrap items-start gap-3 rounded-lg border border-border/70 bg-card p-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
          {skill.name}
          <Badge size="xs" variant={skill.enabled ? 'success-light' : 'secondary'}>{skill.enabled ? 'Activée' : 'Désactivée'}</Badge>
          {skill.source === 'marketplace' && skill.catalog_version !== null && <Badge size="xs" variant="primary-light">Marketplace v{skill.catalog_version}</Badge>}
          {skill.review_status === 'pending' && <Badge size="xs" variant="warning-light">À vérifier</Badge>}
        </div>
        {skill.description && <p className="mt-1 text-xs text-muted-foreground">{skill.description}</p>}
      </div>
      <div className="flex w-full flex-wrap justify-end gap-1 sm:w-auto sm:shrink-0">
        {assigned
          ? <Button type="button" size="xs" variant="outline" disabled={busy} onClick={() => void persistAssignment(assignedIds.filter((id) => id !== skill.id))}><Minus aria-hidden="true" className="size-3.5" />Retirer</Button>
          : <Button type="button" size="xs" variant="outline" disabled={busy || skill.review_status !== 'approved'} onClick={() => void persistAssignment([...assignedIds, skill.id])}><Plus aria-hidden="true" className="size-3.5" />Ajouter</Button>}
        <Button type="button" size="xs" variant="ghost" disabled={busy} aria-label={`Modifier ${skill.name}`} onClick={() => beginEdit(skill)}><Pencil aria-hidden="true" className="size-3.5" /></Button>
        {skill.review_status === 'approved' && <Button type="button" size="xs" variant="ghost" disabled={busy} onClick={() => void toggleEnabled(skill)}>{skill.enabled ? 'Désactiver' : 'Activer'}</Button>}
        <Button type="button" size="xs" variant="ghost" disabled={busy} aria-label={`Supprimer ${skill.name}`} onClick={() => void deleteSkill(skill)} className="text-muted-foreground hover:text-destructive"><Trash2 aria-hidden="true" className="size-3.5" /></Button>
      </div>
    </li>
  }

  return <section aria-labelledby="agent-skills-title" className="space-y-4">
    <div className="flex items-start gap-3">
      <span className="mt-0.5 text-primary"><ShieldCheck aria-hidden="true" className="size-4" /></span>
      <div><h3 id="agent-skills-title" className="text-sm font-semibold">Skills</h3><p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">Les skills donnent à l’orchestrateur des consignes de comportement pour choisir cet agent. Elles ne donnent aucun accès à des outils ou à des connecteurs.</p></div>
    </div>

    {loading ? <p role="status" className="flex items-center gap-2 py-3 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Chargement des skills…</p>
      : assignedSkills.length === 0 ? <p className="rounded-lg border border-dashed border-border px-4 py-5 text-sm text-muted-foreground">Aucun skill n’est associé à cet agent. Ajoutez-en depuis votre bibliothèque ou la marketplace locale.</p>
        : <ul className="space-y-2" aria-label="Skills associés à cet agent">{assignedSkills.map((skill) => skillRow(skill, true))}</ul>}

    {availableSkills.length > 0 && <details className="rounded-lg border border-border/70 px-4 py-3"><summary className="cursor-pointer text-sm font-medium">Ajouter depuis la bibliothèque <span className="text-muted-foreground">({availableSkills.length})</span></summary><ul className="mt-3 space-y-2">{availableSkills.map((skill) => skillRow(skill, false))}</ul></details>}

    <form onSubmit={(event) => void submit(event)} className="space-y-3 rounded-xl border border-border/70 bg-muted/15 p-4">
      <div><p className="text-sm font-semibold">{editing ? `Modifier « ${editing.name} »` : 'Créer un skill pour cet agent'}</p><p className="mt-1 text-xs text-muted-foreground">Un skill contient des instructions réutilisables. Il sera affecté à cet agent après sa création.</p></div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5"><Label htmlFor="skill-name">Nom</Label><Input id="skill-name" value={name} onChange={(event) => setName(event.target.value)} required maxLength={80} placeholder="Vérification des sources" /></div>
        <div className="space-y-1.5"><Label htmlFor="skill-description">Description</Label><Input id="skill-description" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={300} placeholder="Précise les références à consulter" /></div>
      </div>
      <div className="space-y-1.5"><Label htmlFor="skill-instructions">Instructions</Label><Textarea id="skill-instructions" value={instructions} onChange={(event) => setInstructions(event.target.value)} required maxLength={4000} rows={3} placeholder="Explique le comportement à suivre…" /></div>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        {editing && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={resetForm}>Annuler</Button>}
        <Button type="submit" size="sm" disabled={busy}>{busy ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> : <Plus aria-hidden="true" className="size-3.5" />}{editing ? 'Enregistrer le skill' : 'Créer et affecter'}</Button>
      </div>
    </form>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </section>
}
