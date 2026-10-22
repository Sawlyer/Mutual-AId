import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUp, Check, Copy, Sparkles, StopCircle } from 'lucide-react'
import { useNavigate, useParams } from 'react-router'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ConnectorSelector } from '@/features/chat/connector-selector'
import { useConversationsStore } from '@/stores/use-conversations-store'
import { useOpenAIChatStore } from '@/stores/use-openai-chat-store'
import { useAuthStore } from '@/stores/use-auth-store'
import { chatAdapter, type ChatBackendHealth, type ConnectorCatalogItem } from '@/services/chat-adapters'
import type { Message } from '@/types/domain'
import { ExecutionCard } from '@/features/executions/execution-card'
import type { Execution } from '@/types/execution'

const suggestions = [
  'Analyse ce jeu de données et résume les tendances principales',
  'Prépare une veille concurrentielle avec sources et synthèse',
  'Conçois un plan de tests pour une application web',
]
const EMPTY_CONNECTOR_IDS: string[] = []

function AssistantMessage({ message, onExecutionComplete }: { message: Message; onExecutionComplete?: () => void }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    await navigator.clipboard.writeText(message.content)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }
  return <article className="group flex gap-3" aria-label="Réponse de Mutual-AId">
    <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-xl border border-primary/15 bg-primary/8 text-primary"><Sparkles aria-hidden="true" className="size-4" /></span>
    <div className="min-w-0 flex-1">
      <div className="mb-1.5 flex flex-wrap items-center gap-2"><span className="text-xs font-semibold">Mutual-AId</span>{message.simulated && <Badge variant="outline" className="h-5 text-[10px]">Réponse simulée</Badge>}</div>
      {message.status === 'streaming' && <p role="status" aria-live="polite" className="mb-1 text-xs text-muted-foreground">Mutual-AId rédige…</p>}
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
      {message.executionId && <ExecutionCard executionId={message.executionId} compact onComplete={onExecutionComplete} />}
    </div>
  </article>
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
  const displayName = useAuthStore((state) => state.user?.name.split(/\s+/)[0] || 'bonjour')
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
  const scrollRef = useRef<HTMLDivElement>(null)
  const activeRequest = useRef<AbortController | null>(null)
  const stickToBottom = useRef(true)
  const [suggestion, setSuggestion] = useState('')
  const [requestPending, setRequestPending] = useState(false)
  const [chatError, setChatError] = useState<string | null>(null)
  const [health, setHealth] = useState<ChatBackendHealth | null>(null)
  const [connectorCatalog, setConnectorCatalog] = useState<ConnectorCatalogItem[]>([])
  const lastMessageText = messages.at(-1)?.content
  useEffect(() => { if (stickToBottom.current) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }) }, [messages.length, lastMessageText])

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

  async function handleSend(content: string) {
    setChatError(null)
    let id = activeConversationId
    let navigateAfterResponse = false
    const controller = new AbortController()
    activeRequest.current = controller
    setRequestPending(true)
    try {
      if (!id || !conversations.some((item) => item.id === id)) {
        const created = await chatAdapter.createConversation()
        id = created.id
        if (chatAdapter.mode === 'openai') {
          upsertRemoteConversation(created)
          useOpenAIChatStore.getState().setMessages(created.id, [])
        }
        setPendingConversationId(id)
        navigateAfterResponse = true
      }
      if (chatAdapter.mode === 'demo') {
        await chatAdapter.streamMessage(id, content, controller.signal, [], () => undefined)
        return
      }

      const now = new Date().toISOString()
      const userMessage: Message = { id: `local-user-${crypto.randomUUID()}`, conversationId: id, role: 'user', content, createdAt: now, status: 'complete', simulated: false }
      const pendingId = `local-assistant-${crypto.randomUUID()}`
      upsertRemoteMessage(userMessage)
      upsertRemoteMessage({ id: pendingId, conversationId: id, role: 'assistant', content: '', createdAt: now, status: 'streaming', simulated: false })
      try {
        const connectorIds = useOpenAIChatStore.getState().connectorIdsByConversation[id] ?? []
        const response = await chatAdapter.streamMessage(id, content, controller.signal, connectorIds, (delta) => {
          const current = useOpenAIChatStore.getState().messages.find((message) => message.id === pendingId)
          if (current) upsertRemoteMessage({ ...current, content: current.content + delta })
        }, (execution: Execution) => {
          const current = useOpenAIChatStore.getState().messages.find((message) => message.id === pendingId)
          if (current) upsertRemoteMessage({ ...current, executionId: execution.id })
        })
        removeRemoteMessage(pendingId)
        upsertRemoteMessage(response)
        const updatedConversations = await chatAdapter.listConversations()
        useOpenAIChatStore.getState().setConversations(updatedConversations)
      } catch (error) {
        const interrupted = error instanceof DOMException && error.name === 'AbortError'
        const visibleMessage = interrupted ? 'Réponse interrompue.' : error instanceof Error ? error.message : 'Le message n’a pas pu être traité.'
        const pendingMessage = useOpenAIChatStore.getState().messages.find((message) => message.id === pendingId)
        if (pendingMessage) upsertRemoteMessage({ ...pendingMessage, content: visibleMessage, status: 'failed' })
        if (!interrupted) {
          setChatError(visibleMessage)
          try { useOpenAIChatStore.getState().setConversations(await chatAdapter.listConversations()) } catch { /* The original request error remains visible. */ }
        }
      }
    } catch (error) {
      setChatError(error instanceof Error ? error.message : 'La conversation n’a pas pu être créée.')
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

  async function handleConnectorIdsChange(connectorIds: string[]) {
    setChatError(null)
    let id = routeConversationId
    try {
      if (!id || !conversations.some((item) => item.id === id)) {
        const created = await chatAdapter.createConversation()
        id = created.id
        if (chatAdapter.mode === 'openai') {
          upsertRemoteConversation(created)
          useOpenAIChatStore.getState().setMessages(created.id, [])
        }
        navigate(`/conversations/${id}`)
      }
      const preferences = await chatAdapter.setConversationConnectors(id, connectorIds)
      if (chatAdapter.mode === 'openai') setRemoteConnectorIds(id, preferences.connector_ids)
    } catch (error) {
      setChatError(error instanceof Error ? error.message : 'Les connecteurs n’ont pas pu être enregistrés.')
    }
  }

  const selectedConnectorIds = chatAdapter.mode === 'demo' ? conversation?.connectorIds ?? [] : remoteConnectorIds
  const isWelcome = !activeConversationId || (chatAdapter.mode === 'demo' && !conversation)
  const conversationLoading = Boolean(activeConversationId && remoteLoadingMessageIds.includes(activeConversationId))
  const cancelResponse = () => activeRequest.current?.abort()
  return <div className="-mx-5 -mt-6 flex min-h-[calc(100svh-74px)] flex-col sm:-mx-8 sm:-mt-8">
    <div ref={scrollRef} onScroll={(event) => { const element = event.currentTarget; stickToBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 100 }} className="flex-1 overflow-y-auto px-5 sm:px-8">
      <div className={`mx-auto w-full max-w-3xl ${isWelcome ? 'flex min-h-[min(66svh,700px)] flex-col justify-center py-12' : 'space-y-7 py-8'}`}>
        {isWelcome ? <div className="mx-auto w-full max-w-2xl text-center">
          <span className="mx-auto grid size-14 place-items-center rounded-2xl border border-primary/15 bg-gradient-to-br from-primary/10 to-violet-500/10 text-primary shadow-sm"><Sparkles aria-hidden="true" className="size-6" /></span>
          <p className="mt-6 text-xs font-medium uppercase tracking-[0.16em] text-primary">Espace conversationnel</p>
          <h2 className="mt-3 font-heading text-3xl font-semibold tracking-tight sm:text-4xl">Bonjour, {displayName}</h2>
          <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-muted-foreground">{chatAdapter.mode === 'openai' ? 'Posez une question ou décrivez votre objectif. Les demandes complexes peuvent être planifiées et suivies dans un workflow.' : 'Que souhaitez-vous accomplir aujourd’hui ? Les réponses de ce mode sont simulées.'}</p>
          {chatAdapter.mode === 'openai' && health && !health.openai_configured && <p role="status" className="mx-auto mt-4 max-w-lg rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">Le backend répond, mais la clé OpenAI ou le modèle n’est pas configuré. Complétez <code>backend/.env</code> pour activer les réponses.</p>}
          {chatAdapter.mode === 'openai' && <div className="mt-8 grid gap-2 text-left sm:grid-cols-3">{suggestions.map((item) => <button key={item} type="button" onClick={() => setSuggestion(item)} className="rounded-xl border border-border bg-card p-3.5 text-xs leading-relaxed transition hover:border-primary/30 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><span className="mb-2 block text-primary"><Sparkles aria-hidden="true" className="size-3.5" /></span>{item}</button>)}</div>}
          {chatError && <p role="alert" className="mx-auto mt-4 max-w-2xl rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-left text-xs text-destructive">{chatError}</p>}
          <div className="mx-auto mt-6 max-w-2xl"><ChatComposer key={suggestion} initialValue={suggestion} onSend={handleSend} onCancel={cancelResponse} connectors={connectorCatalog} selectedConnectorIds={selectedConnectorIds} onConnectorIdsChange={(ids) => void handleConnectorIdsChange(ids)} isSending={requestPending} /></div>
        </div> : <>
          <div className="mb-8 border-b border-border/70 pb-5"><h2 className="font-heading text-xl font-semibold tracking-tight">{conversation?.title ?? 'Conversation'}</h2><p className="mt-1 text-xs text-muted-foreground">{chatAdapter.mode === 'openai' ? 'Historique enregistré dans SQLite · OpenAI' : 'Conversation enregistrée localement · Mode démo'}</p></div>
          {conversationLoading && messages.length === 0 && <p role="status" className="text-sm text-muted-foreground">Chargement de la conversation…</p>}
          {!conversationLoading && !conversation && chatAdapter.mode === 'openai' && <p role="alert" className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">Cette conversation n’a pas pu être chargée. Vérifiez le backend ou retournez à la liste des conversations.</p>}
          {messages.map((message) => <div key={message.id} className={message.role === 'user' ? 'ml-auto max-w-[88%] sm:max-w-[80%]' : ''}>
            {message.role === 'user' ? <article className="rounded-2xl rounded-br-md bg-primary px-4 py-3 text-sm leading-relaxed text-primary-foreground" aria-label="Votre message"><p className="whitespace-pre-wrap">{message.content}</p></article> : <AssistantMessage message={message} onExecutionComplete={() => { void chatAdapter.listMessages(message.conversationId).then((items) => setRemoteMessages(message.conversationId, items)) }} />}
          </div>)}
          <div className="h-2" />
        </>}
      </div>
    </div>
    {!isWelcome && <div className="sticky bottom-0 border-t border-border/60 bg-background/90 px-5 py-4 backdrop-blur-xl sm:px-8"><div className="mx-auto max-w-3xl">{chatError && <p role="alert" className="mb-3 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">{chatError}</p>}<ChatComposer onSend={handleSend} onCancel={cancelResponse} connectors={connectorCatalog} selectedConnectorIds={selectedConnectorIds} onConnectorIdsChange={(ids) => void handleConnectorIdsChange(ids)} isSending={requestPending} /><p className="mt-2 text-center text-[10px] text-muted-foreground">{chatAdapter.mode === 'openai' ? 'Réponses générées par OpenAI · Aucun outil externe n’est activé.' : 'Mutual-AId est en mode démo. Les réponses sont simulées.'}</p></div></div>}
    {isWelcome && <div className="mt-auto px-5 pb-5 text-center text-[10px] text-muted-foreground sm:px-8">{chatAdapter.mode === 'openai' ? 'Mutual-AId envoie les messages à votre backend local.' : 'Mutual-AId est en mode démo · Aucun modèle IA ni service externe n’est connecté.'}</div>}
  </div>
}
