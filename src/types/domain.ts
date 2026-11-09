export interface Conversation {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messageCount?: number
  connectorIds?: string[]
}

export interface McpActivity {
  id: string
  server: string
  tool: string
  status: 'running' | 'done' | 'failed'
}

export interface Message {
  id: string
  conversationId: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  status?: 'streaming' | 'complete' | 'failed'
  simulated?: boolean
  executionId?: string
  mcpActivity?: McpActivity[]
}
