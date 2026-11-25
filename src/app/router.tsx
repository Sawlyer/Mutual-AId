import { createBrowserRouter, Navigate } from 'react-router'
import { AppLayout } from '@/components/layout/app-layout'
import { RouteFallback } from '@/components/layout/route-fallback'

export const router = createBrowserRouter([
  { path: '/login', element: <Navigate to="/" replace /> },
  { path: '/register', element: <Navigate to="/" replace /> },
  { path: '/settings', element: <Navigate to="/" replace /> },
  {
    Component: AppLayout,
    HydrateFallback: RouteFallback,
    children: [
      { index: true, lazy: () => import('@/features/chat/chat-page').then((module) => ({ Component: module.ChatPage })) },
      { path: 'chat', lazy: () => import('@/features/chat/chat-page').then((module) => ({ Component: module.ChatPage })) },
      { path: 'conversations', element: <Navigate to="/" replace /> },
      { path: 'conversations/:conversationId', lazy: () => import('@/features/chat/chat-page').then((module) => ({ Component: module.ChatPage })) },
      { path: 'executions/:executionId', lazy: () => import('@/pages/execution-page').then((module) => ({ Component: module.ExecutionPage })) },
      { path: 'executions', lazy: () => import('@/pages/executions-page').then((module) => ({ Component: module.ExecutionsPage })) },
      { path: 'connectors', lazy: () => import('@/pages/connectors-page').then((module) => ({ Component: module.ConnectorsPage })) },
      { path: 'connectors/mcp', lazy: () => import('@/pages/mcp-catalog-page').then((module) => ({ Component: module.McpCatalogPage })) },
      { path: 'dashboard', element: <Navigate to="/" replace /> },
      { path: 'missions/*', element: <Navigate to="/" replace /> },
      { path: 'agents', lazy: () => import('@/pages/agents-page').then((module) => ({ Component: module.AgentsPage })) },
      { path: 'agents/:profileId', lazy: () => import('@/pages/agent-detail-page').then((module) => ({ Component: module.AgentDetailPage })) },
      { path: 'analytics', lazy: () => import('@/pages/analytics-page').then((module) => ({ Component: module.AnalyticsPage })) },
      { path: '*', lazy: () => import('@/pages/not-found-page').then((module) => ({ Component: module.NotFoundPage })) },
    ],
  },
])
