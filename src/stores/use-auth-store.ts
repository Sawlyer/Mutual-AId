import { create } from 'zustand'
import { authService, type AuthUser } from '@/services/auth-service'

interface AuthState {
  user: AuthUser | null
  ready: boolean
  busy: boolean
  error: string | null
  restore: () => Promise<void>
  login: (email: string, password: string) => Promise<void>
  register: (name: string, email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  clearError: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null, ready: false, busy: false, error: null,
  restore: async () => {
    try { set({ user: await authService.me(), ready: true }) }
    catch { set({ user: null, ready: true }) }
  },
  login: async (email, password) => {
    set({ busy: true, error: null })
    try { set({ user: await authService.login(email, password), ready: true, busy: false }) }
    catch (error) { set({ error: error instanceof Error ? error.message : 'Connexion impossible.', busy: false }); throw error }
  },
  register: async (name, email, password) => {
    set({ busy: true, error: null })
    try { set({ user: await authService.register(name, email, password), ready: true, busy: false }) }
    catch (error) { set({ error: error instanceof Error ? error.message : 'Inscription impossible.', busy: false }); throw error }
  },
  logout: async () => {
    await authService.logout()
    set({ user: null })
  },
  clearError: () => set({ error: null }),
}))
