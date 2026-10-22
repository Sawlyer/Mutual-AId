import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { AgentCapability, AgentProfile, AgentProfileInput } from '@/types/agent'

interface Props {
  capabilities: AgentCapability[]
  profile?: AgentProfile
  saving: boolean
  onSave: (input: AgentProfileInput) => Promise<void>
  onCancel: () => void
}

export function AgentProfileForm({ capabilities, profile, saving, onSave, onCancel }: Props) {
  const [error, setError] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const input: AgentProfileInput = {
      name: String(data.get('name') || '').trim(),
      domain: String(data.get('domain') || '').trim(),
      description: String(data.get('description') || '').trim(),
      instructions: String(data.get('instructions') || '').trim(),
      capability_ids: data.getAll('capability').map(String),
      enabled: profile?.enabled ?? true,
    }
    if (!input.name || !input.description || !input.instructions || !input.domain) {
      setError('Complétez tous les champs obligatoires.')
      return
    }
    try { setError(''); await onSave(input) } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Impossible d’enregistrer ce profil.')
    }
  }

  return <form className="space-y-4" onSubmit={(event) => void submit(event)}>
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2"><Label htmlFor="agent-name">Nom</Label><Input id="agent-name" name="name" required maxLength={80} defaultValue={profile?.name} /></div>
      <div className="space-y-2"><Label htmlFor="agent-domain">Domaine</Label><Input id="agent-domain" name="domain" required maxLength={64} pattern="[a-z][-a-z0-9_]*" placeholder="planning" defaultValue={profile?.domain} /></div>
    </div>
    <div className="space-y-2"><Label htmlFor="agent-description">Description</Label><Input id="agent-description" name="description" required maxLength={500} defaultValue={profile?.description} /></div>
    <div className="space-y-2"><Label htmlFor="agent-instructions">Instructions de l’agent</Label><Textarea id="agent-instructions" name="instructions" required maxLength={4000} rows={5} defaultValue={profile?.instructions} /></div>
    <fieldset className="space-y-2"><legend className="text-sm font-medium">Compétences disponibles</legend><p className="text-xs text-muted-foreground">Les compétences ne donnent pas accès aux connecteurs ni aux autorisations.</p><div className="flex flex-wrap gap-3">{capabilities.map((capability) => <label key={capability.id} className="flex items-center gap-2 text-sm"><input type="checkbox" name="capability" value={capability.id} defaultChecked={profile?.capability_ids.includes(capability.id)} />{capability.label}</label>)}</div></fieldset>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onCancel}>Annuler</Button><Button type="submit" disabled={saving}>{saving ? 'Enregistrement…' : profile ? 'Enregistrer' : 'Créer l’agent'}</Button></div>
  </form>
}
