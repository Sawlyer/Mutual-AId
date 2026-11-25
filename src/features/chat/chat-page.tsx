import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUp, Check, Copy, Sparkles, StopCircle } from 'lucide-react'
import { useNavigate, useParams } from 'react-router'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Badge } from '@/components/reui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { Message, MessageAvatar, MessageContent } from '@/components/ui/message'
import { MessageScroller, MessageScrollerButton, MessageScrollerContent, MessageScrollerItem, MessageScrollerProvider, MessageScrollerViewport } from '@/components/ui/message-scroller'
import { ConnectorSelector } from '@/features/chat/connector-selector'
import { McpActivityList } from '@/features/chat/mcp-activity'
import { connectedConnectorIds } from '@/features/chat/conversation-connectors'
import { useConversationsStore } from '@/stores/use-conversations-store'
import { useOpenAIChatStore } from '@/stores/use-openai-chat-store'
import { ChatServiceError, chatAdapter, type ChatBackendHealth, type ConnectorCatalogItem, type McpSuggestion } from '@/services/chat-adapters'
import type { McpActivity, Message as ChatMessage } from '@/types/domain'
import { ExecutionCard } from '@/features/executions/execution-card'
import { trackExecutionCompletion } from '@/features/executions/execution-tracking'
import type { Execution } from '@/types/execution'

const suggestions = [
  'Analyse ce jeu de données et résume les tendances principales',
  'Prépare une veille concurrentielle avec sources et synthèse',
  'Conçois un plan de tests pour une application web',
]
const EMPTY_CONNECTOR_IDS: string[] = []
const pendingMcpSuggestions = new Map<string, McpSuggestion[]>()

function applyMcpActivity(message: ChatMessage, activity: McpActivity): ChatMessage {
  const current = message.mcpActivity ?? []
  const index = current.findIndex((item) => item.id === activity.id)
  const mcpActivity = index < 0 ? [...current, activity] : current.map((item, itemIndex) => itemIndex === index ? activity : item)
  return { ...message, mcpActivity }
}

function stopMcpActivity(message: ChatMessage): ChatMessage {
  if (!message.mcpActivity?.some((item) => item.status === 'running')) return message
  return { ...message, mcpActivity: message.mcpActivity.map((item) => item.status === 'running' ? { ...item, status: 'failed' } : item) }
}

function McpSuggestionCard({ suggestions, disabled, activatingId, onActivate, onDismiss }: {
  suggestions: McpSuggestion[]
  disabled: boolean
  activatingId: string | null
  onActivate: (item: McpSuggestion, authToken?: string) => Promise<void>
  onDismiss: () => void
}) {
  const [tokenFor, setTokenFor] = useState<string | null>(null)
  const [token, setToken] = useState('')
  const [connectFor, setConnectFor] = useState<string | null>(null)
  const [connectUrl, setConnectUrl] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)
  if (suggestions.length === 0) return null

  async function activate(item: McpSuggestion) {
    setLocalError(null)
    try {
      if (tokenFor === item.id) {
        if (!token.trim()) {
          setLocalError('Ce serveur MCP demande un jeton utilisateur.')
          return
        }
        await onActivate(item, token.trim())
        return
      }
      const entry = await chatAdapter.getMcpCatalogEntry(item.id)
      if (entry.requires_token) {
        setTokenFor(item.id)
        setToken('')
        return
      }
      await onActivate(item)
    } catch (error) {
      if (error instanceof ChatServiceError && error.needsToken) {
        setTokenFor(item.id)
        setToken('')
        setConnectFor(null)
        setLocalError('Ce serveur MCP demande un jeton utilisateur.')
        return
      }
      if (error instanceof ChatServiceError && error.connectUrl) {
        setConnectFor(item.id)
        setConnectUrl(error.connectUrl)
        setTokenFor(null)
        setLocalError(error.message)
        return
      }
      setLocalError(error instanceof Error ? error.message : 'Cette fiche n’a pas pu être lue.')
    }
  }

  return <div role="region" aria-label="Serveurs MCP suggérés" className="mb-3 rounded-xl border border-primary/20 bg-primary/5 p-3 text-left">
    <ul className="space-y-2">{suggestions.map((item) => <li key={item.id} className="space-y-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span><span className="font-medium">{item.name}</span> <span className="text-muted-foreground">· {item.category}</span></span>
        <Button type="button" size="sm" variant="outline" disabled={disabled || activatingId !== null} title={disabled ? 'Disponible à la fin de la réponse' : undefined} onClick={() => void activate(item)}>
          {activatingId === item.id ? 'Activation…' : 'Activer'}
        </Button>
      </div>
      {tokenFor === item.id && <Input type="password" autoComplete="off" value={token} placeholder="Jeton utilisateur" aria-label={`Jeton pour ${item.name}`} onChange={(event) => setToken(event.target.value)} />}
      {connectFor === item.id && connectUrl && <a href={connectUrl} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-4">Ouvrir la page de connexion</a>}
    </li>)}</ul>
    {localError && <p role="alert" className="mt-2 text-xs text-destructive">{localError}</p>}
    <Button type="button" variant="ghost" size="sm" className="mt-2" disabled={disabled || activatingId !== null} onClick={onDismiss}>Plus tard</Button>
  </div>
}

function AssistantMessage({ message, onExecutionComplete }: { message: ChatMessage; onExecutionComplete?: () => void }) {
  const [copied, setCopied] = useState(false)
  const activity = message.mcpActivity ?? []
  async function copy() {
    await navigator.clipboard.writeText(message.content)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }
  return <Message role="article" className="group gap-3" aria-label="Réponse de Mutual-AId">
    <MessageAvatar className="mt-0.5 size-8 self-start rounded-xl border border-primary/15 bg-primary/8 text-primary"><Sparkles aria-hidden="true" className="size-4" /></MessageAvatar>
    <MessageContent className="min-w-0 flex-1 gap-0 text-foreground">
      <div className="mb-1.5 flex flex-wrap items-center gap-2"><span className="text-xs font-semibold">Mutual-AId</span>{message.simulated && <Badge variant="outline" size="sm" className="h-5 text-[10px]">Réponse simulée</Badge>}</div>
      {message.status === 'streaming' && activity.length === 0 && <p role="status" aria-live="polite" className="mb-1 text-xs text-muted-foreground">Mutual-AId rédige…</p>}
      <McpActivityList items={activity} live={message.status === 'streaming'} />
      <div className="chat-markdown max-w-3xl text-sm leading-7 text-foreground/90">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
          a: ({ ...props }) => <a {...props} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-4" />,
          pre: ({ ...props }) => <pre {...props} className="my-3 max-w-full overflow-x-auto rounded-xl border border-border bg-muted/70 p-4 text-xs leading-5" />,
          code: ({ className, children, ...props }) => <code {...props} className={`${className ?? ''} rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]`} >{children}</code>,
          p: ({ ...props }) => <p {...props} className="my-2 first:mt-0 last:mb-0" />,
          ul: ({ ...props }) => <ul {...props} className="my-2 list-disc space-y-1 pl-5" />,
          ol: ({ ...props }) => <ol {...props} className="my-2 list-decimal space-y-1 pl-5" />,
          h1: ({ ...props }) => <h3 {...props} className="mt-4 text-base font-semibold" />,
          h2: ({ ...props }) => <h3 {...props} className="mt-4 text-sm font-semibold" />,
        }}>{message.content}</ReactMarkdown>
      </div>
      <div className="mt-2 flex items-center gap-2">
        {message.status !== 'streaming' && <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px] text-muted-foreground opacity-100 sm:opacity-0 sm:group-hover:opacity-100" onClick={() => void copy()} aria-label="Copier la réponse">
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}{copied ? 'Copié' : 'Copier'}
        </Button>}
        {message.status === 'failed' && <span role="alert" className="text-[11px] text-destructive">Réponse interrompue ou indisponible</span>}
        {message.simulated && <span className="text-[10px] text-muted-foreground">Mode démo · aucun modèle IA utilisé</span>}
      </div>
      {message.executionId && <ExecutionCard executionId={message.executionId} onComplete={onExecutionComplete} />}
    </MessageContent>
  </Message>
}

function ChatComposer({ onSend, onCancel, initialValue = '', connectors, selectedConnectorIds, onConnectorIdsChange, isSending }: { onSend: (content: string) => Promise<void>; onCancel?: () => void; initialValue?: string; connectors: ConnectorCatalogItem[]; selectedConnectorIds: string[]; onConnectorIdsChange: (connectorIds: string[]) => void; isSending: boolean }) {
  const [value, setValue] = useState(initialValue)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  async function submit() {
    if (!value.trim() || isSending) return
    const content = value.trim()
    setValue('')
    try { await onSend(content) } finally { textareaRef.current?.focus() }
  }
  return <div className="rounded-2xl border border-border bg-card shadow-lg shadow-black/[0.03] focus-within:border-primary/35 focus-within:ring-2 focus-within:ring-primary/10">
    <label className="sr-only" htmlFor="chat-composer">Écrire un message à Mutual-AId</label>
    <Textarea ref={textareaRef} id="chat-composer" value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit() } }} placeholder="Écrivez votre demande…" rows={2} className="max-h-48 min-h-[58px] resize-none border-0 bg-transparent px-4 pt-4 shadow-none focus-visible:ring-0" />
    <div className="flex items-center justify-between gap-2 px-3 pb-3"><div className="flex min-w-0 items-center gap-1"><span className="hidden pl-1 text-[10px] text-muted-foreground sm:inline">Entrée pour envoyer · Maj + Entrée pour une nouvelle ligne</span><ConnectorSelector connectors={connectors} selectedIds={selectedConnectorIds} onChange={onConnectorIdsChange} /></div><Button size={isSending ? 'sm' : 'icon'} className={isSending ? 'h-9 rounded-xl' : 'size-9 rounded-xl'} disabled={isSending ? !onCancel : !value.trim()} aria-label={isSending ? 'Annuler la réponse' : 'Envoyer le message'} onClick={() => isSending ? onCancel?.() : void submit()}>{isSending ? <><StopCircle aria-hidden="true" />Annuler</> : <ArrowUp aria-hidden="true" />}</Button></div>
  </div>
}

export function ChatPage() {
  const [chatAreaHeight, setChatAreaHeight] = useState<number | null>(null)
  const displayName = 'bonjour'
  const { conversationId: routeConversationId } = useParams()
  const [pendingConversationId, setPendingConversationId] = useState<string | null>(null)
  const activeConversationId = routeConversationId ?? pendingConversationId
  const navigate = useNavigate()
  const demoConversations = useConversationsStore((state) => state.conversations)
  const demoMessages = useConversationsStore((state) => state.messages)
  const remoteConversations = useOpenAIChatStore((state) => state.conversations)
  const remoteMessages = useOpenAIChatStore((state) => state.messages)
  const setRemoteMessages = useOpenAIChatStore((state) => state.setMessages)
  const setRemoteMessageLoading = useOpenAIChatStore((state) => state.setMessageLoading)
  const remoteConnectorIds = useOpenAIChatStore((state) => activeConversationId ? state.connectorIdsByConversation[activeConversationId] ?? EMPTY_CONNECTOR_IDS : EMPTY_CONNECTOR_IDS)
  const setRemoteConnectorIds = useOpenAIChatStore((state) => state.setConnectorIds)
  const remoteLoadingMessageIds = useOpenAIChatStore((state) => state.loadingMessageIds)
  const loadedRemoteMessageIds = useOpenAIChatStore((state) => state.loadedMessageConversationIds)
  const upsertRemoteMessage = useOpenAIChatStore((state) => state.upsertMessage)
  const removeRemoteMessage = useOpenAIChatStore((state) => state.removeMessage)
  const upsertRemoteConversation = useOpenAIChatStore((state) => state.upsertConversation)
  const conversations = chatAdapter.mode === 'demo' ? demoConversations : remoteConversations
  const allMessages = chatAdapter.mode === 'demo' ? demoMessages : remoteMessages
  const conversation = conversations.find((item) => item.id === activeConversationId)
  const messages = useMemo(() => allMessages.filter((message) => message.conversationId === activeConversationId).sort((a, b) => a.createdAt.localeCompare(b.createdAt)), [allMessages, activeConversationId])
  const activeRequest = useRef<AbortController | null>(null)
  const [suggestion, setSuggestion] = useState('')
  const [requestPending, setRequestPending] = useState(false)
  const [activatingSuggestionId, setActivatingSuggestionId] = useState<string | null>(null)
  const [chatError, setChatError] = useState<string | null>(null)
  const [mcpSuggestionState, setMcpSuggestionState] = useState<{ conversationId: string | null; suggestions: McpSuggestion[] }>(() => ({
    conversationId: activeConversationId,
    suggestions: activeConversationId ? pendingMcpSuggestions.get(activeConversationId) ?? [] : [],
  }))
  if (mcpSuggestionState.conversationId !== activeConversationId) {
    setMcpSuggestionState({
      conversationId: activeConversationId,
      suggestions: activeConversationId ? pendingMcpSuggestions.get(activeConversationId) ?? [] : [],
    })
  }
  const mcpSuggestions = mcpSuggestionState.suggestions
  const [health, setHealth] = useState<ChatBackendHealth | null>(null)
  const [connectorCatalog, setConnectorCatalog] = useState<ConnectorCatalogItem[]>([])

  useEffect(() => {
    const header = document.querySelector('header')
    const updateHeight = () => {
      const headerHeight = header?.getBoundingClientRect().height ?? 0
      setChatAreaHeight(Math.max(0, window.innerHeight - headerHeight))
    }
    updateHeight()
    const observer = header ? new ResizeObserver(updateHeight) : null
    if (header && observer) observer.observe(header)
    window.addEventListener('resize', updateHeight)
    window.visualViewport?.addEventListener('resize', updateHeight)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', updateHeight)
      window.visualViewport?.removeEventListener('resize', updateHeight)
    }
  }, [])

  useEffect(() => {
    if (chatAdapter.mode !== 'openai') return
    let cancelled = false
    void chatAdapter.checkHealth().then((result) => { if (!cancelled) setHealth(result) }).catch(() => { if (!cancelled) setHealth(null) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    void chatAdapter.listConnectors().then((items) => { if (!cancelled) setConnectorCatalog(items) }).catch(() => { if (!cancelled) setConnectorCatalog([]) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!activeConversationId) return
    if (chatAdapter.mode === 'demo') return
    let cancelled = false
    void chatAdapter.getConversationConnectors(activeConversationId)
      .then((preferences) => { if (!cancelled) setRemoteConnectorIds(activeConversationId, preferences.connector_ids) })
      .catch((error: unknown) => { if (!cancelled) setChatError(error instanceof Error ? error.message : 'Les connecteurs de la conversation n’ont pas pu être chargés.') })
    return () => { cancelled = true }
  }, [activeConversationId, setRemoteConnectorIds])

  useEffect(() => () => activeRequest.current?.abort(), [])

  useEffect(() => {
    if (chatAdapter.mode !== 'openai' || !activeConversationId) return
    let cancelled = false
    if (activeRequest.current) return
    if (loadedRemoteMessageIds.includes(activeConversationId)) return
    setRemoteMessageLoading(activeConversationId, true)
    void chatAdapter.listMessages(activeConversationId)
      .then((items) => { if (!cancelled) setRemoteMessages(activeConversationId, items) })
      .catch((error: unknown) => { if (!cancelled) setChatError(error instanceof Error ? error.message : 'Les messages n’ont pas pu être chargés.') })
      .finally(() => setRemoteMessageLoading(activeConversationId, false))
    return () => { cancelled = true }
  }, [activeConversationId, loadedRemoteMessageIds, setRemoteMessages, setRemoteMessageLoading])

  async function handleSend(content: string, useConnectedTools = false): Promise<boolean> {
    setChatError(null)
    let id = activeConversationId
    let navigateAfterResponse = false
    const controller = new AbortController()
    activeRequest.current = controller
    setRequestPending(true)
    try {
      const isNewConversation = !id || !conversations.some((item) => item.id === id)
      if (isNewConversation) {
        let initialConnectorIds: string[] = []
        if (chatAdapter.mode === 'openai') {
          const catalog = await chatAdapter.listConnectors().catch(() => connectorCatalog)
          setConnectorCatalog(catalog)
          initialConnectorIds = connectedConnectorIds(catalog)
        }
        const created = await chatAdapter.createConversation()
        id = created.id
        if (chatAdapter.mode === 'openai') {
          upsertRemoteConversation(created)
          useOpenAIChatStore.getState().setMessages(created.id, [])
          const preferences = await chatAdapter.setConversationConnectors(created.id, initialConnectorIds)
          setRemoteConnectorIds(created.id, preferences.connector_ids)
        }
        setPendingConversationId(id)
        navigateAfterResponse = true
      }
      if (!id) throw new Error('La conversation n’a pas pu être créée.')
      pendingMcpSuggestions.delete(id)
      setMcpSuggestionState({ conversationId: id, suggestions: [] })
      if (chatAdapter.mode === 'demo') {
        await chatAdapter.streamMessage(id, content, controller.signal, [], () => undefined)
        return true
      }

      const now = new Date().toISOString()
      const userMessage: ChatMessage = { id: `local-user-${crypto.randomUUID()}`, conversationId: id, role: 'user', content, createdAt: now, status: 'complete', simulated: false }
      const pendingId = `local-assistant-${crypto.randomUUID()}`
      upsertRemoteMessage(userMessage)
      upsertRemoteMessage({ id: pendingId, conversationId: id, role: 'assistant', content: '', createdAt: now, status: 'streaming', simulated: false })
      try {
        const connectorIds = useOpenAIChatStore.getState().connectorIdsByConversation[id] ?? []
        const response = await chatAdapter.streamMessage(id, content, controller.signal, connectorIds, (delta) => {
          const current = useOpenAIChatStore.getState().messages.find((message) => message.id === pendingId)
          if (current) upsertRemoteMessage({ ...current, content: current.content + delta })
        }, (execution: Execution) => {
          trackExecutionCompletion(execution.id)
          const current = useOpenAIChatStore.getState().messages.find((message) => message.id === pendingId)
          if (current) upsertRemoteMessage({ ...current, executionId: execution.id })
        }, (suggestions) => {
          if (!id) return
          pendingMcpSuggestions.set(id, suggestions)
          setMcpSuggestionState({ conversationId: id, suggestions })
        }, (activity) => {
          const current = useOpenAIChatStore.getState().messages.find((message) => message.id === pendingId)
          if (current) upsertRemoteMessage(applyMcpActivity(current, activity))
        }, useConnectedTools)
        removeRemoteMessage(pendingId)
        if (response) upsertRemoteMessage(response)
        try {
          const preferences = await chatAdapter.getConversationConnectors(id)
          setRemoteConnectorIds(id, preferences.connector_ids)
        } catch { /* The reply is already visible if the connector refresh fails. */ }
        const updatedConversations = await chatAdapter.listConversations()
        useOpenAIChatStore.getState().setConversations(updatedConversations)
        return true
      } catch (error) {
        const interrupted = error instanceof DOMException && error.name === 'AbortError'
        const visibleMessage = interrupted ? 'Réponse interrompue.' : error instanceof Error ? error.message : 'Le message n’a pas pu être traité.'
        const pendingMessage = useOpenAIChatStore.getState().messages.find((message) => message.id === pendingId)
        if (pendingMessage) upsertRemoteMessage({ ...stopMcpActivity(pendingMessage), content: visibleMessage, status: 'failed' })
        if (!interrupted) {
          setChatError(visibleMessage)
          try { useOpenAIChatStore.getState().setConversations(await chatAdapter.listConversations()) } catch { /* The original request error remains visible. */ }
        }
        return false
      }
    } catch (error) {
      setChatError(error instanceof Error ? error.message : 'La conversation n’a pas pu être créée.')
      return false
    } finally {
      if (activeRequest.current === controller) activeRequest.current = null
      setRequestPending(false)
      setSuggestion('')
      if (navigateAfterResponse && id) {
        setPendingConversationId(null)
        navigate(`/conversations/${id}`)
      }
    }
  }

  async function continueWithTools(conversationId: string) {
    const controller = new AbortController()
    activeRequest.current = controller
    setRequestPending(true)
    const pendingId = `local-assistant-${crypto.randomUUID()}`
    const now = new Date().toISOString()
    upsertRemoteMessage({ id: pendingId, conversationId, role: 'assistant', content: '', createdAt: now, status: 'streaming', simulated: false })
    try {
      const connectorIds = useOpenAIChatStore.getState().connectorIdsByConversation[conversationId] ?? []
      const response = await chatAdapter.streamMessage(
        conversationId, '', controller.signal, connectorIds,
        (delta) => {
          const current = useOpenAIChatStore.getState().messages.find((message) => message.id === pendingId)
          if (current) upsertRemoteMessage({ ...current, content: current.content + delta })
        },
        undefined, undefined, (activity) => {
          const current = useOpenAIChatStore.getState().messages.find((message) => message.id === pendingId)
          if (current) upsertRemoteMessage(applyMcpActivity(current, activity))
        }, false, true,
      )
      removeRemoteMessage(pendingId)
      if (!response) throw new Error('La réponse n’a pas pu être reprise.')
      upsertRemoteMessage(response)
      try {
        const preferences = await chatAdapter.getConversationConnectors(conversationId)
        setRemoteConnectorIds(conversationId, preferences.connector_ids)
      } catch { /* The reply is already visible. */ }
      useOpenAIChatStore.getState().setConversations(await chatAdapter.listConversations())
    } catch (error) {
      const interrupted = error instanceof DOMException && error.name === 'AbortError'
      const visibleMessage = interrupted ? 'Réponse interrompue.' : error instanceof Error ? error.message : 'La réponse n’a pas pu être reprise.'
      const pendingMessage = useOpenAIChatStore.getState().messages.find((message) => message.id === pendingId)
      if (pendingMessage) upsertRemoteMessage({ ...stopMcpActivity(pendingMessage), content: visibleMessage, status: 'failed' })
      if (!interrupted) setChatError(visibleMessage)
    } finally {
      if (activeRequest.current === controller) activeRequest.current = null
      setRequestPending(false)
    }
  }

  async function activateSuggestion(item: McpSuggestion, authToken?: string) {
    if (!activeConversationId || chatAdapter.mode !== 'openai') {
      setChatError('Activez ce serveur depuis une conversation connectée au backend.')
      return
    }
    setActivatingSuggestionId(item.id)
    setChatError(null)
    try {
      const result = await chatAdapter.activateConversationMcp(activeConversationId, item.id, authToken)
      setRemoteConnectorIds(activeConversationId, result.connector_ids)
      try {
        setConnectorCatalog(await chatAdapter.listConnectors())
      } catch { /* The conversation already keeps the selected server. */ }
      const remaining = mcpSuggestions.filter((suggestion) => suggestion.id !== item.id)
      pendingMcpSuggestions.set(activeConversationId, remaining)
      setMcpSuggestionState({ conversationId: activeConversationId, suggestions: remaining })
      await continueWithTools(activeConversationId)
    } catch (error) {
      if (error instanceof ChatServiceError && (error.needsToken || error.connectUrl)) throw error
      setChatError(error instanceof Error ? error.message : 'Ce serveur MCP n’a pas pu être activé.')
    } finally {
      setActivatingSuggestionId(null)
    }
  }

  function dismissSuggestions() {
    if (activeConversationId) pendingMcpSuggestions.delete(activeConversationId)
    setMcpSuggestionState({ conversationId: activeConversationId, suggestions: [] })
    if (chatAdapter.mode === 'openai' && activeConversationId) void continueWithoutSuggestedMcp(activeConversationId)
  }

  async function continueWithoutSuggestedMcp(conversationId: string) {
    const controller = new AbortController()
    activeRequest.current = controller
    setRequestPending(true)
    const pendingId = `local-assistant-${crypto.randomUUID()}`
    const now = new Date().toISOString()
    upsertRemoteMessage({ id: pendingId, conversationId, role: 'assistant', content: '', createdAt: now, status: 'streaming', simulated: false })
    try {
      const connectorIds = useOpenAIChatStore.getState().connectorIdsByConversation[conversationId] ?? []
      const response = await chatAdapter.streamMessage(
        conversationId, '', controller.signal, connectorIds,
        (delta) => {
          const current = useOpenAIChatStore.getState().messages.find((message) => message.id === pendingId)
          if (current) upsertRemoteMessage({ ...current, content: current.content + delta })
        },
        undefined, undefined, (activity) => {
          const current = useOpenAIChatStore.getState().messages.find((message) => message.id === pendingId)
          if (current) upsertRemoteMessage(applyMcpActivity(current, activity))
        }, false, false, true,
      )
      removeRemoteMessage(pendingId)
      if (!response) throw new Error('La réponse n’a pas pu être reprise.')
      upsertRemoteMessage(response)
      try {
        const preferences = await chatAdapter.getConversationConnectors(conversationId)
        setRemoteConnectorIds(conversationId, preferences.connector_ids)
      } catch { /* The reply is already visible. */ }
      useOpenAIChatStore.getState().setConversations(await chatAdapter.listConversations())
    } catch (error) {
      const interrupted = error instanceof DOMException && error.name === 'AbortError'
      const visibleMessage = interrupted ? 'Réponse interrompue.' : error instanceof Error ? error.message : 'La réponse n’a pas pu être reprise.'
      const pendingMessage = useOpenAIChatStore.getState().messages.find((message) => message.id === pendingId)
      if (pendingMessage) upsertRemoteMessage({ ...stopMcpActivity(pendingMessage), content: visibleMessage, status: 'failed' })
      if (!interrupted) setChatError(visibleMessage)
    } finally {
      if (activeRequest.current === controller) activeRequest.current = null
      setRequestPending(false)
    }
  }

  async function handleConnectorIdsChange(connectorIds: string[]) {
    setChatError(null)
    let id = routeConversationId
    let createdNewConversation = false
    try {
      if (!id || !conversations.some((item) => item.id === id)) {
        const created = await chatAdapter.createConversation()
        id = created.id
        createdNewConversation = true
        if (chatAdapter.mode === 'openai') {
          upsertRemoteConversation(created)
          useOpenAIChatStore.getState().setMessages(created.id, [])
        }
      }
      const preferences = await chatAdapter.setConversationConnectors(id, connectorIds)
      if (chatAdapter.mode === 'openai') setRemoteConnectorIds(id, preferences.connector_ids)
      if (createdNewConversation) navigate(`/conversations/${id}`)
    } catch (error) {
      setChatError(error instanceof Error ? error.message : 'Les connecteurs n’ont pas pu être enregistrés.')
    }
  }

  const selectedConnectorIds = chatAdapter.mode === 'demo'
    ? conversation?.connectorIds ?? []
    : activeConversationId ? remoteConnectorIds : connectedConnectorIds(connectorCatalog)
  const isWelcome = !activeConversationId || (chatAdapter.mode === 'demo' && !conversation)
  const conversationLoading = Boolean(activeConversationId && remoteLoadingMessageIds.includes(activeConversationId))
  const cancelResponse = () => activeRequest.current?.abort()
  const suggestionCard = <McpSuggestionCard suggestions={mcpSuggestions} disabled={requestPending} activatingId={activatingSuggestionId} onActivate={activateSuggestion} onDismiss={dismissSuggestions} />
  const composerBusy = requestPending || activatingSuggestionId !== null
  return <div style={chatAreaHeight ? { height: `${chatAreaHeight}px` } : undefined} className="-mx-5 -mt-6 -mb-6 flex h-[calc(100svh-102px)] min-h-0 flex-col overflow-hidden sm:-mx-8 sm:-mt-8 sm:-mb-8">
    <MessageScrollerProvider autoScroll defaultScrollPosition="end">
    <MessageScroller className="min-h-0 flex-1 px-5 sm:px-8">
    <MessageScrollerViewport aria-label="Messages de la conversation" className="px-0">
      <MessageScrollerContent role="log" aria-busy={requestPending} className={`mx-auto w-full max-w-3xl ${isWelcome ? 'flex min-h-[min(66svh,700px)] flex-col justify-center py-12' : 'gap-7 py-8'}`}>
        {isWelcome ? <div className="mx-auto w-full max-w-2xl text-center">
          <span className="mx-auto grid size-14 place-items-center rounded-2xl border border-primary/15 bg-gradient-to-br from-primary/10 to-violet-500/10 text-primary shadow-sm"><Sparkles aria-hidden="true" className="size-6" /></span>
          <p className="mt-6 text-xs font-medium uppercase tracking-[0.16em] text-primary">Espace conversationnel</p>
          <h2 className="mt-3 font-heading text-3xl font-semibold tracking-tight sm:text-4xl">Bonjour, {displayName}</h2>
          <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-muted-foreground">{chatAdapter.mode === 'openai' ? 'Posez une question ou décrivez votre objectif. Les demandes complexes peuvent être planifiées et suivies dans un workflow.' : 'Que souhaitez-vous accomplir aujourd’hui ? Les réponses de ce mode sont simulées.'}</p>
          {chatAdapter.mode === 'openai' && health && !health.openai_configured && <p role="status" className="mx-auto mt-4 max-w-lg rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">Le backend répond, mais la clé OpenAI ou le modèle n’est pas configuré. Complétez <code>backend/.env</code> pour activer les réponses.</p>}
          {chatAdapter.mode === 'openai' && <div className="mt-8 grid gap-2 text-left sm:grid-cols-3">{suggestions.map((item) => <button key={item} type="button" onClick={() => setSuggestion(item)} className="rounded-xl border border-border bg-card p-3.5 text-xs leading-relaxed transition hover:border-primary/30 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><span className="mb-2 block text-primary"><Sparkles aria-hidden="true" className="size-3.5" /></span>{item}</button>)}</div>}
          {chatError && <p role="alert" className="mx-auto mt-4 max-w-2xl rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-left text-xs text-destructive">{chatError}</p>}
          {suggestionCard}
          <div className="mx-auto mt-6 max-w-2xl"><ChatComposer key={suggestion} initialValue={suggestion} onSend={async (content) => { await handleSend(content) }} onCancel={cancelResponse} connectors={connectorCatalog} selectedConnectorIds={selectedConnectorIds} onConnectorIdsChange={(ids) => void handleConnectorIdsChange(ids)} isSending={composerBusy} /></div>
        </div> : <>
          <div className="mb-8 border-b border-border/70 pb-5"><h2 className="font-heading text-xl font-semibold tracking-tight">{conversation?.title ?? 'Conversation'}</h2><p className="mt-1 text-xs text-muted-foreground">{chatAdapter.mode === 'openai' ? 'Historique enregistré dans SQLite · OpenAI' : 'Conversation enregistrée localement · Mode démo'}</p></div>
          {conversationLoading && messages.length === 0 && <p role="status" className="text-sm text-muted-foreground">Chargement de la conversation…</p>}
          {!conversationLoading && !conversation && chatAdapter.mode === 'openai' && <p role="alert" className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">Cette conversation n’a pas pu être chargée. Vérifiez le backend ou retournez à la liste des conversations.</p>}
          {messages.map((message) => <MessageScrollerItem key={message.id} messageId={message.id}>
            {message.role === 'user' ? <Message role="article" align="end" aria-label="Votre message"><Bubble align="end"><BubbleContent className="max-w-[88vw] rounded-2xl rounded-br-md px-4 py-3 sm:max-w-[min(72vw,42rem)]"><p className="whitespace-pre-wrap">{message.content}</p></BubbleContent></Bubble></Message> : <AssistantMessage message={message} onExecutionComplete={() => { void chatAdapter.listMessages(message.conversationId).then((items) => setRemoteMessages(message.conversationId, items)) }} />}
          </MessageScrollerItem>)}
          <MessageScrollerItem className="h-2" />
        </>}
      </MessageScrollerContent>
    </MessageScrollerViewport>
    <MessageScrollerButton direction="end" className="z-10 rounded-full shadow-md" aria-label="Revenir aux derniers messages" />
    </MessageScroller>
    </MessageScrollerProvider>
    {!isWelcome && <div className="sticky bottom-0 shrink-0 border-t border-border/60 bg-background/90 px-5 py-4 backdrop-blur-xl sm:px-8"><div className="mx-auto max-w-3xl">{chatError && <p role="alert" className="mb-3 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">{chatError}</p>}{suggestionCard}<ChatComposer onSend={async (content) => { await handleSend(content) }} onCancel={cancelResponse} connectors={connectorCatalog} selectedConnectorIds={selectedConnectorIds} onConnectorIdsChange={(ids) => void handleConnectorIdsChange(ids)} isSending={composerBusy} /><p className="mt-2 text-center text-[10px] text-muted-foreground">{chatAdapter.mode === 'openai' ? (selectedConnectorIds.length > 0 ? 'Les outils des serveurs MCP activés peuvent servir à répondre.' : 'Réponses générées par OpenAI · Aucun outil externe n’est activé.') : 'Mutual-AId est en mode démo. Les réponses sont simulées.'}</p></div></div>}
    {isWelcome && <div className="mt-auto px-5 pb-5 text-center text-[10px] text-muted-foreground sm:px-8">{chatAdapter.mode === 'openai' ? 'Mutual-AId envoie les messages à votre backend local.' : 'Mutual-AId est en mode démo · Aucun modèle IA ni service externe n’est connecté.'}</div>}
  </div>
}
