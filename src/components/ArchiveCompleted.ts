import type PMPlugin from '#main'
import { type Project, today, isTerminalStatus } from '@dotpm/core'
import { type ArchiveCandidate, collectArchivable, withoutBlockedDependents } from '#store'

export interface ArchivePlan {
  project: Project
  rootIds: string[]
  tasks: number
}

/**
 * What archiving completed tasks would move: every task finished on or before today, with
 * its subtasks. The index says which projects hold one, so only those are loaded.
 * Dependencies are resolved across the whole plan rather than project by project, because
 * a task can wait on one in another project.
 */
export async function planArchive(plugin: PMPlugin, projectPaths: string[]): Promise<ArchivePlan[]> {
  const cutoff = today().toString()
  const complete = plugin.index.completeStatuses()
  const entries: { project: Project; candidate: ArchiveCandidate }[] = []
  for (const path of projectPaths) {
    const anyDone = plugin.index
      .taskRefs(path)
      .some((task) => !task.archived && complete.has(task.status) && !!task.completed && task.completed <= cutoff)
    if (!anyDone) continue

    const project = await plugin.store.loadProjectByPath(path)
    if (!project) continue
    const statuses = plugin.store.configFor(project).statuses
    for (const candidate of collectArchivable(project, (status) => isTerminalStatus(status, statuses), cutoff)) {
      entries.push({ project, candidate })
    }
  }

  const kept = new Set(
    withoutBlockedDependents(
      entries.map((entry) => entry.candidate),
      plugin.index
    ).map((candidate) => candidate.rootId)
  )

  const plans = new Map<Project, ArchivePlan>()
  for (const { project, candidate } of entries) {
    if (!kept.has(candidate.rootId)) continue
    const plan = plans.get(project) ?? { project, rootIds: [], tasks: 0 }
    plan.rootIds.push(candidate.rootId)
    plan.tasks += candidate.ids.length
    plans.set(project, plan)
  }
  return [...plans.values()]
}
