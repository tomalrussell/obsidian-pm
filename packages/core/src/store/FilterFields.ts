import type { CustomFieldDef, FilterOp, StatusConfig, Task } from '../types'
import { stringifyCustomValue } from '../utils'

/** How a field's values compare, which decides the operators it offers. */
export type FilterKind = 'list' | 'multi' | 'text' | 'number' | 'date' | 'checkbox'

export const OPS_BY_KIND: Record<FilterKind, FilterOp[]> = {
  list: ['any', 'none', 'empty', 'not-empty'],
  multi: ['any', 'all', 'none', 'empty', 'not-empty'],
  text: ['contains', 'not-contains', 'empty', 'not-empty'],
  number: ['eq', 'ne', 'gte', 'lte', 'between', 'empty'],
  date: ['bucket', 'between', 'empty', 'not-empty'],
  checkbox: ['checked', 'unchecked']
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

const CUSTOM_KINDS: Record<CustomFieldDef['type'], FilterKind> = {
  text: 'text',
  url: 'text',
  number: 'number',
  date: 'date',
  select: 'list',
  multiselect: 'multi',
  checkbox: 'checkbox'
}

const CUSTOM_PREFIX = 'cf:'

export function customFilterField(id: string): string {
  return CUSTOM_PREFIX + id
}

/** What a condition needs to know about the tasks it is matched against. */
export interface FilterContext {
  statuses: StatusConfig[]
  customFields: CustomFieldDef[]
  /** The id of the project a task belongs to, for the project field. */
  projectOf?: (task: Task) => string | undefined
}

function isBuiltin(field: string): field is BuiltinField {
  return (BUILTIN_FILTER_FIELDS as readonly string[]).includes(field)
}

export function customFieldOf(field: string, customFields: CustomFieldDef[]): CustomFieldDef | undefined {
  if (!field.startsWith(CUSTOM_PREFIX)) return undefined
  const id = field.slice(CUSTOM_PREFIX.length)
  return customFields.find((cf) => cf.id === id)
}

/** Null for a field nothing defines any more, such as a removed custom field. */
export function filterKind(field: string, customFields: CustomFieldDef[]): FilterKind | null {
  if (isBuiltin(field)) return BUILTIN_KINDS[field]
  const custom = customFieldOf(field, customFields)
  return custom ? CUSTOM_KINDS[custom.type] : null
}

export function filterFieldLabel(field: string, customFields: CustomFieldDef[]): string {
  const custom = customFieldOf(field, customFields)
  if (custom) return custom.name
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

const KIND_ICONS: Record<FilterKind, string> = {
  list: 'list',
  multi: 'list-checks',
  text: 'type',
  number: 'hash',
  date: 'calendar',
  checkbox: 'square-check'
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

export function filterFieldIcon(field: string, customFields: CustomFieldDef[]): string {
  if (isBuiltin(field)) return BUILTIN_ICONS[field]
  const kind = filterKind(field, customFields)
  return kind ? KIND_ICONS[kind] : 'circle'
}

/**
 * The value a condition compares: one string for a list field (empty when unset), the
 * strings of a multi field, the text of a text field, a number or null, a `YYYY-MM-DD`
 * string (empty when unset), or a boolean.
 */
export function filterValue(
  task: Task,
  field: string,
  ctx: FilterContext
): string | string[] | number | boolean | null {
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
  const custom = customFieldOf(field, ctx.customFields)
  if (!custom) return null
  const raw = task.customFields[custom.id]
  switch (CUSTOM_KINDS[custom.type]) {
    case 'multi':
      return (Array.isArray(raw) ? raw : [raw]).map((v) => stringifyCustomValue(v)).filter(Boolean)
    case 'number': {
      const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : NaN
      return Number.isFinite(n) ? n : null
    }
    case 'checkbox':
      return raw === true || raw === 'true'
    default:
      return stringifyCustomValue(raw)
  }
}
