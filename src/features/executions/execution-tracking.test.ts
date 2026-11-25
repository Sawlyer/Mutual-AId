import { describe, expect, it } from 'vitest'
import { shouldNotifyExecution } from './execution-tracking'

describe('shouldNotifyExecution', () => {
  it('suppresses a notification while viewing the execution conversation', () => {
    expect(shouldNotifyExecution('conversation-1', '/conversations/conversation-1')).toBe(false)
  })

  it('notifies when the user has navigated away from the execution conversation', () => {
    expect(shouldNotifyExecution('conversation-1', '/connectors')).toBe(true)
    expect(shouldNotifyExecution('conversation-1', '/')).toBe(true)
  })
})
