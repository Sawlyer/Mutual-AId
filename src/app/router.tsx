import { createBrowserRouter } from 'react-router'
import { AppLayout } from '@/components/layout/app-layout'

export const router = createBrowserRouter([
  {
    Component: AppLayout,
    children: [
      { index: true, lazy: () => import('@/pages/dashboard-page').then((module) => ({ Component: module.DashboardPage })) },
      { path: 'missions', lazy: () => import('@/pages/missions-page').then((module) => ({ Component: module.MissionsPage })) },
      { path: 'agents', lazy: () => import('@/pages/agents-page').then((module) => ({ Component: module.AgentsPage })) },
      { path: 'analytics', lazy: () => import('@/pages/analytics-page').then((module) => ({ Component: module.AnalyticsPage })) },
      { path: 'settings', lazy: () => import('@/pages/settings-page').then((module) => ({ Component: module.SettingsPage })) },
      { path: '*', lazy: () => import('@/pages/not-found-page').then((module) => ({ Component: module.NotFoundPage })) },
    ],
  },
])
