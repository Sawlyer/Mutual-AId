import { create } from 'zustand'
import type { Conversation, Message } from '@/types/domain'

interface OpenAIChatState {
  conversations: Conversation[]
  messages: Message[]
  loading: boolean
  loadError: string | null
  loadingMessageIds: string[]
  loadedMessageConversationIds: string[]
  connectorIdsByConversation: Record<string, string[]>
  setConversations: (conversations: Conversation[]) => void
  setMessages: (conversationId: string, messages: Message[]) => void
  setMessageLoading: (conversationId: string, loading: boolean) => void
  upsertConversation: (conversation: Conversation) => void
  upsertMessage: (message: Message) => void
  removeMessage: (messageId: string) => void
  removeConversation: (conversationId: string) => void
  renameConversation: (conversationId: string, title: string) => void
  setLoading: (loading: boolean) => void
  setLoadError: (error: string | null) => void
  setConnectorIds: (conversationId: string, connectorIds: string[]) => void
  clearAccountData: () => void
}

export const useOpenAIChatStore = create<OpenAIChatState>((set) => ({
  conversations: [], messages: [], loading: true, loadError: null, loadingMessageIds: [], loadedMessageConversationIds: [], connectorIdsByConversation: {},
  setConversations: (conversations) => set({ conversations, loading: false, loadError: null }),
  clearAccountData: () => set({ conversations: [], messages: [], loadedMessageConversationIds: [], loadingMessageIds: [], connectorIdsByConversation: {}, loadError: null }),
  setMessages: (conversationId, messages) => set((state) => ({ messages: [...state.messages.filter((message) => message.conversationId !== conversationId), ...messages], loadingMessageIds: state.loadingMessageIds.filter((id) => id !== conversationId), loadedMessageConversationIds: [...new Set([...state.loadedMessageConversationIds, conversationId])] })),
  setMessageLoading: (conversationId, loading) => set((state) => ({ loadingMessageIds: loading ? [...new Set([...state.loadingMessageIds, conversationId])] : state.loadingMessageIds.filter((id) => id !== conversationId) })),
  upsertConversation: (conversation) => set((state) => ({ conversations: [conversation, ...state.conversations.filter((item) => item.id !== conversation.id)] })),
  upsertMessage: (message) => set((state) => ({ messages: [...state.messages.filter((item) => item.id !== message.id), message] })),
  removeMessage: (messageId) => set((state) => ({ messages: state.messages.filter((message) => message.id !== messageId) })),
  removeConversation: (conversationId) => set((state) => {
    const connectorIdsByConversation = { ...state.connectorIdsByConversation }
    delete connectorIdsByConversation[conversationId]
    return { conversations: state.conversations.filter((item) => item.id !== conversationId), messages: state.messages.filter((item) => item.conversationId !== conversationId), connectorIdsByConversation }
  }),
  renameConversation: (conversationId, title) => set((state) => ({ conversations: state.conversations.map((item) => item.id === conversationId ? { ...item, title, updatedAt: new Date().toISOString() } : item) })),
  setLoading: (loading) => set({ loading }),
  setLoadError: (loadError) => set({ loadError, loading: false }),
  setConnectorIds: (conversationId, connectorIds) => set((state) => ({ connectorIdsByConversation: { ...state.connectorIdsByConversation, [conversationId]: [...connectorIds] } })),
}))
