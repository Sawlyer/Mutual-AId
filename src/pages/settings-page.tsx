import { Check, Moon, Sun } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAppStore } from '@/stores/use-app-store'

export function SettingsPage() {
  const theme = useAppStore((state) => state.theme)
  const setTheme = useAppStore((state) => state.setTheme)
  return <div className="max-w-3xl space-y-6">
    <div><p className="text-sm text-muted-foreground">Préférences</p><h2 className="mt-1 font-heading text-2xl font-semibold tracking-tight">Paramètres</h2><p className="mt-1 text-sm text-muted-foreground">Ajustez l’apparence de votre espace de travail.</p></div>
    <Card><CardHeader><CardTitle>Apparence</CardTitle><p className="text-xs text-muted-foreground">Choisissez le thème de l’application. Il est mémorisé sur cet appareil.</p></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2">{([{ id: 'light', label: 'Clair', icon: Sun }, { id: 'dark', label: 'Sombre', icon: Moon }] as const).map(({ id, label, icon: Icon }) => <button key={id} type="button" aria-pressed={theme === id} onClick={() => setTheme(id)} className={`flex items-center gap-3 rounded-xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${theme === id ? 'border-primary/50 bg-primary/5' : 'border-border hover:bg-muted/60'}`}><span className="grid size-9 place-items-center rounded-lg bg-muted"><Icon aria-hidden="true" className="size-4" /></span><span className="flex-1"><span className="block text-sm font-medium">Thème {label.toLocaleLowerCase('fr')}</span><span className="mt-0.5 block text-xs text-muted-foreground">{id === 'light' ? 'Fond clair et contrastes doux' : 'Palette sombre pour environnement réduit'}</span></span>{theme === id && <Check aria-label="Sélectionné" className="size-4 text-primary" />}</button>)}</CardContent></Card>
    <Card><CardHeader><CardTitle>Espace de travail</CardTitle></CardHeader><CardContent className="space-y-3 text-sm"><div className="flex justify-between gap-4 border-b border-border/70 pb-3"><span className="text-muted-foreground">Nom</span><span className="font-medium">Mutual-AId · Démo</span></div><div className="flex justify-between gap-4"><span className="text-muted-foreground">Stockage des préférences</span><span className="font-medium">Navigateur</span></div></CardContent></Card>
    <p className="text-xs text-muted-foreground">Les réglages du compte, des notifications et des clés de modèle seront disponibles après connexion au backend.</p>
  </div>
}
