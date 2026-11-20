import type { CustomFieldDef, PMSettings, Project, ResolvedProjectConfig, Task } from '../types'
import { DEFAULT_PALETTE_COLOR, DEFAULT_STATUSES } from '../types'
import { flattenTasks } from './TaskTreeOps'

/**
 * Status options are fixed. Other settings use project overrides or global defaults.
 * In-use priorities missing from both palettes remain available as placeholder entries.
 * Custom fields combine global defaults with project declarations.
 */
export function resolveProjectConfig(project: Project, settings: PMSettings): ResolvedProjectConfig {
  const config = project.config
  return {
    customFields: resolveCustomFields(project, settings),
    statuses: DEFAULT_STATUSES,
    priorities: withInUseExtras(
      config?.priorities?.length ? config.priorities : settings.priorities,
      settings.priorities,
      project,
      (task) => task.priority,
      (id) => ({ id, label: id, color: DEFAULT_PALETTE_COLOR, icon: '' })
    ),
    priorityIcons: config?.priorityIcons ?? settings.priorityIcons,
    defaultView: config?.defaultView ?? settings.defaultView,
    autoSchedule: config?.autoSchedule ?? settings.autoSchedule,
    pullForwardOnEarlyFinish: config?.pullForwardOnEarlyFinish ?? settings.pullForwardOnEarlyFinish,
    autoArchiveDays: config?.autoArchiveDays ?? settings.autoArchiveDays,
    showSubtreeConnections: config?.showSubtreeConnections ?? settings.showSubtreeConnections,
    lineBorders: config?.lineBorders ?? settings.lineBorders
  }
}

/** Later lists win on a repeated id, keeping the position the first one gave it. */
export function mergeById<T extends { id: string }>(lists: T[][]): T[] {
  const merged: T[] = []
  const positions = new Map<string, number>()
  for (const list of lists) {
    for (const entry of list) {
      const at = positions.get(entry.id)
      if (at === undefined) {
        positions.set(entry.id, merged.length)
        merged.push(entry)
      } else {
        merged[at] = entry
      }
    }
  }
  return merged
}

function resolveCustomFields(project: Project, settings: PMSettings): CustomFieldDef[] {
  const fields = mergeById([settings.customFields, project.customFields])
  const hidden = project.config?.hiddenCustomFields
  if (!hidden?.length) return fields
  const own = new Set(project.customFields.map((field) => field.id))
  return fields.filter((field) => own.has(field.id) || !hidden.includes(field.id))
}

function withInUseExtras<T extends { id: string }>(
  own: T[],
  global: T[],
  project: Project,
  valueOf: (task: Task) => string,
  makeFallback: (id: string) => T
): T[] {
  const known = new Set(own.map((entry) => entry.id))
  let extras: T[] | null = null
  for (const { task } of flattenTasks(project.tasks)) {
    const id = valueOf(task)
    if (known.has(id)) continue
    known.add(id)
    extras ??= []
    extras.push(global.find((entry) => entry.id === id) ?? makeFallback(id))
  }
  return extras ? [...own, ...extras] : own
}
