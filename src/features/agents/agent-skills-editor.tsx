import { useEffect, useState, type FormEvent } from 'react'
import { LoaderCircle, Pencil, Plus, ShieldCheck, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { agentService } from '@/services/agent-service'
import type { AgentProfile, AgentSkill } from '@/types/agent'

interface AgentSkillsEditorProps {
  profile: AgentProfile
  onChange: (skills: AgentSkill[], skillIds: string[]) => void
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

  async function persistAssignment(skillIds: string[]) {
    setBusy(true)
    setError('')
    try {
      const updated = await agentService.update(profile.id, { skill_ids: skillIds })
      const nextIds = updated.skill_ids ?? []
      const nextSkills = updated.skills ?? []
      setAssignedIds(nextIds)
      onChange(nextSkills, nextIds)
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
        const assigned = await agentService.update(profile.id, { skill_ids: [...assignedIds, created.id] })
        const nextIds = assigned.skill_ids ?? []
        const nextSkills = assigned.skills ?? []
        setAssignedIds(nextIds)
        onChange(nextSkills, nextIds)
      }
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
      if (assignedIds.includes(updated.id)) {
        const nextSkills = profile.skills.map((item) => item.id === updated.id ? updated : item)
        onChange(nextSkills, assignedIds)
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Impossible de modifier cette compétence.') }
    finally { setBusy(false) }
  }

  async function deleteSkill(skill: AgentSkill) {
    if (!window.confirm(`Supprimer la compétence « ${skill.name} » et la retirer de tous les agents ?`)) return
    setBusy(true)
    setError('')
    try {
      await agentService.deleteSkill(skill.id)
      const nextIds = assignedIds.filter((id) => id !== skill.id)
      const nextSkills = profile.skills.filter((item) => item.id !== skill.id)
      setSkills((current) => current.filter((item) => item.id !== skill.id))
      setAssignedIds(nextIds)
      onChange(nextSkills, nextIds)
      if (editing?.id === skill.id) resetForm()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Impossible de supprimer cette compétence.') }
    finally { setBusy(false) }
  }

  return <section aria-labelledby="agent-skills-title" className="space-y-3 rounded-xl border border-border/80 bg-muted/15 p-4">
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 text-primary"><ShieldCheck aria-hidden="true" className="size-4" /></span>
      <div><h4 id="agent-skills-title" className="text-sm font-semibold">Compétences de l’agent</h4><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Des consignes réutilisables qui précisent son comportement. Elles n’ajoutent aucun outil ni accès aux connecteurs.</p></div>
    </div>

    {loading ? <p role="status" className="flex items-center gap-2 py-3 text-xs text-muted-foreground"><LoaderCircle className="size-3.5 animate-spin" />Chargement de la bibliothèque…</p>
      : skills.length === 0 ? <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">Votre bibliothèque est vide. Créez une compétence ci-dessous ; les agents spécialisés créés automatiquement reçoivent leurs compétences initiales depuis leur modèle.</p>
        : <ul className="space-y-2" aria-label="Bibliothèque des compétences">
          {skills.map((skill) => {
            const assigned = assignedIds.includes(skill.id)
            return <li key={skill.id} className="flex flex-wrap items-start gap-3 rounded-lg border border-border/70 bg-card p-3">
              <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2.5">
                <input type="checkbox" checked={assigned} disabled={busy} onChange={(event) => void persistAssignment(event.target.checked ? [...assignedIds, skill.id] : assignedIds.filter((id) => id !== skill.id))} aria-label={`Affecter ${skill.name} à ${profile.name}`} className="mt-0.5 accent-primary" />
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2 text-xs font-medium">{skill.name}<span className={`rounded px-1.5 py-0.5 text-[9px] ${skill.enabled ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-muted text-muted-foreground'}`}>{skill.enabled ? 'Activée' : 'Désactivée'}</span>{assigned && <span className="rounded bg-primary/8 px-1.5 py-0.5 text-[9px] text-primary">Affectée</span>}</span>
                  {skill.description && <span className="mt-1 block text-[11px] text-muted-foreground">{skill.description}</span>}
                </span>
              </label>
              <div className="flex shrink-0 gap-1">
                <Button type="button" size="xs" variant="ghost" disabled={busy} aria-label={`Modifier ${skill.name}`} onClick={() => beginEdit(skill)}><Pencil aria-hidden="true" className="size-3.5" /></Button>
                <Button type="button" size="xs" variant="ghost" disabled={busy} onClick={() => void toggleEnabled(skill)}>{skill.enabled ? 'Désactiver' : 'Activer'}</Button>
                <Button type="button" size="xs" variant="ghost" disabled={busy} aria-label={`Supprimer ${skill.name}`} onClick={() => void deleteSkill(skill)} className="text-muted-foreground hover:text-destructive"><Trash2 aria-hidden="true" className="size-3.5" /></Button>
              </div>
            </li>
          })}
        </ul>}

    <form onSubmit={(event) => void submit(event)} className="space-y-3 border-t border-border/70 pt-3">
      <div><p className="text-xs font-semibold">{editing ? `Modifier « ${editing.name} »` : 'Créer une compétence'}</p><p className="mt-0.5 text-[10px] text-muted-foreground">Les instructions sont du texte simple, limité à 4 000 caractères.</p></div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5"><Label htmlFor="skill-name">Nom</Label><Input id="skill-name" value={name} onChange={(event) => setName(event.target.value)} required maxLength={80} placeholder="Vérification des sources" /></div>
        <div className="space-y-1.5"><Label htmlFor="skill-description">Description</Label><Input id="skill-description" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={300} placeholder="Précise les références à consulter" /></div>
      </div>
      <div className="space-y-1.5"><Label htmlFor="skill-instructions">Instructions</Label><Textarea id="skill-instructions" value={instructions} onChange={(event) => setInstructions(event.target.value)} required maxLength={4000} rows={3} placeholder="Explique le comportement à suivre…" /></div>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        {editing && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={resetForm}>Annuler</Button>}
        <Button type="submit" size="sm" disabled={busy}>{busy ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> : <Plus aria-hidden="true" className="size-3.5" />}{editing ? 'Enregistrer' : 'Créer et affecter'}</Button>
      </div>
    </form>
  </section>
}
