import type { ConnectorCatalogItem } from '@/services/chat-adapters'

export function connectedConnectorIds(catalog: ConnectorCatalogItem[]): string[] {
  return catalog
    .filter((connector) => connector.status === 'connected' && connector.availability === 'available')
    .map((connector) => connector.id)
    .sort((left, right) => left.localeCompare(right))
}
