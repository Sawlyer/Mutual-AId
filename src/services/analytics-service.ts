export interface AnalyticsSummary {
  conversations: number
  executions: number
  active_executions: number
  tasks: number
  completed_tasks: number
  task_completion_percent: number
  execution_statuses: Record<string, number>
  task_statuses: Record<string, number>
}

const baseUrl = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '')

export const analyticsService = {
  async get(): Promise<AnalyticsSummary> {
    const response = await fetch(`${baseUrl}/analytics`, { credentials: 'include' })
    if (!response.ok) {
      if (response.status === 401) throw new Error('Connectez-vous pour consulter vos statistiques.')
      throw new Error('Les statistiques n’ont pas pu être chargées.')
    }
    return await response.json() as AnalyticsSummary
  },
}
