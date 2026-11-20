import type { Task } from '../types'
import { flattenTasks } from './TaskTreeOps'

/** Predecessor id -> ids of the tasks waiting on it. */
export function dependentsFromTasks(tasks: Task[]): Map<string, string[]> {
  const dependentsOf = new Map<string, string[]>()
  for (const ft of flattenTasks(tasks)) {
    for (const depId of ft.task.dependencies) {
      const list = dependentsOf.get(depId)
      if (list) list.push(ft.task.id)
      else dependentsOf.set(depId, [ft.task.id])
    }
  }
  return dependentsOf
}

/** Can `fromId` reach `toId` by following dependents? */
export function reaches(dependentsOf: Map<string, string[]>, fromId: string, toId: string): boolean {
  const visited = new Set<string>()
  const queue = [fromId]
  while (queue.length > 0) {
    const current = queue.shift()
    if (current === undefined) break
    if (current === toId) return true
    if (visited.has(current)) continue
    visited.add(current)
    for (const next of dependentsOf.get(current) ?? []) {
      queue.push(next)
    }
  }
  return false
}

/**
 * Would making `from` depend on `to` close a cycle? "from depends on to" is the edge
 * to -> from, so yes exactly when `from` can already reach `to`.
 */
export function wouldCreateCycle(tasks: Task[], fromId: string, toId: string): boolean {
  return reaches(dependentsFromTasks(tasks), fromId, toId)
}
