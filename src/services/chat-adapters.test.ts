import { afterEach, describe, expect, it, vi } from 'vitest'
import { chatAdapter } from '@/services/chat-adapters'

describe('OAuth connector adapter', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('starts the requested connector OAuth flow and returns its URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ authorization_url: 'https://accounts.example.test/auth' }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(chatAdapter.connectConnector('gmail')).resolves.toBe('https://accounts.example.test/auth')
    expect(fetchMock).toHaveBeenCalledWith('/api/connectors/gmail/connect', expect.objectContaining({ method: 'POST', credentials: 'include' }))
  })

  it('disconnects the requested connector through the authenticated API', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(chatAdapter.disconnectConnector('github')).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledWith('/api/connectors/github/disconnect', expect.objectContaining({ method: 'POST', credentials: 'include' }))
  })
})

describe('MCP server adapter', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('creates a server with a write-only credential and refreshes its tools', async () => {
    const server = { id: 'server-id', name: 'Docs', url: 'https://example.com/mcp', status: 'ready', tools: [], approved_tool_names: [] }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(server), { status: 201, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify(server), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    await chatAdapter.createMcpServer({ name: 'Docs', url: server.url, auth_token: 'write-only-token' })
    await chatAdapter.refreshMcpServer(server.id)

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/connectors/mcp', expect.objectContaining({
      method: 'POST', credentials: 'include', body: JSON.stringify({ name: 'Docs', url: server.url, auth_token: 'write-only-token' }),
    }))
    expect(fetchMock).toHaveBeenNthCalledWith(2, `/api/connectors/mcp/${server.id}/refresh`, expect.objectContaining({ method: 'POST' }))
  })

  it('persists tool approvals and removes a server through authenticated APIs', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'server-id' }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    await chatAdapter.setMcpServerTools('server-id', ['search_docs'])
    await chatAdapter.deleteMcpServer('server-id')

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/connectors/mcp/server-id/tools', expect.objectContaining({
      method: 'PUT', credentials: 'include', body: JSON.stringify({ tool_names: ['search_docs'] }),
    }))
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/connectors/mcp/server-id', expect.objectContaining({ method: 'DELETE' }))
  })
})
