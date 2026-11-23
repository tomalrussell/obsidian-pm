import { DEFAULT_STATUSES, type Task } from '@dotpm/core'

export interface BoardColumn {
  /** The fixed status this column represents. */
  id: string
  label: string
  color?: string
  icon?: string
  tasks: Task[]
}

/** Fixed status columns, always visible in their default order. */
export function boardColumns(tasks: Task[]): BoardColumn[] {
  const columns: BoardColumn[] = DEFAULT_STATUSES.map((status) => ({ ...status, tasks: [] }))
  const byId = new Map(columns.map((column) => [column.id, column]))
  for (const task of tasks) {
    const column = byId.get(task.status) ?? columns[0]
    column.tasks.push(task)
  }

  return columns
}
