import { describe, expect, it } from 'vitest'
import { navigationItems } from './navigation'

describe('navigationItems', () => {
  it('keeps conversation history in the sidebar instead of a separate page', () => {
    expect(navigationItems.some((item) => item.to === '/conversations')).toBe(false)
  })
})
