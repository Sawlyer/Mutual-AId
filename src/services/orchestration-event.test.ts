import { describe, expect, it } from 'vitest'
import { parseOrchestrationEvent } from '@/services/chat-adapters'

describe('parseOrchestrationEvent', () => {
  it('parses an execution.created event', () => {
    const event = parseOrchestrationEvent('event: execution.created\ndata: {"id":"exec-1","tasks":[]}')
    expect(event?.type).toBe('execution.created')
    if (event?.type === 'execution.created') expect(event.execution.id).toBe('exec-1')
  })

  it('keeps text deltas and ignores unknown or malformed events', () => {
    expect(parseOrchestrationEvent('event: delta\ndata: {"delta":"Bonjour"}')).toEqual({ type: 'delta', delta: 'Bonjour' })
    expect(parseOrchestrationEvent('event: future.event\ndata: {}')).toBeNull()
    expect(parseOrchestrationEvent('event: execution.created\ndata: {invalid')).toBeNull()
  })
})
