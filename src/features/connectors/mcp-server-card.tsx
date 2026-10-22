import { useState } from 'react'
import { AlertCircle, Check, Clock3, LoaderCircle, RefreshCw, Save, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { chatAdapter, type McpServerRecord } from '@/services/chat-adapters'

interface McpServerCardProps {
  server: McpServerRecord
  onChange: (server: McpServerRecord) => void
  onDelete: (serverId: string) => void
}

const statusLabel: Record<McpServerRecord['status'], string> = { not_checked: 'À tester', ready: 'Outils découverts', error: 'Erreur' }

export function McpServerCard({ server, onChange, onDelete }: McpServerCardProps) {
  const [pendingTools, setPendingTools] = useState<string[] | null>(null)
  const selectedTools = pendingTools ?? server.approved_tool_names
  const [busy, setBusy] = useState<'refresh' | 'save' | 'delete' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const dirty = selectedTools.length !== server.approved_tool_names.length || selectedTools.some((name) => !server.approved_tool_names.includes(name))
  const statusTone = server.status === 'ready' ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300'
    : server.status === 'error' ? 'border-destructive/20 bg-destructive/5 text-destructive' : 'border-border bg-muted/40 text-muted-foreground'

  async function refresh() {
    setBusy('refresh')
    setError(null)
    try { const updated = await chatAdapter.refreshMcpServer(server.id); setPendingTools(null); onChange(updated) }
    catch (reason) {
      setError(reason instanceof Error ? reason.message : 'La connexion au serveur a échoué.')
      try {
        const servers = await chatAdapter.listMcpServers()
        const latest = servers.find((item) => item.id === server.id)
        if (latest) onChange(latest)
      } catch { /* Keep the last known server state when refresh fails. */ }
    } finally { setBusy(null) }
  }

  async function saveTools() {
    setBusy('save')
    setError(null)
    try { const updated = await chatAdapter.setMcpServerTools(server.id, selectedTools); setPendingTools(null); onChange(updated) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Les autorisations n’ont pas pu être enregistrées.') }
    finally { setBusy(null) }
  }

  async function removeServer() {
    if (!window.confirm(`Supprimer le serveur MCP « ${server.name} » et ses autorisations ?`)) return
    setBusy('delete')
    setError(null)
    try { await chatAdapter.deleteMcpServer(server.id); onDelete(server.id) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Le serveur n’a pas pu être supprimé.') }
    finally { setBusy(null) }
  }

  return <Card className="border-border/80 shadow-sm shadow-black/[0.02]">
    <CardContent className="space-y-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold">{server.name}</h3>
          <p className="mt-1 break-all text-[11px] leading-relaxed text-muted-foreground">{server.url}</p>
        </div>
        <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-medium ${statusTone}`}>
          {server.status === 'ready' ? <Check aria-hidden="true" className="size-3" /> : server.status === 'error' ? <AlertCircle aria-hidden="true" className="size-3" /> : <Clock3 aria-hidden="true" className="size-3" />}
          {statusLabel[server.status]}
        </span>
      </div>

      <div className="border-t border-border/60 pt-3">
        <div className="flex items-center justify-between gap-2">
          <div><p className="text-xs font-medium">Outils autorisés</p><p className="mt-0.5 text-[10px] text-muted-foreground">Seuls les outils approuvés sont fournis à l’agent.</p></div>
          <span className="text-[10px] tabular-nums text-muted-foreground">{selectedTools.length} sélectionné(s)</span>
        </div>
        {server.tools.length ? <ul className="mt-3 space-y-2">
          {server.tools.map((tool) => {
            const readOnly = tool.access === 'read' && !tool.requires_human_approval
            const checked = selectedTools.includes(tool.name)
            return <li key={tool.name}>
              <label className={`flex gap-2.5 rounded-lg border px-3 py-2.5 ${readOnly ? 'cursor-pointer border-border/70 hover:bg-muted/30' : 'cursor-not-allowed border-border/50 bg-muted/20 opacity-70'}`}>
                <input type="checkbox" checked={checked} disabled={!readOnly || busy !== null} onChange={(event) => setPendingTools(event.target.checked ? [...selectedTools, tool.name] : selectedTools.filter((name) => name !== tool.name))} aria-label={`Autoriser l’outil ${tool.name}`} className="mt-0.5 accent-primary" />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2 text-xs font-medium">{tool.name}<span className={`rounded px-1.5 py-0.5 text-[9px] uppercase ${readOnly ? 'bg-blue-500/10 text-blue-700 dark:text-blue-300' : 'bg-amber-500/10 text-amber-700 dark:text-amber-300'}`}>{readOnly ? 'lecture' : 'bloqué · écriture ou non vérifié'}</span></span>
                  {tool.description && <span className="mt-1 block text-[11px] leading-relaxed text-muted-foreground">{tool.description}</span>}
                </span>
              </label>
            </li>
          })}
        </ul> : <p className="mt-3 rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">Aucun outil découvert. Testez la connexion pour lire la liste des outils.</p>}
      </div>

      {server.last_error && <p role="status" className="rounded-lg border border-destructive/15 bg-destructive/5 px-3 py-2 text-xs text-destructive">{server.last_error}</p>}
      {server.last_checked_at && <p className="text-[10px] text-muted-foreground">Dernière vérification : {new Date(server.last_checked_at).toLocaleString('fr-FR')}</p>}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3">
        <Button type="button" variant="ghost" size="sm" disabled={busy !== null} onClick={() => void removeServer()} className="text-muted-foreground hover:text-destructive">
          {busy === 'delete' ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> : <Trash2 aria-hidden="true" className="size-3.5" />}Supprimer
        </Button>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" disabled={busy !== null} onClick={() => void refresh()}>
            {busy === 'refresh' ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> : <RefreshCw aria-hidden="true" className="size-3.5" />}Tester
          </Button>
          <Button type="button" size="sm" disabled={busy !== null || !dirty} onClick={() => void saveTools()}>
            {busy === 'save' ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> : <Save aria-hidden="true" className="size-3.5" />}Enregistrer
          </Button>
        </div>
      </div>
    </CardContent>
  </Card>
}
