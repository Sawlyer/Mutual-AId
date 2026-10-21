import { useEffect } from 'react'
import { Outlet, useLocation } from 'react-router'
import { motion, useReducedMotion } from 'motion/react'
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog'
import { AppHeader } from '@/components/layout/app-header'
import { Sidebar } from '@/components/layout/sidebar'
import { useAppStore } from '@/stores/use-app-store'

export function AppLayout() {
  const location = useLocation()
  const reduceMotion = useReducedMotion()
  const theme = useAppStore((state) => state.theme)
  const mobileNavOpen = useAppStore((state) => state.mobileNavOpen)
  const setMobileNavOpen = useAppStore((state) => state.setMobileNavOpen)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    document.documentElement.style.colorScheme = theme
  }, [theme])

  return (
    <div className="min-h-svh bg-background">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[252px] border-r border-sidebar-border bg-sidebar md:flex">
        <Sidebar />
      </aside>

      <Dialog open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <DialogContent
          showCloseButton={false}
          className="fixed inset-y-0 left-0 top-0 h-svh w-[min(84vw,300px)] max-w-none translate-x-0 translate-y-0 rounded-none border-r border-border p-0 sm:max-w-none"
        >
          <DialogTitle className="sr-only">Navigation principale</DialogTitle>
          <Sidebar onNavigate={() => setMobileNavOpen(false)} />
        </DialogContent>
      </Dialog>

      <div className="min-h-svh md:pl-[252px]">
        <AppHeader onOpenNavigation={() => setMobileNavOpen(true)} />
        <main id="main-content" className="mx-auto w-full max-w-[1500px] px-5 py-6 sm:px-8 sm:py-8">
          <motion.div
            key={location.pathname}
            initial={reduceMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.18, ease: 'easeOut' }}
          >
            <Outlet />
          </motion.div>
        </main>
      </div>
    </div>
  )
}
