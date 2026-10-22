export interface AuthUser {
  id: string
  email: string
  name: string
  created_at: string
}

const baseUrl = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '')

async function request(path: string, body?: Record<string, string>): Promise<AuthUser | null> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: path === '/auth/me' ? 'GET' : 'POST',
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (response.status === 401 && path === '/auth/me') return null
  if (!response.ok) {
    const data = await response.json().catch(() => ({})) as { detail?: string }
    throw new Error(data.detail || 'La requête a échoué. Réessayez.')
  }
  return response.status === 204 ? null : await response.json() as AuthUser
}

export const authService = {
  me: () => request('/auth/me'),
  login: (email: string, password: string) => request('/auth/login', { email, password }),
  register: (name: string, email: string, password: string) => request('/auth/register', { name, email, password }),
  logout: () => request('/auth/logout'),
}
