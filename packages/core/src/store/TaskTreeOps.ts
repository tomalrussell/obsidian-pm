import type { Task } from '../types'

export interface FlatTask {
  task: Task
  depth: number
  parentId: string | null
  /** False when an ancestor is collapsed. Every row is visible when no ids are given. */
  visible: boolean
}

export function flattenTasks(tasks: Task[], collapsedIds?: ReadonlySet<string>): FlatTask[] {
  const result: FlatTask[] = []
  const walk = (list: Task[], depth: number, parentId: string | null, hidden: boolean): void => {
    for (const task of list) {
      result.push({ task, depth, parentId, visible: !hidden })
      if (task.subtasks.length > 0) {
        walk(task.subtasks, depth + 1, task.id, hidden || collapsedIds?.has(task.id) === true)
      }
    }
  }
  walk(tasks, 0, null, false)
  return result
}

export function findTask(tasks: Task[], id: string): Task | null {
  for (const t of tasks) {
    if (t.id === id) return t
    const found = findTask(t.subtasks, id)
    if (found) return found
  }
  return null
}

export function updateTaskInTree(tasks: Task[], id: string, patch: Partial<Task>): boolean {
  for (const t of tasks) {
    if (t.id === id) {
      Object.assign(t, patch, { updatedAt: new Date().toISOString() })
      return true
    }
    if (updateTaskInTree(t.subtasks, id, patch)) return true
  }
  return false
}

export function deleteTaskFromTree(tasks: Task[], id: string): boolean {
  for (let i = 0; i < tasks.length; i++) {
    if (tasks[i].id === id) {
      tasks.splice(i, 1)
      return true
    }
    if (deleteTaskFromTree(tasks[i].subtasks, id)) return true
  }
  return false
}

export function addTaskToTree(tasks: Task[], newTask: Task, parentId: string | null): void {
  if (!parentId) {
    tasks.push(newTask)
    return
  }
  const parent = findTask(tasks, parentId)
  if (parent) parent.subtasks.push(newTask)
  else tasks.push(newTask)
}

/** Reorders among siblings only; the two tasks must share a parent. */
export function moveTaskInTree(tasks: Task[], taskId: string, targetId: string, position: 'before' | 'after'): boolean {
  const taskIdx = tasks.findIndex((t) => t.id === taskId)
  const targetIdx = tasks.findIndex((t) => t.id === targetId)
  if (taskIdx !== -1 && targetIdx !== -1) {
    const [task] = tasks.splice(taskIdx, 1)
    const insertIdx = tasks.findIndex((t) => t.id === targetId)
    tasks.splice(position === 'before' ? insertIdx : insertIdx + 1, 0, task)
    return true
  }
  for (const t of tasks) {
    if (moveTaskInTree(t.subtasks, taskId, targetId, position)) return true
  }
  return false
}

export function collectAllTags(tasks: Task[]): string[] {
  const set = new Set<string>()
  const walk = (list: Task[]) => {
    for (const t of list) {
      for (const tag of t.tags) set.add(tag)
      walk(t.subtasks)
    }
  }
  walk(tasks)
  return [...set].filter(Boolean).sort()
}
