import {
  Bot,
  ChartNoAxesCombined,
  Cable,
  MessageSquareText,
  type LucideIcon,
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
  { to: '/connectors', label: 'Connecteurs', icon: Cable, end: true },
  { to: '/agents', label: 'Agents', icon: Bot },
  { to: '/executions', label: 'Exécutions', icon: Workflow },
  { to: '/analytics', label: 'Analytics', icon: ChartNoAxesCombined },
]

export const pageMeta: Record<string, { title: string; description: string }> = {
  '/': {
    title: 'Chat',
    description: 'Discutez avec Mutual-AId et orchestrez vos demandes.',
  },
  '/connectors': { title: 'Connecteurs', description: 'Gérez les services externes disponibles.' },
  '/connectors/mcp': { title: 'Catalogue MCP', description: 'Recherchez et activez des serveurs MCP autorisés.' },
  '/executions': { title: 'Exécutions', description: 'Suivez les orchestrations démarrées depuis le chat.' },
  '/agents': {
    title: 'Agents',
    description: 'Retrouvez vos agents et leur état opérationnel.',
  },
  '/analytics': {
    title: 'Analytics',
    description: 'Consultez les statistiques de conversations et d’exécutions de cet espace.',
  },
}

export function getPageMeta(pathname: string): { title: string; description: string } {
  return pageMeta[pathname]
    ?? (pathname.startsWith('/agents/') ? { title: 'Fiche agent', description: 'Consultez et configurez un agent spécialisé.' } : undefined)
    ?? (pathname.startsWith('/conversations/') ? { title: 'Conversation', description: '' } : undefined)
    ?? (pathname.startsWith('/executions/') ? { title: 'Workflow', description: 'Inspectez les tâches et les dépendances de cette exécution.' } : undefined)
    ?? { title: 'Page introuvable', description: 'Cette page ne fait pas partie de votre espace.' }
}
