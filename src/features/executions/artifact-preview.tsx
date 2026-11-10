import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface ArtifactPreviewProps {
  content: string
  mediaType: string
}

function parseCsv(source: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    if (character === '"') {
      if (quoted && source[index + 1] === '"') {
        field += '"'
        index += 1
      } else {
        quoted = !quoted
      }
    } else if (character === ',' && !quoted) {
      row.push(field)
      field = ''
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && source[index + 1] === '\n') index += 1
      row.push(field)
      if (row.some((cell) => cell.length > 0)) rows.push(row)
      row = []
      field = ''
    } else {
      field += character
    }
  }

  row.push(field)
  if (row.some((cell) => cell.length > 0)) rows.push(row)
  return rows
}

export function ArtifactPreview({ content, mediaType }: ArtifactPreviewProps) {
  const type = mediaType.split(';', 1)[0].trim().toLowerCase()

  if (type === 'application/json' || type.endsWith('+json')) {
    let formatted = content
    let invalidJson = false
    try {
      formatted = JSON.stringify(JSON.parse(content) as unknown, null, 2)
    } catch {
      invalidJson = true
    }

    return (
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">Aperçu JSON</p>
        {invalidJson && <p role="status" className="text-xs text-amber-700 dark:text-amber-300">JSON invalide : contenu brut affiché.</p>}
        <pre aria-label="Aperçu JSON" className="max-h-[28rem] overflow-auto rounded-lg bg-muted p-4 text-xs leading-relaxed">
          <code>{formatted}</code>
        </pre>
      </div>
    )
  }

  if (type === 'text/csv') {
    const rows = parseCsv(content)
    const [header = [], ...body] = rows
    const visibleColumns = Math.min(header.length, 20)
    const visibleRows = body.slice(0, 100)
    const limited = body.length > visibleRows.length || header.length > visibleColumns

    return (
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">Aperçu CSV · {body.length} lignes</p>
        <div className="max-h-[28rem] overflow-auto rounded-lg border">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="sticky top-0 bg-muted">
              <tr>{header.slice(0, visibleColumns).map((cell, index) => <th scope="col" key={`${index}-${cell}`} className="border-b px-3 py-2 font-semibold">{cell}</th>)}</tr>
            </thead>
            <tbody>
              {visibleRows.map((cells, rowIndex) => (
                <tr key={rowIndex} className="odd:bg-muted/30">
                  {header.slice(0, visibleColumns).map((_, columnIndex) => (
                    <td key={columnIndex} className="max-w-64 border-b px-3 py-2 align-top">{cells[columnIndex] ?? ''}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {limited && <p className="text-xs text-muted-foreground">Aperçu limité aux 100 premières lignes et 20 colonnes.</p>}
      </div>
    )
  }

  if (type === 'text/markdown') {
    return (
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">Aperçu Markdown</p>
        <div className="max-h-[28rem] overflow-auto rounded-lg border p-4 text-sm [&_a]:text-primary [&_a]:underline [&_pre]:overflow-auto [&_pre]:rounded [&_pre]:bg-muted [&_pre]:p-3">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </div>
      </div>
    )
  }

  if (type === 'text/plain' || type.startsWith('text/')) {
    return (
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">Aperçu texte</p>
        <pre aria-label="Aperçu texte" className="max-h-[28rem] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted p-4 text-xs leading-relaxed">{content}</pre>
      </div>
    )
  }

  return <p className="text-sm text-muted-foreground">Aperçu indisponible pour ce format. Téléchargez le fichier pour le consulter.</p>
}
