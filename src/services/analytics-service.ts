export interface AnalyticsSummary {
  conversations: number
  executions: number
  active_executions: number
  tasks: number
  completed_tasks: number
  task_completion_percent: number
  execution_statuses: Record<string, number>
  task_statuses: Record<string, number>
  execution_activity: { date: string; count: number }[]
  token_usage: TokenUsageMetrics
  conversation_usage: ConversationTokenUsage[]
}

export interface TokenUsageMetrics {
  runs: number
  requests: number
  input_tokens: number
  output_tokens: number
  cached_input_tokens: number
  reasoning_tokens: number
  input_cost_usd: number | null
  cached_input_cost_usd: number | null
  output_cost_usd: number | null
  estimated_cost_usd: number | null
  unpriced_runs: number
}

export interface ConversationTokenUsage extends TokenUsageMetrics {
  conversation_id: string
  title: string
  updated_at: string
  message_count: number
  models: string[]
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
