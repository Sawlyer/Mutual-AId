import {
  Activity,
  Bot,
  ChartNoAxesCombined,
  LayoutDashboard,
  type LucideIcon,
  Settings2,
  Workflow,
} from 'lucide-react'

export interface NavigationItem {
  to: string
  label: string
  icon: LucideIcon
  end?: boolean
}

export const navigationItems: NavigationItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/missions', label: 'Missions', icon: Workflow },
  { to: '/agents', label: 'Agents', icon: Bot },
  { to: '/analytics', label: 'Analytics', icon: ChartNoAxesCombined },
  { to: '/settings', label: 'Paramètres', icon: Settings2 },
]

export const pageMeta: Record<string, { title: string; description: string }> = {
  '/': {
    title: 'Dashboard',
    description: 'Vue d’ensemble de votre espace de travail.',
  },
  '/missions': {
    title: 'Missions',
    description: 'Pilotez vos workflows et suivez leur progression.',
  },
  '/agents': {
    title: 'Agents',
    description: 'Retrouvez vos agents et leur état opérationnel.',
  },
  '/analytics': {
    title: 'Analytics',
    description: 'Comprenez l’activité de votre orchestration.',
  },
  '/settings': {
    title: 'Paramètres',
    description: 'Personnalisez votre espace Mutual-AId.',
  },
}

export const activityFeedIcon = Activity
