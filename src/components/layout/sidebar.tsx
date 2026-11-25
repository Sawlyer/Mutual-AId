import { useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router'
import { MessageSquarePlus, Pencil, Sparkles, Trash2 } from 'lucide-react'
import { navigationItems } from '@/components/layout/navigation'
import { useConversationsStore } from '@/stores/use-conversations-store'
import { useOpenAIChatStore } from '@/stores/use-openai-chat-store'
import { chatAdapter } from '@/services/chat-adapters'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Input } from '@/components/ui/input'
import { sortConversationsByRecent } from '@/features/chat/conversation-list'
import { Sidebar as ReUISidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuAction, SidebarMenuButton, SidebarMenuItem, SidebarProvider } from '@/components/ui/sidebar'

interface SidebarProps {
  onNavigate?: () => void
}

export function Sidebar({ onNavigate }: SidebarProps) {
  const demoConversations = useConversationsStore((state) => state.conversations)
  const remoteConversations = useOpenAIChatStore((state) => state.conversations)
  const remoteLoading = useOpenAIChatStore((state) => state.loading)
  const location = useLocation()
  const conversations = chatAdapter.mode === 'demo' ? demoConversations : remoteConversations
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null)
  const [deleteError, setDeleteError] = useState('')
  const [deletingConversation, setDeletingConversation] = useState(false)

  async function saveRename(conversationId: string) {
    try {
      await chatAdapter.renameConversation(conversationId, draftTitle)
      if (chatAdapter.mode === 'openai') useOpenAIChatStore.getState().renameConversation(conversationId, draftTitle.trim())
      setEditingId(null)
    } catch {
      window.alert('Le renommage a échoué. Vérifiez la connexion au backend puis réessayez.')
    }
  }

  async function removeConversation() {
    if (!deleteTarget) return
    setDeletingConversation(true)
    setDeleteError('')
    try {
      await chatAdapter.deleteConversation(deleteTarget.id)
      if (chatAdapter.mode === 'openai') useOpenAIChatStore.getState().removeConversation(deleteTarget.id)
      setDeleteTarget(null)
    } catch {
      setDeleteError('La suppression a échoué. Vérifiez la connexion au backend puis réessayez.')
    } finally { setDeletingConversation(false) }
  }
  return (
    <SidebarProvider className="min-h-0 w-full">
    <ReUISidebar collapsible="none" className="h-full w-full min-w-0 overflow-hidden px-3 py-5">
      <SidebarHeader className="shrink-0 gap-0 p-0 pb-7">
      <div className="flex items-center gap-3 px-2">
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
      </SidebarHeader>

      <SidebarContent className="gap-0 overflow-hidden">
      <SidebarGroup className="shrink-0 p-0">
      <SidebarGroupLabel className="h-auto px-3 pb-2 pt-0 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Espace de travail</SidebarGroupLabel>
      <SidebarGroupContent role="navigation" aria-label="Navigation principale">
      <SidebarMenu aria-label="Navigation principale" className="gap-1">
        {navigationItems.map(({ to, label, icon: Icon, end }) => (
          <SidebarMenuItem key={to}>
            <SidebarMenuButton
              render={<NavLink to={to} end={end} onClick={onNavigate} />}
              isActive={end ? location.pathname === to : location.pathname.startsWith(to)}
              className="h-10 gap-3 rounded-lg px-3 text-[13px] font-medium text-muted-foreground"
            >
              <Icon aria-hidden="true" className="size-[17px] opacity-80" strokeWidth={1.8} />
              <span>{label}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
      </SidebarGroupContent>
      </SidebarGroup>
      <section aria-label="Conversations récentes" className="mt-6 flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="mb-2 flex items-center justify-between px-3">
          <h2 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Récentes</h2>
          <Button render={<Link to="/" />} nativeButton={false} variant="ghost" size="icon-sm" aria-label="Nouvelle conversation" title="Nouvelle conversation" onClick={onNavigate}>
            <MessageSquarePlus aria-hidden="true" />
          </Button>
        </div>
        <SidebarMenu className="min-h-0 flex-1 gap-0.5 overflow-y-auto">
          {sortConversationsByRecent(conversations).map((conversation) => (
            <SidebarMenuItem key={conversation.id} className="group relative flex items-center gap-1 rounded-lg pr-1 hover:bg-muted/70">
              {editingId === conversation.id ? (
                <form className="flex min-w-0 flex-1 gap-1 p-1" onSubmit={(event) => { event.preventDefault(); void saveRename(conversation.id) }}>
                  <Input autoFocus aria-label="Nom de la conversation" value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} className="h-8 min-w-0 px-2 font-sans !text-xs !leading-4 font-medium tracking-normal" onFocus={(event) => event.currentTarget.select()} onKeyDown={(event) => { if (event.key === 'Escape') setEditingId(null) }} />
                  <Button type="submit" size="sm" className="h-8 px-2">OK</Button>
                </form>
              ) : <SidebarMenuButton render={<NavLink to={`/conversations/${conversation.id}`} onClick={onNavigate} />} isActive={location.pathname === `/conversations/${conversation.id}`} size="sm" title={conversation.title} className="min-w-0 flex-1 truncate py-1 pr-16 pl-3 font-sans text-xs text-muted-foreground"><span className="block min-w-0 truncate">{conversation.title.length > 28 ? `${conversation.title.slice(0, 27).trimEnd()}…` : conversation.title}</span></SidebarMenuButton>}
              {editingId !== conversation.id && <>
                <SidebarMenuAction showOnHover className="right-7" aria-label={`Renommer ${conversation.title}`} title="Renommer" onClick={() => { setEditingId(conversation.id); setDraftTitle(conversation.title) }}><Pencil aria-hidden="true" /></SidebarMenuAction>
                <SidebarMenuAction showOnHover className="right-1" aria-label={`Supprimer ${conversation.title}`} title="Supprimer" onClick={() => { setDeleteError(''); setDeleteTarget({ id: conversation.id, title: conversation.title }) }}><Trash2 aria-hidden="true" /></SidebarMenuAction>
              </>}
            </SidebarMenuItem>
          ))}
          {conversations.length === 0 && <li className="px-3 py-2 text-xs text-muted-foreground">{remoteLoading && chatAdapter.mode === 'openai' ? 'Chargement…' : 'Aucune conversation'}</li>}
        </SidebarMenu>
      </section>
      </SidebarContent>

      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open && !deletingConversation) { setDeleteTarget(null); setDeleteError('') } }}>
        <AlertDialogContent className="sm:max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer cette conversation ?</AlertDialogTitle>
            <AlertDialogDescription>
              « {deleteTarget?.title} » et son historique seront supprimés de votre espace. Cette action ne peut pas être annulée.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError && <p role="alert" className="text-sm text-destructive">{deleteError}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingConversation}>Annuler</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={deletingConversation} onClick={() => void removeConversation()}>
              {deletingConversation ? 'Suppression…' : 'Supprimer'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </ReUISidebar>
    </SidebarProvider>
  )
}
