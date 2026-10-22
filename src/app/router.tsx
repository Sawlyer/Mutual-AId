import { createBrowserRouter, Navigate } from 'react-router'
import { AppLayout } from '@/components/layout/app-layout'
import { RouteFallback } from '@/components/layout/route-fallback'
import { AuthPage } from '@/pages/auth-page'

export const router = createBrowserRouter([
  { path: '/login', element: <AuthPage mode="login" /> },
  { path: '/register', element: <AuthPage mode="register" /> },
  {
    Component: AppLayout,
    HydrateFallback: RouteFallback,
    children: [
      { index: true, lazy: () => import('@/features/chat/chat-page').then((module) => ({ Component: module.ChatPage })) },
      { path: 'chat', lazy: () => import('@/features/chat/chat-page').then((module) => ({ Component: module.ChatPage })) },
      { path: 'conversations', lazy: () => import('@/pages/conversations-page').then((module) => ({ Component: module.ConversationsPage })) },
      { path: 'conversations/:conversationId', lazy: () => import('@/features/chat/chat-page').then((module) => ({ Component: module.ChatPage })) },
      { path: 'executions/:executionId', lazy: () => import('@/pages/execution-page').then((module) => ({ Component: module.ExecutionPage })) },
      { path: 'executions', lazy: () => import('@/pages/executions-page').then((module) => ({ Component: module.ExecutionsPage })) },
      { path: 'connectors', lazy: () => import('@/pages/connectors-page').then((module) => ({ Component: module.ConnectorsPage })) },
      { path: 'dashboard', element: <Navigate to="/" replace /> },
      { path: 'missions/*', element: <Navigate to="/" replace /> },
      { path: 'agents', lazy: () => import('@/pages/agents-page').then((module) => ({ Component: module.AgentsPage })) },
      { path: 'analytics', lazy: () => import('@/pages/analytics-page').then((module) => ({ Component: module.AnalyticsPage })) },
      { path: 'settings', lazy: () => import('@/pages/settings-page').then((module) => ({ Component: module.SettingsPage })) },
      { path: '*', lazy: () => import('@/pages/not-found-page').then((module) => ({ Component: module.NotFoundPage })) },
    ],
  },
])
