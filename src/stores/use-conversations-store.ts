import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { Conversation, Message } from '@/types/domain'

interface ConversationsState {
  conversations: Conversation[]
  messages: Message[]
  createConversation: () => string
  renameConversation: (id: string, title: string) => void
  deleteConversation: (id: string) => void
  setConnectorIds: (id: string, connectorIds: string[]) => void
  sendMessage: (conversationId: string, content: string) => Promise<void>
}

const seededConversation: Conversation = {
  id: 'conversation-csv-demo',
  title: 'Bienvenue sur Mutual-AId',
  createdAt: '2026-10-21T08:45:00.000Z',
  updatedAt: '2026-10-21T08:45:00.000Z',
}
const seededMessages: Message[] = [
  { id: 'message-demo-welcome', conversationId: seededConversation.id, role: 'assistant', content: 'Bienvenue ! Cette conversation utilise le mode démo : les réponses ne sont pas générées par un modèle IA.', createdAt: seededConversation.createdAt, simulated: true },
]

function stripLegacyMetadata(value: object, fields: string[]) {
  const cleaned = { ...value } as Record<string, unknown>
  for (const field of fields) delete cleaned[field]
  return cleaned
}

export const useConversationsStore = create<ConversationsState>()(persist((set, get) => ({
  conversations: [seededConversation], messages: seededMessages,
  createConversation: () => {
    const now = new Date().toISOString()
    const conversation: Conversation = { id: `conversation-${Date.now()}`, title: 'Nouvelle conversation', createdAt: now, updatedAt: now }
    set((state) => ({ conversations: [conversation, ...state.conversations] }))
    return conversation.id
  },
  renameConversation: (id, title) => set((state) => ({ conversations: state.conversations.map((item) => item.id === id ? { ...item, title: title.trim() || item.title, updatedAt: new Date().toISOString() } : item) })),
  deleteConversation: (id) => set((state) => ({ conversations: state.conversations.filter((item) => item.id !== id), messages: state.messages.filter((item) => item.conversationId !== id) })),
  setConnectorIds: (id, connectorIds) => set((state) => ({ conversations: state.conversations.map((item) => item.id === id ? { ...item, connectorIds: [...connectorIds] } : item) })),
  sendMessage: async (conversationId, rawContent) => {
    const content = rawContent.trim()
    if (!content) return
    const now = new Date().toISOString()
    const userMessage: Message = { id: `message-${Date.now()}-user`, conversationId, role: 'user', content, createdAt: now }
    const priorConversation = get().conversations.find((item) => item.id === conversationId)
    set((state) => ({ messages: [...state.messages, userMessage], conversations: state.conversations.map((item) => item.id === conversationId ? { ...item, title: item.title === 'Nouvelle conversation' ? content.slice(0, 52) : item.title, updatedAt: now } : item) }))

    const assistantMessage: Message = { id: `message-${Date.now()}-assistant`, conversationId, role: 'assistant', content: `Mode démo : votre message « ${content} » n’a pas été envoyé à OpenAI.`, createdAt: new Date().toISOString(), simulated: true }
    set((state) => ({
      messages: [...state.messages, assistantMessage],
      conversations: state.conversations.map((item) => item.id === conversationId ? { ...item, updatedAt: assistantMessage.createdAt } : item),
    }))
    if (priorConversation?.title === 'Nouvelle conversation') set((state) => ({ conversations: state.conversations.map((item) => item.id === conversationId ? { ...item, title: content.slice(0, 52) } : item) }))
  },
}), {
  name: 'mutual-aid-conversations-v1',
  version: 2,
  storage: createJSONStorage(() => localStorage),
  partialize: (state) => ({ conversations: state.conversations, messages: state.messages }),
  migrate: (persistedState, version) => {
    if (version >= 2 || !persistedState || typeof persistedState !== 'object') return persistedState as ConversationsState
    const oldState = persistedState as {
      conversations?: Array<Conversation & { messageIds?: string[]; executionIds?: string[] }>
      messages?: Array<Message & { executionId?: string }>
    }
    return {
      ...oldState,
      conversations: oldState.conversations?.map((conversation) => stripLegacyMetadata(conversation, ['messageIds', 'executionIds']) as unknown as Conversation),
      messages: oldState.messages?.map((message) => stripLegacyMetadata(message, ['executionId']) as unknown as Message),
    } as ConversationsState
  },
}))
