import type { Conversation } from '@/types/domain'

export function sortConversationsByRecent(conversations: Conversation[]): Conversation[] {
  return [...conversations].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}
