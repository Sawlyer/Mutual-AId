import { ArrowRight, MessageSquare, Plus } from 'lucide-react'
import { Link, useNavigate } from 'react-router'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useConversationsStore } from '@/stores/use-conversations-store'
import { useOpenAIChatStore } from '@/stores/use-openai-chat-store'
import { chatAdapter } from '@/services/chat-adapters'

export function ConversationsPage() {
  const demoConversations = useConversationsStore((state) => state.conversations)
  const backendConversations = useOpenAIChatStore((state) => state.conversations)
  const loading = useOpenAIChatStore((state) => state.loading)
  const loadError = useOpenAIChatStore((state) => state.loadError)
  const conversations = chatAdapter.mode === 'demo' ? demoConversations : backendConversations
  const navigate = useNavigate()
  async function createConversation() {
    try {
      const conversation = await chatAdapter.createConversation()
      if (chatAdapter.mode === 'openai') {
        useOpenAIChatStore.getState().upsertConversation(conversation)
        useOpenAIChatStore.getState().setMessages(conversation.id, [])
      }
      navigate(`/conversations/${conversation.id}`)
    } catch {
      useOpenAIChatStore.getState().setLoadError('Impossible de créer une conversation. Vérifiez le backend puis réessayez.')
    }
  }
  return <div className="mx-auto max-w-4xl space-y-6">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-sm text-muted-foreground">Votre espace</p><h2 className="mt-1 font-heading text-2xl font-semibold tracking-tight">Conversations</h2><p className="mt-1 text-sm text-muted-foreground">{chatAdapter.mode === 'openai' ? 'Vos échanges sont enregistrés par le backend dans SQLite.' : 'Vos échanges sont sauvegardés sur cet appareil.'}</p></div><Button onClick={() => void createConversation()}><Plus aria-hidden="true" />Nouvelle conversation</Button></div>
    {loadError && chatAdapter.mode === 'openai' && <p role="alert" className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">{loadError}</p>}
    {conversations.length ? <ul className="space-y-2">{[...conversations].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((conversation) => <li key={conversation.id}><Link to={`/conversations/${conversation.id}`} className="group flex items-center gap-3 rounded-xl border border-border bg-card p-4 transition hover:border-primary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/8 text-primary"><MessageSquare aria-hidden="true" className="size-4" /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium group-hover:text-primary">{conversation.title}</span><span className="mt-1 block text-xs text-muted-foreground">{conversation.messageCount !== undefined ? `${conversation.messageCount} messages · ` : ''}{new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' }).format(new Date(conversation.updatedAt))}</span></span><ArrowRight aria-hidden="true" className="size-4 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary" /></Link></li>)}</ul> : <Card><CardContent className="flex flex-col items-center py-14 text-center"><MessageSquare aria-hidden="true" className="size-8 text-muted-foreground" /><p className="mt-4 font-medium">{loading && chatAdapter.mode === 'openai' ? 'Chargement des conversations…' : 'Aucune conversation'}</p><p className="mt-1 text-sm text-muted-foreground">Commencez un échange pour le voir apparaître ici.</p>{!(loading && chatAdapter.mode === 'openai') && <Button onClick={() => void createConversation()} className="mt-4">Démarrer</Button>}</CardContent></Card>}
  </div>
}
