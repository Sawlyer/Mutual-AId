import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { Check, Moon, Sun, Trash2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAppStore } from '@/stores/use-app-store'
import { useAuthStore } from '@/stores/use-auth-store'

export function SettingsPage() {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [deletionError, setDeletionError] = useState<string | null>(null)
  const theme = useAppStore((state) => state.theme)
  const setTheme = useAppStore((state) => state.setTheme)
  const user = useAuthStore((state) => state.user)
  const busy = useAuthStore((state) => state.busy)
  const deleteAccount = useAuthStore((state) => state.deleteAccount)

  async function handleDeleteAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setDeletionError(null)
    try {
      await deleteAccount(password)
      navigate('/login', { replace: true })
    } catch (error) {
      setDeletionError(error instanceof Error ? error.message : 'La suppression du compte a échoué.')
    }
  }

  return <div className="max-w-3xl space-y-6">
    <div><p className="text-sm text-muted-foreground">Préférences du compte</p><h2 className="mt-1 font-heading text-2xl font-semibold tracking-tight">Paramètres</h2><p className="mt-1 text-sm text-muted-foreground">Gérez votre identité et l’apparence de votre espace.</p></div>
    <Card><CardHeader><CardTitle>Apparence</CardTitle><p className="text-xs text-muted-foreground">Choisissez le thème de l’application. Il est mémorisé sur cet appareil.</p></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2">{([{ id: 'light', label: 'Clair', icon: Sun }, { id: 'dark', label: 'Sombre', icon: Moon }] as const).map(({ id, label, icon: Icon }) => <button key={id} type="button" aria-pressed={theme === id} onClick={() => setTheme(id)} className={`flex items-center gap-3 rounded-xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${theme === id ? 'border-primary/50 bg-primary/5' : 'border-border hover:bg-muted/60'}`}><span className="grid size-9 place-items-center rounded-lg bg-muted"><Icon aria-hidden="true" className="size-4" /></span><span className="flex-1"><span className="block text-sm font-medium">Thème {label.toLocaleLowerCase('fr')}</span><span className="mt-0.5 block text-xs text-muted-foreground">{id === 'light' ? 'Fond clair et contrastes doux' : 'Palette sombre pour environnement réduit'}</span></span>{theme === id && <Check aria-label="Sélectionné" className="size-4 text-primary" />}</button>)}</CardContent></Card>
    <Card><CardHeader><CardTitle>Compte</CardTitle></CardHeader><CardContent className="space-y-3 text-sm"><div className="flex justify-between gap-4 border-b border-border/70 pb-3"><span className="text-muted-foreground">Nom</span><span className="font-medium">{user?.name ?? '—'}</span></div><div className="flex justify-between gap-4 border-b border-border/70 pb-3"><span className="text-muted-foreground">E-mail</span><span className="font-medium">{user?.email ?? '—'}</span></div><div className="flex justify-between gap-4"><span className="text-muted-foreground">Thème</span><span className="font-medium">Enregistré sur cet appareil</span></div></CardContent></Card>
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="text-destructive">Supprimer le compte</CardTitle>
        <p className="text-xs leading-relaxed text-muted-foreground">Cette action supprime définitivement vos conversations, exécutions, agents, compétences et connecteurs enregistrés. Les exécutions actives doivent d’abord être terminées.</p>
      </CardHeader>
      <CardContent>
        <form className="space-y-3" onSubmit={handleDeleteAccount}>
          <label className="block space-y-1.5 text-sm font-medium" htmlFor="delete-account-password">
            <span>Confirmez avec votre mot de passe</span>
            <input id="delete-account-password" autoComplete="current-password" type="password" required minLength={1} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          </label>
          {deletionError && <p role="alert" className="text-sm text-destructive">{deletionError}</p>}
          <button type="submit" disabled={busy || !password} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50">
            <Trash2 aria-hidden="true" className="size-4" />
            {busy ? 'Suppression…' : 'Supprimer définitivement mon compte'}
          </button>
        </form>
      </CardContent>
    </Card>
    <p className="text-xs text-muted-foreground">La clé du modèle est configurée côté backend et n’est jamais exposée dans cette page.</p>
  </div>
}
