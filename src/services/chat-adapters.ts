import { useConversationsStore } from '@/stores/use-conversations-store'
import type { Conversation, Message } from '@/types/domain'
import type { Execution } from '@/types/execution'

export interface BackendConversation {
  id: string
  title: string
  created_at: string
  updated_at: string
  message_count: number
}

export interface BackendMessage {
  id: string
  conversation_id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
  execution_id?: string | null
}

export type OrchestrationEvent =
  | { type: 'delta'; delta: string }
  | { type: 'execution.created'; execution: Execution }
  | { type: 'done'; message: BackendMessage }
  | { type: 'error'; message: string }

export function parseOrchestrationEvent(frame: string): OrchestrationEvent | null {
  let event = 'message'
  const data: string[] = []
  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
  }
  if (!data.length) return null
  let payload: Record<string, unknown>
  try { payload = JSON.parse(data.join('\n')) as Record<string, unknown> }
  catch { return null }
  if (event === 'delta' && typeof payload.delta === 'string') return { type: 'delta', delta: payload.delta }
  if (event === 'execution.created' && typeof payload.id === 'string' && Array.isArray(payload.tasks)) return { type: 'execution.created', execution: payload as unknown as Execution }
  if (event === 'done' && payload.message && typeof payload.message === 'object') return { type: 'done', message: payload.message as BackendMessage }
  if (event === 'error' && typeof payload.message === 'string') return { type: 'error', message: payload.message }
  return null
}

export interface ChatBackendHealth {
  status: 'ok'
  openai_configured: boolean
  model_configured: boolean
}

export type ConnectorStatus = 'connected' | 'disconnected' | 'error'
export type ConnectorAvailability = 'available' | 'setup_required' | 'coming_soon'
export type ConnectorAccess = 'read' | 'write'

export interface ConnectorPermission {
  id: string
  label: string
  description: string
  access: ConnectorAccess
  oauth_scope?: string | null
}

export interface ConnectorTool {
  name: string
  description: string
  access: ConnectorAccess
  required_scopes: string[]
  requires_human_approval: boolean
}

export interface ConnectorCatalogItem {
  id: string
  name: string
  description: string
  icon: string
  capabilities: string[]
  available_tools: ConnectorTool[]
  required_scopes: ConnectorPermission[]
  status: ConnectorStatus
  availability: ConnectorAvailability
}

export interface ConversationConnectorPreferences {
  conversation_id: string
  connector_ids: string[]
  connectors: ConnectorCatalogItem[]
}

export interface ChatAdapter {
  readonly mode: 'demo' | 'openai'
  listConversations(): Promise<Conversation[]>
  createConversation(): Promise<Conversation>
  renameConversation(conversationId: string, title: string): Promise<void>
  deleteConversation(conversationId: string): Promise<void>
  listMessages(conversationId: string): Promise<Message[]>
  listConnectors(): Promise<ConnectorCatalogItem[]>
  connectGoogleCalendar(): Promise<string>
  disconnectGoogleCalendar(): Promise<void>
  getConversationConnectors(conversationId: string): Promise<ConversationConnectorPreferences>
  setConversationConnectors(conversationId: string, connectorIds: string[]): Promise<ConversationConnectorPreferences>
  streamMessage(conversationId: string, content: string, signal: AbortSignal, connectorIds: string[], onDelta: (delta: string) => void, onExecution?: (execution: Execution) => void): Promise<Message>
  checkHealth(): Promise<ChatBackendHealth>
}

const demoConnectors: ConnectorCatalogItem[] = [
  { id: 'gmail', name: 'Gmail', icon: 'mail', description: 'Consulter et organiser les e-mails de votre compte.', capabilities: ['Rechercher des e-mails', 'Lire les messages', 'Préparer des réponses'], available_tools: [], status: 'disconnected', availability: 'coming_soon', required_scopes: [{ id: 'gmail.read', label: 'Lecture des e-mails', description: 'Rechercher et lire les messages.', access: 'read' }, { id: 'gmail.write', label: 'Écriture des e-mails', description: 'Envoyer ou modifier des messages après validation.', access: 'write' }] },
  { id: 'google_drive', name: 'Google Drive', icon: 'drive', description: 'Rechercher et consulter des fichiers Google Drive.', capabilities: ['Rechercher des fichiers', 'Lire des documents'], available_tools: [], status: 'disconnected', availability: 'coming_soon', required_scopes: [{ id: 'drive.read', label: 'Lecture des fichiers', description: 'Rechercher et lire les fichiers autorisés.', access: 'read' }] },
  { id: 'google_calendar', name: 'Google Calendar', icon: 'calendar', description: 'Consulter les événements et disponibilités de votre agenda.', capabilities: ['Consulter les événements', 'Vérifier les disponibilités'], available_tools: [], status: 'disconnected', availability: 'coming_soon', required_scopes: [{ id: 'calendar.read', label: 'Lecture de l’agenda', description: 'Consulter les événements.', access: 'read' }] },
  { id: 'github', name: 'GitHub', icon: 'github', description: 'Consulter des dépôts, issues et demandes de fusion.', capabilities: ['Lire des dépôts', 'Consulter les issues', 'Créer des pull requests'], available_tools: [], status: 'disconnected', availability: 'coming_soon', required_scopes: [{ id: 'github.read', label: 'Lecture des dépôts', description: 'Consulter les dépôts autorisés.', access: 'read' }, { id: 'github.write', label: 'Écriture GitHub', description: 'Créer des issues ou pull requests après validation.', access: 'write' }] },
  { id: 'custom_mcp', name: 'Custom MCP Server', icon: 'mcp', description: 'Relier un serveur MCP compatible et approuvé.', capabilities: ['Découvrir des outils MCP', 'Appeler les outils autorisés'], available_tools: [], status: 'disconnected', availability: 'coming_soon', required_scopes: [{ id: 'mcp.tools', label: 'Outils du serveur', description: 'Les outils disponibles dépendent du serveur MCP ajouté.', access: 'read' }] },
]

function asConversation(conversation: BackendConversation): Conversation {
  return {
    id: conversation.id, title: conversation.title, createdAt: conversation.created_at,
    updatedAt: conversation.updated_at, messageCount: conversation.message_count,
  }
}

function asMessage(message: BackendMessage): Message {
  return { id: message.id, conversationId: message.conversation_id, role: message.role, content: message.content, createdAt: message.created_at, status: 'complete', simulated: false, executionId: message.execution_id ?? undefined }
}

class ChatServiceError extends Error {
  constructor(message: string) { super(message); this.name = 'ChatServiceError' }
}

function responseError(status: number): ChatServiceError {
  const message = status === 401 ? 'Votre session a expiré. Reconnectez-vous.'
    : status === 404 ? 'Cette conversation est introuvable.'
      : status === 409 ? 'Les connecteurs de cette conversation ont changé. Rechargez la page.'
        : status === 413 ? 'Le message dépasse la taille autorisée.'
          : status === 429 ? 'Trop de messages envoyés. Réessayez dans une minute.'
            : status === 503 ? 'Le service IA n’est pas configuré sur le backend.'
              : 'La requête n’a pas abouti. Réessayez.'
  return new ChatServiceError(message)
}

class DemoAdapter implements ChatAdapter {
  readonly mode = 'demo' as const

  async listConversations() { return useConversationsStore.getState().conversations }
  async createConversation() {
    const id = useConversationsStore.getState().createConversation()
    return useConversationsStore.getState().conversations.find((item) => item.id === id)!
  }
  async renameConversation(conversationId: string, title: string) { useConversationsStore.getState().renameConversation(conversationId, title) }
  async deleteConversation(conversationId: string) { useConversationsStore.getState().deleteConversation(conversationId) }
  async listMessages(conversationId: string) { return useConversationsStore.getState().messages.filter((message) => message.conversationId === conversationId) }
  async listConnectors() { return demoConnectors }
  async connectGoogleCalendar(): Promise<string> { throw new ChatServiceError('Les connecteurs ne sont pas disponibles en mode démo.') }
  async disconnectGoogleCalendar(): Promise<void> { throw new ChatServiceError('Les connecteurs ne sont pas disponibles en mode démo.') }
  async getConversationConnectors(conversationId: string): Promise<ConversationConnectorPreferences> {
    const connectorIds = useConversationsStore.getState().conversations.find((item) => item.id === conversationId)?.connectorIds ?? []
    return { conversation_id: conversationId, connector_ids: connectorIds, connectors: demoConnectors.filter((item) => connectorIds.includes(item.id)) }
  }
  async setConversationConnectors(conversationId: string, connectorIds: string[]): Promise<ConversationConnectorPreferences> {
    useConversationsStore.getState().setConnectorIds(conversationId, connectorIds)
    return this.getConversationConnectors(conversationId)
  }
  async streamMessage(conversationId: string, content: string, signal: AbortSignal) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    await useConversationsStore.getState().sendMessage(conversationId, content)
    const response = useConversationsStore.getState().messages.filter((message) => message.conversationId === conversationId && message.role === 'assistant').at(-1)
    if (!response) throw new ChatServiceError('La réponse de démonstration n’a pas pu être générée.')
    return response
  }
  async checkHealth(): Promise<ChatBackendHealth> { return { status: 'ok', openai_configured: false, model_configured: false } }
}

class OpenAIAdapter implements ChatAdapter {
  readonly mode = 'openai' as const
  private readonly baseUrl = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '')

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    let response: Response
    try {
      response = await fetch(`${this.baseUrl}${path}`, { ...init, credentials: 'include' })
    } catch {
      throw new ChatServiceError('Impossible de joindre le backend. Vérifiez qu’il est démarré puis réessayez.')
    }
    if (!response.ok) throw responseError(response.status)
    if (response.status === 204) return undefined as T
    return await response.json() as T
  }

  async listConversations() {
    const conversations = await this.request<BackendConversation[]>('/conversations')
    return conversations.map(asConversation)
  }

  async createConversation() {
    const conversation = await this.request<BackendConversation>('/conversations', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
    })
    return asConversation(conversation)
  }

  async renameConversation(conversationId: string, title: string) {
    await this.request<BackendConversation>(`/conversations/${encodeURIComponent(conversationId)}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }),
    })
  }

  async deleteConversation(conversationId: string) {
    await this.request<void>(`/conversations/${encodeURIComponent(conversationId)}`, { method: 'DELETE' })
  }

  async listMessages(conversationId: string) {
    const messages = await this.request<BackendMessage[]>(`/conversations/${encodeURIComponent(conversationId)}/messages`)
    return messages.map(asMessage)
  }

  async listConnectors() {
    return this.request<ConnectorCatalogItem[]>('/connectors')
  }

  async connectGoogleCalendar() {
    const result = await this.request<{ authorization_url: string }>('/connectors/google_calendar/connect', { method: 'POST' })
    return result.authorization_url
  }

  async disconnectGoogleCalendar() {
    await this.request<void>('/connectors/google_calendar/disconnect', { method: 'POST' })
  }

  async getConversationConnectors(conversationId: string) {
    return this.request<ConversationConnectorPreferences>(`/conversations/${encodeURIComponent(conversationId)}/connectors`)
  }

  async setConversationConnectors(conversationId: string, connectorIds: string[]) {
    return this.request<ConversationConnectorPreferences>(`/conversations/${encodeURIComponent(conversationId)}/connectors`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ connector_ids: connectorIds }),
    })
  }

  async checkHealth() {
    return this.request<ChatBackendHealth>('/health')
  }

  async streamMessage(conversationId: string, content: string, signal: AbortSignal, connectorIds: string[], onDelta: (delta: string) => void, onExecution?: (execution: Execution) => void) {
    let response: Response
    try {
      response = await fetch(`${this.baseUrl}/conversations/${encodeURIComponent(conversationId)}/messages/stream`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' }, credentials: 'include',
        body: JSON.stringify({ content, connector_ids: connectorIds }), signal,
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error
      throw new ChatServiceError('Impossible de joindre le backend. Vérifiez qu’il est démarré puis réessayez.')
    }
    if (!response.ok) throw responseError(response.status)
    if (!response.body) throw new ChatServiceError('Le backend n’a pas fourni de flux de réponse.')
    if (!response.headers.get('content-type')?.includes('text/event-stream')) {
      throw new ChatServiceError('Le backend a renvoyé un format de réponse inattendu.')
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let finalMessage: Message | null = null
    const processFrame = (frame: string) => {
      const parsed = parseOrchestrationEvent(frame)
      if (!parsed) return
      if (parsed.type === 'delta') onDelta(parsed.delta)
      if (parsed.type === 'execution.created') onExecution?.(parsed.execution)
      if (parsed.type === 'done') finalMessage = asMessage(parsed.message)
      if (parsed.type === 'error') throw new ChatServiceError(parsed.message)
    }

    try {
      while (true) {
        const { value, done } = await reader.read()
        buffer = (buffer + decoder.decode(value, { stream: !done })).replace(/\r\n/g, '\n')
        let boundary = buffer.indexOf('\n\n')
        while (boundary >= 0) {
          processFrame(buffer.slice(0, boundary))
          buffer = buffer.slice(boundary + 2)
          boundary = buffer.indexOf('\n\n')
        }
        if (done) break
      }
      if (buffer.trim()) processFrame(buffer)
    } finally {
      reader.releaseLock()
    }
    if (!finalMessage) throw new ChatServiceError('Le flux s’est terminé sans réponse complète.')
    return finalMessage
  }
}

const adapterMode = import.meta.env.VITE_CHAT_ADAPTER?.toLowerCase()
export const chatAdapter: ChatAdapter = adapterMode === 'demo' ? new DemoAdapter() : new OpenAIAdapter()
