import {
  Bot,
  ChartNoAxesCombined,
  Cable,
  MessageSquareText,
  MessagesSquare,
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
  { to: '/', label: 'Chat', icon: MessageSquareText, end: true },
  { to: '/conversations', label: 'Conversations', icon: MessagesSquare },
  { to: '/connectors', label: 'Connecteurs', icon: Cable },
  { to: '/agents', label: 'Agents', icon: Bot },
  { to: '/executions', label: 'Exécutions', icon: Workflow },
  { to: '/analytics', label: 'Analytics', icon: ChartNoAxesCombined },
  { to: '/settings', label: 'Paramètres', icon: Settings2 },
]

export const pageMeta: Record<string, { title: string; description: string }> = {
  '/': {
    title: 'Chat',
    description: 'Discutez avec Mutual-AId et orchestrez vos demandes.',
  },
  '/conversations': { title: 'Conversations', description: 'Retrouvez vos échanges et orchestrations.' },
  '/connectors': { title: 'Connecteurs', description: 'Gérez les services externes disponibles.' },
  '/executions': { title: 'Exécutions', description: 'Suivez les orchestrations démarrées depuis le chat.' },
  '/agents': {
    title: 'Agents',
    description: 'Retrouvez vos agents et leur état opérationnel.',
  },
  '/analytics': {
    title: 'Analytics',
    description: 'Consultez les statistiques de conversations et d’exécutions de votre compte.',
  },
  '/settings': {
    title: 'Paramètres',
    description: 'Personnalisez votre espace Mutual-AId.',
  },
}
