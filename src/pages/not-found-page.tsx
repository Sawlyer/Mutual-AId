import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

export function NotFoundPage() {
  return <Card className="mx-auto max-w-lg"><CardContent className="py-14 text-center"><p className="font-heading text-sm font-semibold uppercase tracking-widest text-primary">404</p><h2 className="mt-3 font-heading text-xl font-semibold">Cette page n’existe pas</h2><p className="mt-2 text-sm text-muted-foreground">Vérifiez l’adresse ou revenez au tableau de bord.</p><Button nativeButton={false} render={<Link to="/" />} className="mt-6">Retour au dashboard</Button></CardContent></Card>
}
