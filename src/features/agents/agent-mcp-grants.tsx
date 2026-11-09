import { useEffect, useState } from 'react'
import { Cable } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { agentService } from '@/services/agent-service'
import { chatAdapter, type McpServerRecord } from '@/services/chat-adapters'

interface Grant { server_id: string; tool_name: string }

export function AgentMcpGrants({ profileId, profileName }: { profileId: string; profileName: string }) {
  const [open, setOpen] = useState(false)
  const [servers, setServers] = useState<McpServerRecord[]>([])
  const [selected, setSelected] = useState<Grant[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open || chatAdapter.mode !== 'openai') return
    let cancelled = false
    void Promise.all([chatAdapter.listMcpServers(), agentService.listMcpTools(profileId)])
      .then(([items, grants]) => { if (!cancelled) { setServers(items); setSelected(grants.tools) } })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Les outils MCP n’ont pas pu être chargés.') })
    return () => { cancelled = true }
  }, [open, profileId])

  const readable = servers.flatMap((server) => server.tools
    .filter((tool) => tool.access === 'read' && !tool.requires_human_approval && server.approved_tool_names.includes(tool.name))
    .map((tool) => ({ server, tool })))

  function toggle(grant: Grant, checked: boolean) {
    setSelected((current) => checked ? [...current, grant] : current.filter((item) => item.server_id !== grant.server_id || item.tool_name !== grant.tool_name))
  }

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const saved = await agentService.setMcpTools(profileId, selected)
      setSelected(saved.tools)
      setOpen(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Les outils n’ont pas pu être enregistrés.')
    } finally { setBusy(false) }
  }

  return <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (next) setError(null) }}>
    <DialogTrigger render={<Button type="button" variant="ghost" size="icon" aria-label={`Outils MCP de ${profileName}`} />}>
      <Cable />
    </DialogTrigger>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Outils MCP de {profileName}</DialogTitle>
        <DialogDescription>Cet agent n’appelle un outil que s’il est aussi approuvé, activé et sélectionné dans la conversation.</DialogDescription>
      </DialogHeader>
      {chatAdapter.mode !== 'openai' ? <p className="text-sm text-muted-foreground">La gestion MCP nécessite le backend connecté.</p> : <>
        {readable.length === 0 && <p className="text-sm text-muted-foreground">Aucun outil de lecture approuvé. Approuvez d’abord un outil dans le catalogue MCP.</p>}
        <ul className="max-h-72 space-y-2 overflow-auto">{readable.map(({ server, tool }) => {
          const checked = selected.some((item) => item.server_id === server.id && item.tool_name === tool.name)
          return <li key={`${server.id}:${tool.name}`}>
            <label className="flex items-start gap-2 rounded-lg border border-border px-3 py-2 text-sm">
              <input type="checkbox" className="mt-1 accent-primary" checked={checked} onChange={(event) => toggle({ server_id: server.id, tool_name: tool.name }, event.target.checked)} />
              <span><span className="font-medium">{tool.name}</span><span className="mt-0.5 block text-xs text-muted-foreground">{server.name}</span></span>
            </label>
          </li>
        })}</ul>
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        <div className="flex justify-end"><Button type="button" size="sm" disabled={busy} onClick={() => void save()}>{busy ? 'Enregistrement…' : 'Enregistrer'}</Button></div>
      </>}
    </DialogContent>
  </Dialog>
}
