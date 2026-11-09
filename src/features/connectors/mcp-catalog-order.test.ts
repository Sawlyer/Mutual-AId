import { describe, expect, it } from 'vitest'
import { orderCatalogEntries } from '@/features/connectors/mcp-catalog-order'

const docs = { id: 'docs', name: 'Docs' }
const mail = { id: 'mail', name: 'Mail' }
const search = { id: 'search', name: 'Search' }

describe('orderCatalogEntries', () => {
  it('places activated fiches first, newest server first', () => {
    const ordered = orderCatalogEntries(
      [docs, mail, search],
      [{ catalog_id: 'mail' }, { catalog_id: 'docs' }, { catalog_id: null }],
    )
    expect(ordered.map((entry) => entry.id)).toEqual(['mail', 'docs', 'search'])
  })

  it('keeps an activated fiche at the top when it is absent from the current page', () => {
    const ordered = orderCatalogEntries([search], [{ catalog_id: 'mail' }], [mail])
    expect(ordered.map((entry) => entry.id)).toEqual(['mail', 'search'])
  })
})
