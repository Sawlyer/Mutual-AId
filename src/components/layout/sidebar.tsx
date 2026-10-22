import { useState } from 'react'
import { Link, NavLink, useNavigate } from 'react-router'
import { CircleHelp, LogOut, MessageSquarePlus, Pencil, Sparkles, Trash2 } from 'lucide-react'
import { navigationItems } from '@/components/layout/navigation'
import { cn } from '@/lib/utils'
import { useConversationsStore } from '@/stores/use-conversations-store'
import { useOpenAIChatStore } from '@/stores/use-openai-chat-store'
import { chatAdapter } from '@/services/chat-adapters'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuthStore } from '@/stores/use-auth-store'

interface SidebarProps {
  onNavigate?: () => void
}

export function Sidebar({ onNavigate }: SidebarProps) {
  const demoConversations = useConversationsStore((state) => state.conversations)
  const remoteConversations = useOpenAIChatStore((state) => state.conversations)
  const remoteLoading = useOpenAIChatStore((state) => state.loading)
  const user = useAuthStore((state) => state.user)
  const logout = useAuthStore((state) => state.logout)
  const navigate = useNavigate()
  const conversations = chatAdapter.mode === 'demo' ? demoConversations : remoteConversations
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState('')

  async function saveRename(conversationId: string) {
    try {
      await chatAdapter.renameConversation(conversationId, draftTitle)
      if (chatAdapter.mode === 'openai') useOpenAIChatStore.getState().renameConversation(conversationId, draftTitle.trim())
      setEditingId(null)
    } catch {
      window.alert('Le renommage a échoué. Vérifiez la connexion au backend puis réessayez.')
    }
  }

  async function removeConversation(conversationId: string, title: string) {
    if (!window.confirm(`Supprimer « ${title} » ?`)) return
    try {
      await chatAdapter.deleteConversation(conversationId)
      if (chatAdapter.mode === 'openai') useOpenAIChatStore.getState().removeConversation(conversationId)
    } catch {
      window.alert('La suppression a échoué. Vérifiez la connexion au backend puis réessayez.')
    }
  }
  async function signOut() {
    try {
      await logout()
      useOpenAIChatStore.getState().clearAccountData()
      navigate('/login', { replace: true })
    } catch { window.alert('La déconnexion a échoué. Réessayez.') }
  }
  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-sidebar px-3 py-5 text-sidebar-foreground">
      <div className="flex shrink-0 items-center gap-3 px-2 pb-7">
        <div className="relative grid size-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm shadow-primary/20">
          <Sparkles aria-hidden="true" className="size-5" strokeWidth={1.8} />
          <span className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-sidebar bg-emerald-500" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-heading text-[15px] font-semibold tracking-tight">
            Mutual-AId
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">Espace de travail</p>
        </div>
      </div>

      <div className="shrink-0 px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        Espace de travail
      </div>
      <nav aria-label="Navigation principale" className="shrink-0 space-y-1">
        {navigationItems.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'group flex min-h-10 items-center gap-3 rounded-lg px-3 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                isActive && 'bg-sidebar-accent text-sidebar-accent-foreground shadow-sm',
              )
            }
          >
            <Icon aria-hidden="true" className="size-[17px] shrink-0 opacity-80 group-hover:opacity-100" strokeWidth={1.8} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
      <section aria-label="Conversations récentes" className="mt-6 flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="mb-2 flex items-center justify-between px-3">
          <h2 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Récentes</h2>
          <Button render={<Link to="/" />} nativeButton={false} variant="ghost" size="icon-sm" aria-label="Nouvelle conversation" title="Nouvelle conversation" onClick={onNavigate}>
            <MessageSquarePlus aria-hidden="true" />
          </Button>
        </div>
        <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
          {conversations.slice(0, 8).map((conversation) => (
            <li key={conversation.id} className="group relative flex items-center gap-1 rounded-lg pr-1 hover:bg-muted/70">
              {editingId === conversation.id ? (
                <form className="flex min-w-0 flex-1 gap-1 p-1" onSubmit={(event) => { event.preventDefault(); void saveRename(conversation.id) }}>
                  <Input autoFocus aria-label="Nom de la conversation" value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} className="h-8 min-w-0 px-2 text-xs" onKeyDown={(event) => { if (event.key === 'Escape') setEditingId(null) }} />
                  <Button type="submit" size="sm" className="h-8 px-2">OK</Button>
                </form>
              ) : <NavLink to={`/conversations/${conversation.id}`} onClick={onNavigate} className={({ isActive }) => cn('min-w-0 flex-1 truncate rounded-lg px-3 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', isActive && 'bg-sidebar-accent text-sidebar-accent-foreground')}>
                {conversation.title}
              </NavLink>}
              {editingId !== conversation.id && <div className="flex shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                <Button variant="ghost" size="icon-sm" aria-label={`Renommer ${conversation.title}`} title="Renommer" onClick={() => { setEditingId(conversation.id); setDraftTitle(conversation.title) }}><Pencil aria-hidden="true" /></Button>
                <Button variant="ghost" size="icon-sm" aria-label={`Supprimer ${conversation.title}`} title="Supprimer" onClick={() => void removeConversation(conversation.id, conversation.title)}><Trash2 aria-hidden="true" /></Button>
              </div>}
            </li>
          ))}
          {conversations.length === 0 && <li className="px-3 py-2 text-xs text-muted-foreground">{remoteLoading && chatAdapter.mode === 'openai' ? 'Chargement…' : 'Aucune conversation'}</li>}
        </ul>
      </section>

      <div className="mt-auto shrink-0 space-y-3">
        <a
          href="mailto:bonjour@mutual-aid.app"
          className="flex min-h-10 items-center gap-3 rounded-lg px-3 text-[13px] font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <CircleHelp aria-hidden="true" className="size-[17px]" strokeWidth={1.8} />
          Aide & documentation
        </a>

        <div className="flex items-center gap-3 border-t border-sidebar-border px-2 pt-4">
          <div className="grid size-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-xs font-semibold text-white shadow-sm">
            {(user?.name || 'U').split(/\s+/).slice(0, 2).map((part) => part[0]?.toLocaleUpperCase()).join('')}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold">{user?.name}</p>
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{user?.email}</p>
          </div>
          <Button variant="ghost" size="icon-sm" aria-label="Se déconnecter" title="Se déconnecter" onClick={() => void signOut()}><LogOut aria-hidden="true" /></Button>
        </div>
      </div>
    </div>
  )
}
