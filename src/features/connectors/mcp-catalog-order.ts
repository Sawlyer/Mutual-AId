export function orderCatalogEntries<T extends { id: string }>(
  entries: readonly T[],
  servers: readonly { catalog_id: string | null }[],
  known: readonly T[] = [],
): T[] {
  const byId = new Map<string, T>()
  for (const entry of [...known, ...entries]) byId.set(entry.id, entry)
  const activated: T[] = []
  const seen = new Set<string>()
  for (const server of servers) {
    const catalogId = server.catalog_id
    if (!catalogId || seen.has(catalogId)) continue
    const entry = byId.get(catalogId)
    if (!entry) continue
    seen.add(catalogId)
    activated.push(entry)
  }
  return [...activated, ...entries.filter((entry) => !seen.has(entry.id))]
}
