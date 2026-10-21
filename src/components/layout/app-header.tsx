import { Menu, Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { pageMeta } from '@/components/layout/navigation'
import { useAppStore } from '@/stores/use-app-store'
import { useLocation } from 'react-router'

interface AppHeaderProps {
  onOpenNavigation: () => void
}

export function AppHeader({ onOpenNavigation }: AppHeaderProps) {
  const { pathname } = useLocation()
  const page = pageMeta[pathname] ?? {
    title: 'Page introuvable',
    description: 'Cette page ne fait pas partie de votre espace.',
  }
  const theme = useAppStore((state) => state.theme)
  const toggleTheme = useAppStore((state) => state.toggleTheme)

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
          <p className="mt-0.5 hidden text-xs text-muted-foreground sm:block">
            {page.description}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <Badge variant="outline" className="hidden h-7 gap-1.5 border-emerald-500/20 bg-emerald-500/5 px-2.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300 sm:inline-flex">
            <span className="size-1.5 rounded-full bg-emerald-500" />
            Démo
          </Badge>
          <span className="hidden h-5 w-px bg-border sm:block" />
          <Button
            type="button"
            variant="outline"
            size="icon-lg"
            aria-label={theme === 'light' ? 'Activer le thème sombre' : 'Activer le thème clair'}
            title={theme === 'light' ? 'Thème sombre' : 'Thème clair'}
            onClick={toggleTheme}
          >
            {theme === 'light' ? <Moon aria-hidden="true" /> : <Sun aria-hidden="true" />}
          </Button>
        </div>
      </div>
    </header>
  )
}
