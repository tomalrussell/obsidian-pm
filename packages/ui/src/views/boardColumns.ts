import { DEFAULT_STATUSES, type GroupState, type Task } from '@dotpm/core'

export interface BoardColumn {
  /** The fixed status this column represents. */
  id: string
  label: string
  color?: string
  icon?: string
  tasks: Task[]
  hidden: boolean
}

/** Fixed status columns, with the saved order and visibility applied. */
export function boardColumns(group: GroupState, tasks: Task[]): BoardColumn[] {
  const columns: BoardColumn[] = DEFAULT_STATUSES.map((status) => ({ ...status, tasks: [], hidden: false }))
  const byId = new Map(columns.map((column) => [column.id, column]))
  for (const task of tasks) {
    const column = byId.get(task.status) ?? columns[0]
    column.tasks.push(task)
  }

  const prefs = group.columns
  const known = new Set(columns.map((column) => column.id))
  const rank = new Map((prefs?.order ?? []).filter((id) => known.has(id)).map((id, index) => [id, index]))
  const ordered = columns
    .map((column, index) => ({ column, index }))
    .sort((a, b) => (rank.get(a.column.id) ?? rank.size + a.index) - (rank.get(b.column.id) ?? rank.size + b.index))
    .map(({ column }) => column)
  const hidden = new Set(prefs?.hidden ?? [])
  for (const column of ordered) {
    column.hidden = hidden.has(column.id) || (!!group.hideEmpty && column.tasks.length === 0)
  }
  return ordered
}
