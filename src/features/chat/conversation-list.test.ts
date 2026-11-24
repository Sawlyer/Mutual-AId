import { describe, expect, it } from 'vitest'
import type { Conversation } from '@/types/domain'
import { sortConversationsByRecent } from './conversation-list'

function conversation(id: string, updatedAt: string): Conversation {
  return {
    id,
    title: id,
    createdAt: updatedAt,
    updatedAt,
    messageCount: 1,
  }
}

describe('sortConversationsByRecent', () => {
  it('keeps every conversation and orders them by most recent activity', () => {
    const items = Array.from({ length: 10 }, (_, index) =>
      conversation(`chat-${index}`, `2026-01-${String(index + 1).padStart(2, '0')}T00:00:00Z`),
    )

    expect(sortConversationsByRecent(items).map((item) => item.id)).toEqual([
      'chat-9', 'chat-8', 'chat-7', 'chat-6', 'chat-5',
      'chat-4', 'chat-3', 'chat-2', 'chat-1', 'chat-0',
    ])
  })
})
