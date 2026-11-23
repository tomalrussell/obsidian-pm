import { describe, expect, it } from 'vitest'
import { DEFAULT_STATUSES, makeTask } from '@dotpm/core'
import { boardColumns } from './boardColumns'

const tasks = [
  makeTask({ id: 'a', status: 'capture', priority: 'high', tags: ['web'] }),
  makeTask({ id: 'b', status: 'capture', priority: 'low' }),
  makeTask({ id: 'c', status: 'done', priority: 'high' })
]

describe('boardColumns', () => {
  it('makes one column per fixed status in order', () => {
    const columns = boardColumns(tasks)
    expect(columns.map((c) => c.id)).toEqual(DEFAULT_STATUSES.map((s) => s.id))
    expect(columns[0].tasks.map((t) => t.id)).toEqual(['a', 'b'])
    expect(columns[0].color).toBe(DEFAULT_STATUSES[0].color)
  })

  it('keeps legacy statuses visible under capture without creating extra columns or duplicating tasks', () => {
    const legacy = makeTask({ id: 'legacy', status: 'waiting', tags: ['web', 'mobile'] })
    const columns = boardColumns([...tasks, legacy])
    expect(columns.map((column) => column.id)).toEqual(DEFAULT_STATUSES.map((status) => status.id))
    expect(columns[0].tasks).toContain(legacy)
    expect(columns.flatMap((column) => column.tasks).map((task) => task.id)).toEqual(['a', 'b', 'legacy', 'c'])
  })
})
