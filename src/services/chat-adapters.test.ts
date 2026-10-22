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
