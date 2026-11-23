import { parsePlainDate, Temporal, today } from '../dates'
import type { DateBucket, FilterCondition, FilterState, StatusConfig, Task, TaskQuery } from '../types'
import { isTerminalStatus } from '../utils'
import { filterKind, filterValue, type FilterContext } from './FilterFields'
import type { FlatTask } from './TaskTreeOps'

/** Whether anything narrows the view. Showing archived tasks widens it, so it doesn't count. */
export function isQueryActive(query: TaskQuery): boolean {
  return query.text.trim().length > 0 || query.filter.conditions.length > 0
}

/** The number on the Filter button: every condition, plus showing archived tasks. */
export function countActiveFilters(filter: FilterState): number {
  return filter.conditions.length + (filter.showArchived ? 1 : 0)
}

export function matchesQuery(task: Task, query: TaskQuery, ctx: FilterContext): boolean {
  if (task.archived && !query.filter.showArchived) return false
  if (!query.filter.conditions.every((condition) => matchesCondition(task, condition, ctx))) return false
  return matchesSearch(task, query.text)
}

/** Matches the task id, title and tags. */
export function matchesSearch(task: Task, text: string): boolean {
  const q = text.trim().toLowerCase()
  if (!q) return true
  if (task.id.toLowerCase() === q) return true
  if (task.title.toLowerCase().includes(q)) return true
  if (task.tags.some((tag) => tag.toLowerCase().includes(q))) return true
  return false
}

export function matchesCondition(task: Task, condition: FilterCondition, ctx: FilterContext): boolean {
  const kind = filterKind(condition.field)
  if (!kind) return true
  const value = filterValue(task, condition.field, ctx)
  const { op } = condition
  switch (kind) {
    case 'list':
    case 'multi': {
      const held = Array.isArray(value) ? value : value ? [String(value)] : []
      if (op === 'empty') return held.length === 0
      if (op === 'not-empty') return held.length > 0
      const wanted = stringValues(condition)
      if (!wanted.length) return true
      if (op === 'none') return !held.some((v) => wanted.includes(v))
      if (op === 'all') return wanted.every((v) => held.includes(v))
      return held.some((v) => wanted.includes(v))
    }
    case 'text': {
      const s = typeof value === 'string' ? value : ''
      if (op === 'empty') return !s.trim()
      if (op === 'not-empty') return !!s.trim()
      const q = typeof condition.value === 'string' ? condition.value.trim().toLowerCase() : ''
      if (!q) return true
      const found = s.toLowerCase().includes(q)
      return op === 'not-contains' ? !found : found
    }
    case 'date': {
      const s = typeof value === 'string' ? value : ''
      if (op === 'empty') return !s
      if (op === 'not-empty') return !!s
      if (op === 'between') return inRange(s, stringValues(condition))
      const bucket = typeof condition.value === 'string' ? (condition.value as DateBucket) : null
      return bucket ? inBucket(task, s, bucket, ctx.statuses) : true
    }
  }
}

function stringValues(condition: FilterCondition): string[] {
  return Array.isArray(condition.value) ? condition.value.map(String) : []
}

function inRange(date: string, [from, to]: string[]): boolean {
  if (!from && !to) return true
  if (!date) return false
  return (!from || date >= from) && (!to || date <= to)
}

function inBucket(task: Task, date: string, bucket: DateBucket, statuses: StatusConfig[]): boolean {
  const day = parsePlainDate(date)
  if (!day) return false
  const now = today()
  const compare = Temporal.PlainDate.compare(day, now)
  switch (bucket) {
    case 'overdue':
      return compare < 0 && !isTerminalStatus(task.status, statuses)
    case 'today':
      return compare === 0
    case 'this-week': {
      const endOfWeek = now.add({ days: 7 - (now.dayOfWeek % 7) })
      return compare >= 0 && Temporal.PlainDate.compare(day, endOfWeek) <= 0
    }
    case 'this-month':
      return day.year === now.year && day.month === now.month && compare >= 0
  }
}

/** Lifts a matching descendant into its dropped ancestor's slot, so it doesn't disappear. */
export function applyTaskFilterPromote(tasks: Task[], query: TaskQuery, ctx: FilterContext): Task[] {
  const result: Task[] = []
  for (const t of tasks) {
    const filteredSubs = t.subtasks.length ? applyTaskFilterPromote(t.subtasks, query, ctx) : []
    if (matchesQuery(t, query, ctx)) {
      result.push({ ...t, subtasks: filteredSubs })
    } else {
      result.push(...filteredSubs)
    }
  }
  return result
}

export function applyTaskFilterFlat(flat: FlatTask[], query: TaskQuery, ctx: FilterContext): FlatTask[] {
  return flat.filter(({ task }) => matchesQuery(task, query, ctx))
}

/**
 * The condition whose removal frees the most tasks, for a view the filter has emptied.
 * Null when no single condition brings anything back.
 */
export function bestConditionToDrop(
  tasks: Task[],
  query: TaskQuery,
  ctx: FilterContext
): { index: number; shown: number } | null {
  let best: { index: number; shown: number } | null = null
  query.filter.conditions.forEach((_, index) => {
    const without: TaskQuery = {
      text: query.text,
      filter: { ...query.filter, conditions: query.filter.conditions.filter((__, i) => i !== index) }
    }
    const shown = tasks.filter((task) => matchesQuery(task, without, ctx)).length
    if (shown > 0 && (!best || shown > best.shown)) best = { index, shown }
  })
  return best
}

/** False for a condition the reader has started but that doesn't narrow anything yet. */
export function isConditionComplete(condition: FilterCondition): boolean {
  switch (condition.op) {
    case 'empty':
    case 'not-empty':
      return true
    case 'contains':
    case 'not-contains':
    case 'bucket':
      return typeof condition.value === 'string' && condition.value.trim().length > 0
    case 'between':
      return Array.isArray(condition.value) && condition.value.some((v) => v !== '' && v !== null && v !== undefined)
    default:
      return Array.isArray(condition.value) && condition.value.length > 0
  }
}
