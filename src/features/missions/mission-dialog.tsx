import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useMissionsStore } from '@/stores/use-missions-store'

export function MissionDialog() {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [objective, setObjective] = useState('')
  const [saving, setSaving] = useState(false)
  const createMission = useMissionsStore((state) => state.createMission)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    await createMission({ name: name.trim(), objective: objective.trim() })
    setName(''); setObjective(''); setSaving(false); setOpen(false)
  }

  return <Dialog open={open} onOpenChange={setOpen}>
    <Button onClick={() => setOpen(true)}><Plus aria-hidden="true" />Nouvelle mission</Button>
    <DialogContent>
      <form onSubmit={submit} className="space-y-5">
        <DialogHeader><DialogTitle>Créer une mission</DialogTitle><DialogDescription>Décrivez le résultat attendu. Votre mission sera ajoutée à la démo.</DialogDescription></DialogHeader>
        <div className="space-y-2"><Label htmlFor="mission-name">Nom de la mission</Label><Input id="mission-name" required maxLength={80} autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex. Étude de marché" /></div>
        <div className="space-y-2"><Label htmlFor="mission-objective">Objectif</Label><Textarea id="mission-objective" required maxLength={500} value={objective} onChange={(event) => setObjective(event.target.value)} placeholder="Quel résultat souhaitez-vous obtenir ?" /></div>
        <DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(false)}>Annuler</Button><Button type="submit" disabled={saving || !name.trim() || !objective.trim()}>{saving ? 'Création…' : 'Créer la mission'}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
}
