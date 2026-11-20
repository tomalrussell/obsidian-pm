import { describe, expect, it } from 'vitest'
import { today } from '../dates'
import {
  DEFAULT_STATUSES,
  makeDefaultFilter,
  makeTask,
  type FilterCondition,
  type Task,
  type TaskQuery
} from '../types'
import type { FilterContext } from './FilterFields'
import {
  applyTaskFilterFlat,
  applyTaskFilterPromote,
  bestConditionToDrop,
  countActiveFilters,
  isConditionComplete,
  isQueryActive,
  matchesCondition,
  matchesQuery,
  matchesSearch
} from './TaskFilter'
import { flattenTasks } from './TaskTreeOps'

const ctx: FilterContext = { statuses: DEFAULT_STATUSES }

function task(overrides: Partial<Task> & { id: string }): Task {
  return makeTask(overrides)
}

function query(conditions: FilterCondition[] = [], extra: Partial<TaskQuery> = {}): TaskQuery {
  return { filter: { ...makeDefaultFilter(), conditions }, text: '', ...extra }
}

const matches = (t: Task, condition: FilterCondition, context: FilterContext = ctx): boolean =>
  matchesCondition(t, condition, context)

describe('isQueryActive and countActiveFilters', () => {
  it('treats the default query as inactive', () => {
    expect(isQueryActive(query())).toBe(false)
    expect(countActiveFilters(makeDefaultFilter())).toBe(0)
  })

  it('counts search text as active but not as a filter', () => {
    expect(isQueryActive(query([], { text: 'foo' }))).toBe(true)
    expect(isQueryActive(query([], { text: '   ' }))).toBe(false)
  })

  it('counts showing archived tasks as a filter without narrowing the view', () => {
    const q = query()
    q.filter.showArchived = true
    expect(isQueryActive(q)).toBe(false)
    expect(countActiveFilters(q.filter)).toBe(1)
  })
})

describe('list fields', () => {
  const t = task({ id: 'a', status: 'todo', priority: 'high' })

  it('matches any of the chosen values', () => {
    expect(matches(t, { field: 'status', op: 'any', value: ['todo', 'done'] })).toBe(true)
    expect(matches(t, { field: 'status', op: 'any', value: ['done'] })).toBe(false)
  })

  it('excludes the chosen values with none', () => {
    expect(matches(t, { field: 'priority', op: 'none', value: ['high'] })).toBe(false)
    expect(matches(t, { field: 'priority', op: 'none', value: ['low'] })).toBe(true)
  })

  it('ignores a condition with no values yet', () => {
    expect(matches(t, { field: 'status', op: 'any', value: [] })).toBe(true)
  })

  it('matches the project a task belongs to', () => {
    const withProject: FilterContext = { ...ctx, projectOf: () => 'p1' }
    expect(matches(t, { field: 'project', op: 'any', value: ['p1'] }, withProject)).toBe(true)
    expect(matches(t, { field: 'project', op: 'any', value: ['p2'] }, withProject)).toBe(false)
  })
})

describe('multi fields', () => {
  const t = task({ id: 'a', tags: ['design', 'web'] })

  it('matches a task with no values as empty', () => {
    expect(matches(task({ id: 'b' }), { field: 'tag', op: 'empty' })).toBe(true)
    expect(matches(t, { field: 'tag', op: 'empty' })).toBe(false)
  })
})

describe('date fields', () => {
  const day = (offset: number): string => today().add({ days: offset }).toString()

  it('sorts dates into buckets', () => {
    const due = (d: string) => task({ id: d, due: d, status: 'todo' })
    expect(matches(due(day(-1)), { field: 'due', op: 'bucket', value: 'overdue' })).toBe(true)
    expect(matches(due(day(0)), { field: 'due', op: 'bucket', value: 'overdue' })).toBe(false)
    expect(matches(due(day(0)), { field: 'due', op: 'bucket', value: 'today' })).toBe(true)
    expect(matches(due(day(0)), { field: 'due', op: 'bucket', value: 'this-week' })).toBe(true)
    expect(matches(due(day(8)), { field: 'due', op: 'bucket', value: 'this-week' })).toBe(false)
    expect(matches(due(day(0)), { field: 'due', op: 'bucket', value: 'this-month' })).toBe(true)
    expect(matches(due(day(-1)), { field: 'due', op: 'bucket', value: 'this-month' })).toBe(false)
  })

  it('does not call a finished task overdue', () => {
    const done = task({ id: 'a', due: '2030-05-01', status: 'done' })
    expect(matches(done, { field: 'due', op: 'bucket', value: 'overdue' })).toBe(false)
  })

  it('matches a missing date as empty', () => {
    expect(matches(task({ id: 'a' }), { field: 'due', op: 'empty' })).toBe(true)
    expect(matches(task({ id: 'a', due: '2030-01-01' }), { field: 'due', op: 'not-empty' })).toBe(true)
  })
})

describe('search', () => {
  it('matches ids, titles and tags', () => {
    const t = task({ id: 'abc', title: 'Checkout copy', tags: ['Design'] })
    expect(matchesSearch(t, 'ABC', ctx)).toBe(true)
    expect(matchesSearch(t, 'checkout', ctx)).toBe(true)
    expect(matchesSearch(t, 'design', ctx)).toBe(true)
    expect(matchesSearch(t, 'missing', ctx)).toBe(false)
  })
})

describe('matchesQuery', () => {
  it('hides archived tasks unless the filter shows them', () => {
    const t = task({ id: 'a', archived: true })
    const q = query()
    expect(matchesQuery(t, q, ctx)).toBe(false)
    q.filter.showArchived = true
    expect(matchesQuery(t, q, ctx)).toBe(true)
  })

  it('needs every condition and the search to match', () => {
    const t = task({ id: 'a', title: 'Copy', status: 'todo', priority: 'high' })
    const both = [
      { field: 'status', op: 'any', value: ['todo'] },
      { field: 'priority', op: 'any', value: ['low'] }
    ] satisfies FilterCondition[]
    expect(matchesQuery(t, query(both), ctx)).toBe(false)
    expect(matchesQuery(t, query([both[0]], { text: 'copy' }), ctx)).toBe(true)
    expect(matchesQuery(t, query([both[0]], { text: 'paste' }), ctx)).toBe(false)
  })
})

describe('applying to trees', () => {
  const todo = [{ field: 'status', op: 'any', value: ['todo'] }] satisfies FilterCondition[]

  it('lifts a matching grandchild to the slot of its dropped parent', () => {
    const tasks = [
      task({
        id: 'root',
        status: 'todo',
        subtasks: [task({ id: 'mid', status: 'done', subtasks: [task({ id: 'leaf', status: 'todo' })] })]
      })
    ]
    const out = applyTaskFilterPromote(tasks, query(todo), ctx)
    expect(out.map((t) => t.id)).toEqual(['root'])
    expect(out[0].subtasks.map((t) => t.id)).toEqual(['leaf'])
  })

  it('drops branches with no matching descendants', () => {
    const tasks = [
      task({ id: 'a', status: 'done', subtasks: [task({ id: 'a1', status: 'done' })] }),
      task({ id: 'b', status: 'todo' })
    ]
    expect(applyTaskFilterPromote(tasks, query(todo), ctx).map((t) => t.id)).toEqual(['b'])
  })

  it('filters a flat list', () => {
    const flat = flattenTasks([task({ id: 'a', status: 'todo' }), task({ id: 'b', status: 'done' })])
    expect(applyTaskFilterFlat(flat, query(todo), ctx).map((f) => f.task.id)).toEqual(['a'])
  })
})

describe('isConditionComplete', () => {
  it('distinguishes empty and populated built-in conditions', () => {
    expect(isConditionComplete({ field: 'status', op: 'any', value: [] })).toBe(false)
    expect(isConditionComplete({ field: 'status', op: 'any', value: ['done'] })).toBe(true)
    expect(isConditionComplete({ field: 'due', op: 'empty' })).toBe(true)
    expect(isConditionComplete({ field: 'title', op: 'contains', value: ' ' })).toBe(false)
  })
})

describe('bestConditionToDrop', () => {
  it('names the condition whose removal brings back the most tasks', () => {
    const tasks = [
      task({ id: 'a', status: 'todo', priority: 'low' }),
      task({ id: 'b', status: 'todo', priority: 'low' }),
      task({ id: 'c', status: 'done', priority: 'high' })
    ]
    const q = query([
      { field: 'status', op: 'any', value: ['done'] },
      { field: 'priority', op: 'any', value: ['low'] }
    ])
    expect(bestConditionToDrop(tasks, q, ctx)).toEqual({ index: 0, shown: 2 })
  })

  it('returns null when no single condition brings anything back', () => {
    const tasks = [task({ id: 'a', status: 'todo', priority: 'low' })]
    const q = query([
      { field: 'status', op: 'any', value: ['done'] },
      { field: 'priority', op: 'any', value: ['high'] }
    ])
    expect(bestConditionToDrop(tasks, q, ctx)).toBeNull()
  })
})
