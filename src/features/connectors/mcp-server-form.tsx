import { useState, type FormEvent } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { chatAdapter, type McpServerRecord } from '@/services/chat-adapters'

interface McpServerFormProps {
  onCreated: (server: McpServerRecord) => void
  onUpdated: (server: McpServerRecord) => void
}

export function McpServerForm({ onCreated, onUpdated }: McpServerFormProps) {
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [authToken, setAuthToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    const normalizedUrl = url.trim()
    try {
      const parsed = new URL(normalizedUrl)
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
        setError('Saisissez une URL HTTP(S) publique sans identifiant, paramètre ni fragment.')
        return
      }
    } catch {
      setError('Saisissez une URL valide pour le serveur MCP.')
      return
    }

    setBusy(true)
    try {
      const server = await chatAdapter.createMcpServer({ name: name.trim(), url: normalizedUrl, ...(authToken ? { auth_token: authToken } : {}) })
      setAuthToken('')
      setName('')
      setUrl('')
      onCreated(server)
      try {
        onUpdated(await chatAdapter.refreshMcpServer(server.id))
      } catch (reason) {
        const servers = await chatAdapter.listMcpServers()
        const latest = servers.find((item) => item.id === server.id)
        if (latest) onUpdated(latest)
        setError(reason instanceof Error ? reason.message : 'Le serveur a été ajouté, mais la découverte des outils a échoué.')
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Le serveur MCP n’a pas pu être ajouté.')
    } finally {
      setBusy(false)
    }
  }

  return <form onSubmit={submit} className="space-y-4 rounded-xl border border-border/80 bg-card p-4 sm:p-5">
    <div className="flex items-start gap-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Plus aria-hidden="true" className="size-4" /></span>
      <div><h3 className="text-sm font-semibold">Ajouter un serveur MCP</h3><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Ajoutez un endpoint Streamable HTTP de confiance. Les outils découverts resteront désactivés jusqu’à votre approbation.</p></div>
    </div>
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1.5">
        <Label htmlFor="mcp-name">Nom du serveur</Label>
        <Input id="mcp-name" value={name} onChange={(event) => setName(event.target.value)} required maxLength={80} placeholder="Documentation interne" autoComplete="off" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="mcp-url">URL du endpoint</Label>
        <Input id="mcp-url" value={url} onChange={(event) => setUrl(event.target.value)} required type="url" maxLength={2048} placeholder="https://mcp.example.com/mcp" autoComplete="url" />
      </div>
    </div>
    <div className="space-y-1.5">
      <Label htmlFor="mcp-token">Jeton Bearer <span className="font-normal text-muted-foreground">(facultatif)</span></Label>
      <Input id="mcp-token" value={authToken} onChange={(event) => setAuthToken(event.target.value)} type="password" maxLength={4096} placeholder="Stocké chiffré sur le backend" autoComplete="new-password" />
      <p className="text-[11px] leading-relaxed text-muted-foreground">Le jeton est chiffré côté serveur et effacé du formulaire après l’ajout. Ne placez pas de secret dans l’URL.</p>
    </div>
    {error && <p role="alert" className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">{error}</p>}
    <div className="flex justify-end"><Button type="submit" size="sm" disabled={busy}>{busy ? 'Ajout et test…' : 'Ajouter et tester'}</Button></div>
  </form>
}
