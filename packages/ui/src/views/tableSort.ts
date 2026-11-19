import {
  type Task,
  type TaskPriority,
  type StatusConfig,
  type PriorityConfig,
  type SortRule,
  statusSortOrder
} from '@dotpm/core'

/** Compares by each rule in turn; a tie on every rule keeps the stored order. */
export function compareTasks(
  a: Task,
  b: Task,
  sort: SortRule[],
  statuses: StatusConfig[] = [],
  priorities: PriorityConfig[] = []
): number {
  for (const rule of sort) {
    const result = compareBy(a, b, rule, statuses, priorities)
    if (result !== 0) return result
  }
  return 0
}

function compareBy(a: Task, b: Task, rule: SortRule, statuses: StatusConfig[], priorities: PriorityConfig[]): number {
  const dir = rule.dir === 'asc' ? 1 : -1
  switch (rule.key) {
    case 'title':
      return dir * compareText(a.title, b.title)
    case 'status':
      return dir * (statusSortOrder(a.status, statuses) - statusSortOrder(b.status, statuses))
    case 'priority':
      return dir * (priorityOrder(a.priority, priorities) - priorityOrder(b.priority, priorities))
    case 'due':
      return dir * compareText(a.due || 'zzz', b.due || 'zzz')
    case 'progress':
      return dir * (a.progress - b.progress)
    default:
      return 0
  }
}

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

function priorityOrder(p: TaskPriority, priorities: PriorityConfig[]): number {
  const idx = priorities.findIndex((cfg) => cfg.id === p)
  return idx >= 0 ? idx : 999
}
