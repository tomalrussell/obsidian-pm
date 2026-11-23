import {
  type FieldCatalog,
  type FilterContext,
  type FilterState,
  type Project,
  type Task,
  DEFAULT_PRIORITIES,
  DEFAULT_STATUSES,
  findTaskById,
  flattenTasks
} from '@dotpm/core'
import type { VaultIndex } from './VaultIndex'

/** What a project view renders. Carried in the view state, so a layout restores it. */
export type ScopeSpec =
  | { kind: 'project'; path: string }
  | { kind: 'folder'; path: string }
  | { kind: 'picked'; paths: string[] }
  | { kind: 'vault' }

/** Note paths can't hold `|`, so it separates the paths of a picked scope. */
export function scopeKey(spec: ScopeSpec): string {
  switch (spec.kind) {
    case 'vault':
      return 'vault'
    case 'picked':
      return `picked:${[...spec.paths].sort().join('|')}`
    default:
      return `${spec.kind}:${spec.path}`
  }
}

/** The project paths a spec covers, in the order the views should show them. */
export function resolveScopePaths(spec: ScopeSpec, index: VaultIndex): string[] {
  switch (spec.kind) {
    case 'project':
      return index.projectRef(spec.path) ? [spec.path] : []
    case 'folder': {
      const prefix = spec.path === '' ? '' : `${spec.path}/`
      return index.projectPaths().filter((path) => path.startsWith(prefix))
    }
    case 'picked':
      return spec.paths.filter((path) => index.projectRef(path))
    case 'vault':
      return index.projectPaths()
  }
}

/** A single selection is a project; multiple selections are an explicit set. */
export function selectionSpec(paths: string[]): ScopeSpec {
  return paths.length === 1 ? { kind: 'project', path: paths[0] } : { kind: 'picked', paths }
}

/**
 * The set of projects one view renders. Reading goes through the scope; writing goes to
 * the project that owns the task, which `projectOf` answers. The store still knows
 * nothing about scopes: every mutation it takes is against a single project.
 */
export class ProjectScope {
  constructor(
    readonly spec: ScopeSpec,
    readonly projects: Project[]
  ) {}

  get key(): string {
    return scopeKey(this.spec)
  }

  /** Where a new task goes, and whose settings stand in for the group's. */
  get primary(): Project | null {
    return this.projects[0] ?? null
  }

  get isMulti(): boolean {
    return this.projects.length > 1
  }

  label(): string {
    switch (this.spec.kind) {
      case 'project':
        return this.primary?.title ?? `Project`
      case 'folder':
        return this.spec.path.slice(this.spec.path.lastIndexOf('/') + 1) || `Vault`
      case 'picked':
        return this.projects.length === 1 ? `${this.projects.length} project` : `${this.projects.length} projects`
      case 'vault':
        return `All projects`
    }
  }

  /** Every project's top-level tasks, the projects kept in scope order. */
  tasks(): Task[] {
    if (!this.isMulti) return this.primary?.tasks ?? []
    return this.projects.flatMap((project) => project.tasks)
  }

  projectOf(taskId: string): Project | null {
    for (const project of this.projects) {
      if (project.taskIndex.has(taskId)) return project
    }
    return null
  }

  taskById(taskId: string): Task | null {
    const owner = this.projectOf(taskId)
    return owner ? findTaskById(owner, taskId) : null
  }

  /** Groups task ids by owning project, so a bulk action becomes one call per project. */
  groupByProject(taskIds: string[]): { project: Project; taskIds: string[] }[] {
    const groups = new Map<Project, string[]>()
    for (const id of taskIds) {
      const owner = this.projectOf(id)
      if (!owner) continue
      const bucket = groups.get(owner)
      if (bucket) bucket.push(id)
      else groups.set(owner, [id])
    }
    return [...groups].map(([project, ids]) => ({ project, taskIds: ids }))
  }

  /** What decides which fields a table, board card or timeline label can show. */
  fieldCatalog(): FieldCatalog {
    return { multi: this.isMulti }
  }

  /** What a filter condition needs to match the tasks in scope. */
  filterContext(): FilterContext {
    return {
      statuses: DEFAULT_STATUSES,
      projectOf: (task) => this.projectOf(task.id)?.id
    }
  }

  /** What the filter picker and the board's columns read: every task in scope and how to name its values. */
  filterSetup(filter: FilterState) {
    return {
      filter,
      tasks: flattenTasks(this.tasks()).map((flat) => flat.task),
      ctx: this.filterContext(),
      priorities: DEFAULT_PRIORITIES,
      projects: this.isMulti
        ? this.projects.map((project) => ({ id: project.id, title: project.title, color: project.color }))
        : []
    }
  }
}
