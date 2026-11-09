import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatServiceError, chatAdapter } from '@/services/chat-adapters'

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

  it('activates a suggested server on the current conversation', async () => {
    const activation = { server: { id: 'server-id', enabled: true, approved_tool_names: ['snapshot'] }, connector_ids: ['mcp:server-id'] }
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(activation), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(chatAdapter.activateConversationMcp('conversation-id', 'solana', 'user-token')).resolves.toEqual(activation)
    expect(fetchMock).toHaveBeenCalledWith('/api/conversations/conversation-id/mcp', expect.objectContaining({
      method: 'POST', credentials: 'include', body: JSON.stringify({ catalog_id: 'solana', auth_token: 'user-token' }),
    }))
  })

  it('searches the local catalog and toggles a server without sending a prompt off-box', async () => {
    const page = { items: [{ id: 'docs', name: 'Docs', description: '', category: 'Recherche', source_url: 'https://mcpservers.org/fr/servers/docs', badges: [] }], page: 1, page_size: 24, total: 1, categories: ['Recherche'] }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(page), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'server-id', enabled: false }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    await chatAdapter.searchMcpCatalog('docs', 'Recherche', 1)
    await chatAdapter.setMcpServerEnabled('server-id', false)

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/connectors/mcp/catalog?q=docs&category=Recherche&page=1', expect.objectContaining({ credentials: 'include' }))
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/connectors/mcp/server-id', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ enabled: false }) }))
  })

  it('refreshes the catalog through the authenticated API', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ added: 0, directory_available: true, message: 'Aucune nouvelle fiche.' }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    await chatAdapter.refreshMcpCatalog()

    expect(fetchMock).toHaveBeenCalledWith('/api/connectors/mcp/catalog/refresh', expect.objectContaining({ method: 'POST', credentials: 'include' }))
  })

  it('keeps a publisher connection link and asks for a token without keeping a credential in the URL', async () => {
    const signIn = 'Ce serveur MCP demande une connexion au compte de l’éditeur.'
    const token = 'Ce serveur MCP demande un jeton utilisateur.'
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: { message: signIn, connect_url: 'https://docs.example/mcp-server' } }), { status: 422, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: { message: token, needs_token: true } }), { status: 422, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: { message: signIn, connect_url: 'https://user:secret@docs.example/mcp' } }), { status: 422, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(chatAdapter.activateConversationMcp('conversation-id', 'archive')).rejects.toMatchObject({ message: signIn, connectUrl: 'https://docs.example/mcp-server' })
    await expect(chatAdapter.activateConversationMcp('conversation-id', 'archive')).rejects.toMatchObject({ message: token, needsToken: true })
    try {
      await chatAdapter.activateConversationMcp('conversation-id', 'archive')
      throw new Error('Le refus devait être signalé.')
    } catch (error) {
      expect(error).toBeInstanceOf(ChatServiceError)
      expect((error as ChatServiceError).connectUrl).toBeUndefined()
    }
  })
})
