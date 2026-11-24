import { describe, expect, it } from 'vitest'
import { scaleExecutionActivity } from './analytics-utils'

describe('scaleExecutionActivity', () => {
  it('maps daily activity to chart coordinates', () => {
    expect(scaleExecutionActivity([
      { date: '2026-01-01', count: 0 },
      { date: '2026-01-02', count: 4 },
      { date: '2026-01-03', count: 2 },
    ], 100, 40)).toEqual([
      { date: '2026-01-01', count: 0, x: 0, y: 40 },
      { date: '2026-01-02', count: 4, x: 50, y: 0 },
      { date: '2026-01-03', count: 2, x: 100, y: 20 },
    ])
  })

  it('keeps empty and zero activity charts stable', () => {
    expect(scaleExecutionActivity([], 100, 40)).toEqual([])
    expect(scaleExecutionActivity([
      { date: '2026-01-01', count: 0 },
      { date: '2026-01-02', count: 0 },
    ], 100, 40).map(({ y }) => y)).toEqual([40, 40])
  })
})
