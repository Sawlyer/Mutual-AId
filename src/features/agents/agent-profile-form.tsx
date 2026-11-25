import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { agentDomainFromName } from '@/features/agents/agent-profile-utils'
import type { AgentProfile, AgentProfileInput } from '@/types/agent'

interface Props {
  profile?: AgentProfile
  saving: boolean
  onSave: (input: AgentProfileInput) => Promise<void>
  onCancel: () => void
}

export function AgentProfileForm({ profile, saving, onSave, onCancel }: Props) {
  const [error, setError] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const input: AgentProfileInput = {
      name: String(data.get('name') || '').trim(),
      domain: profile?.domain ?? agentDomainFromName(String(data.get('name') || '')),
      description: String(data.get('description') || '').trim(),
      instructions: String(data.get('instructions') || '').trim(),
      capability_ids: profile?.capability_ids ?? [],
      enabled: profile?.enabled ?? true,
    }
    if (!input.name || !input.description || !input.instructions) {
      setError('Complétez tous les champs obligatoires.')
      return
    }
    try { setError(''); await onSave(input) } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Impossible d’enregistrer ce profil.')
    }
  }

  return <form className="space-y-4" onSubmit={(event) => void submit(event)}>
    <div className="space-y-2"><Label htmlFor="agent-name">Nom</Label><Input id="agent-name" name="name" required maxLength={80} defaultValue={profile?.name} /></div>
    <div className="space-y-2"><Label htmlFor="agent-description">Rôle et description</Label><Input id="agent-description" name="description" required maxLength={500} defaultValue={profile?.description} placeholder="Décris ce que cet agent sait prendre en charge" /></div>
    <div className="space-y-2"><Label htmlFor="agent-instructions">Instructions de l’agent</Label><Textarea id="agent-instructions" name="instructions" required maxLength={4000} rows={5} defaultValue={profile?.instructions} /></div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onCancel}>Annuler</Button><Button type="submit" disabled={saving}>{saving ? 'Enregistrement…' : profile ? 'Enregistrer' : 'Créer l’agent'}</Button></div>
  </form>
}
