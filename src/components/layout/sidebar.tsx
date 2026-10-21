import { NavLink } from 'react-router'
import { CircleHelp, Sparkles } from 'lucide-react'
import { navigationItems } from '@/components/layout/navigation'
import { cn } from '@/lib/utils'
import { useMissionsStore } from '@/stores/use-missions-store'

interface SidebarProps {
  onNavigate?: () => void
}

export function Sidebar({ onNavigate }: SidebarProps) {
  const missionCount = useMissionsStore((state) => state.missions.length)
  return (
    <div className="flex h-full flex-col bg-sidebar px-3 py-5 text-sidebar-foreground">
      <div className="flex items-center gap-3 px-2 pb-7">
        <div className="relative grid size-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm shadow-primary/20">
          <Sparkles aria-hidden="true" className="size-5" strokeWidth={1.8} />
          <span className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-sidebar bg-emerald-500" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-heading text-[15px] font-semibold tracking-tight">
            Mutual-AId
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">Espace de travail</p>
        </div>
      </div>

      <div className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        Espace de travail
      </div>
      <nav aria-label="Navigation principale" className="space-y-1">
        {navigationItems.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'group flex min-h-10 items-center gap-3 rounded-lg px-3 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                isActive && 'bg-sidebar-accent text-sidebar-accent-foreground shadow-sm',
              )
            }
          >
            <Icon aria-hidden="true" className="size-[17px] shrink-0 opacity-80 group-hover:opacity-100" strokeWidth={1.8} />
            <span>{label}</span>
            {label === 'Missions' && (
              <span className="ml-auto rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                {missionCount}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="mt-auto space-y-3">
        <div className="rounded-xl border border-sidebar-border bg-card/70 p-3.5 shadow-sm">
          <div className="flex items-center gap-2">
            <span className="relative flex size-2.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-30 motion-reduce:animate-none" />
              <span className="relative inline-flex size-2.5 rounded-full bg-emerald-500" />
            </span>
            <span className="text-xs font-semibold">Mode démo actif</span>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            Les données affichées sont simulées à des fins de démonstration.
          </p>
        </div>

        <a
          href="mailto:bonjour@mutual-aid.app"
          className="flex min-h-10 items-center gap-3 rounded-lg px-3 text-[13px] font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <CircleHelp aria-hidden="true" className="size-[17px]" strokeWidth={1.8} />
          Aide & documentation
        </a>

        <div className="flex items-center gap-3 border-t border-sidebar-border px-2 pt-4">
          <div className="grid size-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-xs font-semibold text-white shadow-sm">
            ML
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold">Maya Laurent</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">Administratrice</p>
          </div>
          <span className="rounded-md border border-border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
            Demo
          </span>
        </div>
      </div>
    </div>
  )
}
