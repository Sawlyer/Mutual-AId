import { afterEach, describe, expect, it, vi } from 'vitest'
import { authService } from './auth-service'

describe('authService.deleteAccount', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('sends the password with a credentialed DELETE request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    await authService.deleteAccount('correct horse battery staple')

    expect(fetchMock).toHaveBeenCalledWith('/api/auth/account', {
      method: 'DELETE',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'correct horse battery staple' }),
    })
  })
})
