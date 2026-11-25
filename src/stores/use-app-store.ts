import { create } from 'zustand'

interface AppState {
  mobileNavOpen: boolean
  setMobileNavOpen: (open: boolean) => void
}

export const useAppStore = create<AppState>((set) => ({
  mobileNavOpen: false,
  setMobileNavOpen: (mobileNavOpen) => set({ mobileNavOpen }),
}))
