import type { DueUrgency, Task, StatusConfig, PriorityConfig, TaskPriority } from './types'
import { HEX_COLOR, PRIORITY_ICONS } from './types'
import { today, parsePlainDate } from './dates'

/** A hand-edited color as `#rrggbb`, the only form a color input accepts; `#rgb` is expanded. */
export function readColor(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const value = raw.trim()
  const short = /^#([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])$/.exec(value)
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`
  return HEX_COLOR.test(value) ? value : null
}

export function stringToColor(s: string): string {
  let hash = 0
  for (let i = 0; i < s.length; i++) hash = s.charCodeAt(i) + ((hash << 5) - hash)
  return `hsl(${Math.abs(hash) % 360}, 55%, 45%)`
}

export function isTerminalStatus(status: string, statuses: StatusConfig[]): boolean {
  const cfg = statuses.find((s) => s.id === status)
  return cfg ? cfg.complete : false
}

export function getDefaultStatusId(statuses: StatusConfig[]): string {
  return statuses.length > 0 ? statuses[0].id : 'capture'
}

/** The former highest priority keeps its rank under the fixed priority names. */
export function normalizePriority(priority: TaskPriority): TaskPriority {
  return priority === 'critical' ? 'yesterday' : priority
}

export function getDefaultPriorityId(priorities: PriorityConfig[]): string {
  if (priorities.some((p) => p.id === 'medium')) return 'medium'
  return priorities.length > 0 ? priorities[Math.floor(priorities.length / 2)].id : 'medium'
}

export function getCompleteStatusId(statuses: StatusConfig[]): string {
  const found = statuses.find((s) => s.complete)
  return found ? found.id : 'done'
}

export function statusSortOrder(status: string, statuses: StatusConfig[]): number {
  const idx = statuses.findIndex((s) => s.id === status)
  return idx >= 0 ? idx : 999
}

/** A past date only reads as overdue when `overdue` says something is still open on it. */
export function dateUrgency(due: string, overdue: boolean): DueUrgency {
  const date = parsePlainDate(due)
  if (!date) return 'normal'
  const days = today().until(date, { largestUnit: 'day' }).days
  if (days < 0) return overdue ? 'overdue' : 'normal'
  return days < 3 ? 'near' : 'normal'
}

/** Terminal tasks are never urgent. */
export function dueUrgency(task: Task, statuses: StatusConfig[]): DueUrgency {
  if (isTerminalStatus(task.status, statuses)) return 'normal'
  return dateUrgency(task.due, true)
}

export function sanitizeFileName(title: string): string {
  return title.replace(/[\\/:*?"<>|]/g, '-')
}

export function getStatusConfig(statuses: StatusConfig[], id: string): StatusConfig | undefined {
  return statuses.find((s) => s.id === id)
}

export function getPriorityConfig(priorities: PriorityConfig[], id: TaskPriority): PriorityConfig | undefined {
  return priorities.find((p) => p.id === id)
}

/** A priority's own icon wins; otherwise the icon for its rank in the list. */
export function priorityIcon(priorities: PriorityConfig[], id: TaskPriority): string {
  const own = getPriorityConfig(priorities, id)?.icon
  if (own) return own
  const rank = priorities.findIndex((p) => p.id === id)
  return PRIORITY_ICONS[rank] ?? ''
}
