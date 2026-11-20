import type { FilterOp, StatusConfig, Task } from '../types'

/** How a field's values compare, which decides the operators it offers. */
export type FilterKind = 'list' | 'multi' | 'text' | 'date'

export const OPS_BY_KIND: Record<FilterKind, FilterOp[]> = {
  list: ['any', 'none', 'empty', 'not-empty'],
  multi: ['any', 'all', 'none', 'empty', 'not-empty'],
  text: ['contains', 'not-contains', 'empty', 'not-empty'],
  date: ['bucket', 'between', 'empty', 'not-empty']
}

export const BUILTIN_FILTER_FIELDS = ['status', 'priority', 'tag', 'due', 'start', 'type', 'project', 'title'] as const
type BuiltinField = (typeof BUILTIN_FILTER_FIELDS)[number]

const BUILTIN_KINDS: Record<BuiltinField, FilterKind> = {
  status: 'list',
  priority: 'list',
  tag: 'multi',
  due: 'date',
  start: 'date',
  type: 'list',
  project: 'list',
  title: 'text'
}

/** What a condition needs to know about the tasks it is matched against. */
export interface FilterContext {
  statuses: StatusConfig[]
  /** The id of the project a task belongs to, for the project field. */
  projectOf?: (task: Task) => string | undefined
}

function isBuiltin(field: string): field is BuiltinField {
  return (BUILTIN_FILTER_FIELDS as readonly string[]).includes(field)
}

/** Null for an unknown or removed field. */
export function filterKind(field: string): FilterKind | null {
  return isBuiltin(field) ? BUILTIN_KINDS[field] : null
}

export function filterFieldLabel(field: string): string {
  switch (field) {
    case 'status':
      return 'Status'
    case 'priority':
      return 'Priority'
    case 'tag':
      return 'Tag'
    case 'due':
      return 'Due date'
    case 'start':
      return 'Start date'
    case 'type':
      return 'Type'
    case 'project':
      return 'Project'
    case 'title':
      return 'Title'
    default:
      return field
  }
}

const BUILTIN_ICONS: Record<BuiltinField, string> = {
  status: 'circle-dot',
  priority: 'flag',
  tag: 'tag',
  due: 'calendar',
  start: 'calendar-arrow-up',
  type: 'shapes',
  project: 'folder-kanban',
  title: 'type'
}

export function filterFieldIcon(field: string): string {
  if (isBuiltin(field)) return BUILTIN_ICONS[field]
  return 'circle'
}

/**
 * The value a condition compares: one string for a list field (empty when unset), the
 * strings of a multi field, text, or a `YYYY-MM-DD` string (empty when unset).
 */
export function filterValue(task: Task, field: string, ctx: FilterContext): string | string[] | null {
  switch (field) {
    case 'status':
      return task.status
    case 'priority':
      return task.priority
    case 'tag':
      return task.tags
    case 'due':
      return task.due
    case 'start':
      return task.start
    case 'type':
      return task.type
    case 'project':
      return ctx.projectOf?.(task) ?? ''
    case 'title':
      return task.title
  }
  return null
}
