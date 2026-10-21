import { LoaderCircle } from 'lucide-react'

export function RouteFallback() {
  return <main className="grid min-h-svh place-items-center bg-background text-sm text-muted-foreground" role="status"><span className="inline-flex items-center gap-2"><LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />Chargement de votre espace…</span></main>
}
