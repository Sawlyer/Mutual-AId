import { Menu } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getPageMeta } from '@/components/layout/navigation'
import { useLocation } from 'react-router'

interface AppHeaderProps {
  onOpenNavigation: () => void
}

export function AppHeader({ onOpenNavigation }: AppHeaderProps) {
  const { pathname } = useLocation()
  const page = getPageMeta(pathname)

  return (
    <header className="sticky top-0 z-20 border-b border-border/80 bg-background/90 px-5 py-4 backdrop-blur-xl sm:px-8">
      <div className="mx-auto flex max-w-[1440px] items-center gap-3">
        <Button
          type="button"
          variant="ghost"
          size="icon-lg"
          className="-ml-2 shrink-0 md:hidden"
          aria-label="Ouvrir la navigation"
          onClick={onOpenNavigation}
        >
          <Menu aria-hidden="true" />
        </Button>

        <div className="min-w-0 flex-1">
          <div className="mb-1.5 hidden items-center gap-2 text-[11px] text-muted-foreground sm:flex">
            <span>Mutual-AId</span>
            <span aria-hidden="true" className="text-border">/</span>
            <span>Espace de travail</span>
            <span aria-hidden="true" className="text-border">/</span>
            <span className="font-medium text-foreground/75">{page.title}</span>
          </div>
          <h1 className="truncate font-heading text-lg font-semibold tracking-tight sm:text-xl">
            {page.title}
          </h1>
          {page.description && <p className="mt-0.5 hidden text-xs text-muted-foreground sm:block">{page.description}</p>}
        </div>
      </div>
    </header>
  )
}
