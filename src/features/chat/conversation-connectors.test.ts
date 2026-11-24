import { describe, expect, it } from 'vitest'
import type { ConnectorCatalogItem } from '@/services/chat-adapters'
import { connectedConnectorIds } from './conversation-connectors'

function connector(
  id: string,
  status: ConnectorCatalogItem['status'],
  availability: ConnectorCatalogItem['availability'],
): ConnectorCatalogItem {
  return {
    id,
    name: id,
    description: '',
    icon: 'plug',
    capabilities: [],
    available_tools: [],
    required_scopes: [],
    status,
    availability,
  }
}

describe('connectedConnectorIds', () => {
  it('selects only connected and available connectors in stable order', () => {
    const result = connectedConnectorIds([
      connector('github', 'connected', 'available'),
      connector('gmail', 'connected', 'setup_required'),
      connector('google_drive', 'disconnected', 'available'),
      connector('mcp:zeta', 'connected', 'available'),
      connector('google_calendar', 'error', 'available'),
      connector('mcp:alpha', 'connected', 'available'),
    ])

    expect(result).toEqual(['github', 'mcp:alpha', 'mcp:zeta'])
  })

  it('returns an empty selection when no usable connector exists', () => {
    expect(connectedConnectorIds([
      connector('github', 'error', 'available'),
      connector('gmail', 'connected', 'setup_required'),
    ])).toEqual([])
  })
})
