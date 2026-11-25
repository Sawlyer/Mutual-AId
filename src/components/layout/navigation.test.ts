import { describe, expect, it } from 'vitest'
import { getPageMeta } from '@/components/layout/navigation'

describe('getPageMeta', () => {
  it('returns agent detail metadata for a profile route', () => {
    expect(getPageMeta('/agents/cc6950a2-0cb4-4a8c-a3e4-87beee0ab42f')).toEqual({
      title: 'Fiche agent',
      description: 'Consultez et configurez un agent spécialisé.',
    })
  })
})
