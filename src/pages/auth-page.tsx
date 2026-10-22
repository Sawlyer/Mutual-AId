import { useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router'
import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuthStore } from '@/stores/use-auth-store'

export function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const isRegister = mode === 'register'
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const user = useAuthStore((state) => state.user)
  const busy = useAuthStore((state) => state.busy)
  const error = useAuthStore((state) => state.error)
  const login = useAuthStore((state) => state.login)
  const register = useAuthStore((state) => state.register)
  const location = useLocation()
  const navigate = useNavigate()
  if (user) return <Navigate to="/" replace />
  const destination = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname || '/'

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    try {
      if (isRegister) await register(name, email, password)
      else await login(email, password)
      navigate(destination, { replace: true })
    } catch { /* Error is shown by the form. */ }
  }

  return <main className="grid min-h-svh place-items-center bg-background px-5 py-10">
    <section className="w-full max-w-[420px] rounded-2xl border border-border bg-card p-7 shadow-xl shadow-black/5 sm:p-9">
      <div className="mb-8 flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground"><Sparkles className="size-5" /></span><span className="font-heading text-lg font-semibold">Mutual-AId</span></div>
      <p className="text-sm text-muted-foreground">Votre espace d’orchestration IA</p>
      <h1 className="mt-1 font-heading text-2xl font-semibold tracking-tight">{isRegister ? 'Créer votre compte' : 'Bon retour'}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{isRegister ? 'Inscrivez-vous pour retrouver vos conversations et vos exécutions.' : 'Connectez-vous pour retrouver vos conversations.'}</p>
      <form className="mt-7 space-y-4" onSubmit={(event) => void submit(event)}>
        {isRegister && <label className="block space-y-1.5 text-sm font-medium">Nom<Input autoComplete="name" required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} /></label>}
        <label className="block space-y-1.5 text-sm font-medium">Adresse e-mail<Input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label className="block space-y-1.5 text-sm font-medium">Mot de passe<Input type="password" autoComplete={isRegister ? 'new-password' : 'current-password'} required minLength={isRegister ? 12 : 1} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} />{isRegister && <span className="block text-xs font-normal text-muted-foreground">12 caractères minimum.</span>}</label>
        {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}
        <Button className="w-full" type="submit" disabled={busy}>{busy ? 'Patientez…' : isRegister ? 'Créer mon compte' : 'Se connecter'}</Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted-foreground">{isRegister ? 'Vous avez déjà un compte ? ' : 'Pas encore de compte ? '}<Link className="font-medium text-primary hover:underline" to={isRegister ? '/login' : '/register'}>{isRegister ? 'Se connecter' : 'Créer un compte'}</Link></p>
    </section>
  </main>
}
