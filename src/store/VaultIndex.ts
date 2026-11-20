import type { App, Plugin, TAbstractFile } from 'obsidian'
import { TFile, normalizePath } from 'obsidian'
import {
  type CustomFieldDef,
  type PMSettings,
  DEFAULT_STATUSES,
  today,
  reaches,
  FRONTMATTER_KEY,
  TASK_FRONTMATTER_KEY,
  customFieldList,
  stringList,
  DEFAULT_PROJECT_COLOR,
  readColor
} from '@dotpm/core'
import { projectPathForTaskPath } from './vaultFs'
import { isRefLink, refToId, refToPath } from './refs'

export interface ProjectRef {
  path: string
  id: string
  title: string
  icon: string
  color: string
  /** The note's `tags` property, without the leading `#`. */
  tags: string[]
  /** The custom fields this project declares. */
  customFields: CustomFieldDef[]
  /** Whether this project is archived. */
  archived: boolean
  /** Days before a completed task is archived. Null inherits the global setting. */
  autoArchiveDays: number | null
}

export interface TaskRef {
  id: string
  path: string
  projectId: string
  projectPath: string | null
  title: string
  status: string
  priority: string
  start: string
  due: string
  completed: string
  dependencies: string[]
  archived: boolean
}

function str(raw: unknown, fallback = ''): string {
  return typeof raw === 'string' ? raw : fallback
}

/** A project note dropped inside a project's task storage is task storage, not a project. */
function insideTaskFolder(path: string): boolean {
  const parts = path.split('/')
  parts.pop()
  return parts.some((segment) => segment.endsWith('_tasks'))
}

function projectConfigOf(frontmatter: Record<string, unknown>): Record<string, unknown> | null {
  const config = frontmatter.config
  return config && typeof config === 'object' ? (config as Record<string, unknown>) : null
}

function ownAutoArchiveDays(frontmatter: Record<string, unknown>): number | null {
  const days = projectConfigOf(frontmatter)?.autoArchiveDays
  return typeof days === 'number' && Number.isFinite(days) && days >= 0 ? Math.floor(days) : null
}

/**
 * Every `pm-project` and `pm-task` note in the vault, read from the metadata cache and
 * kept current by its events. Nothing here reads a file body, so a whole-vault sweep
 * costs one pass over frontmatter Obsidian has already parsed.
 *
 * This is what makes project location irrelevant: discovery is by frontmatter, and a
 * task's owning project is resolved here rather than by pattern-matching paths at each
 * call site.
 */
export class VaultIndex {
  private projects = new Map<string, ProjectRef>()
  private projectPathById = new Map<string, string>()
  private tasks = new Map<string, TaskRef>()
  private taskById = new Map<string, TaskRef>()
  private tasksByProject = new Map<string, Set<string>>()
  private changeHandlers = new Set<() => void>()
  private cachedDependents = new Map<string, string[]>()
  private dependentsDirty = true
  /** False until the first build, so a view can tell "none yet" from "none at all". */
  ready = false

  constructor(
    private app: App,
    private getSettings: () => PMSettings
  ) {}

  /** Call once, after the layout is ready. Safe to call again to recover from a bad state. */
  build(): void {
    this.projects.clear()
    this.projectPathById.clear()
    this.tasks.clear()
    this.taskById.clear()
    this.tasksByProject.clear()
    this.dependentsDirty = true
    for (const file of this.app.vault.getMarkdownFiles()) this.read(file)
    this.resolveUnowned()
    this.ready = true
    this.emitChange()
  }

  register(plugin: Plugin, onFirstResolve?: () => void): void {
    // On a cold start the metadata cache is still filling when the layout is ready, so
    // the first build can see an empty vault. 'resolved' is Obsidian saying it caught up;
    // after that, 'changed' keeps the index current on its own.
    const onResolved = this.app.metadataCache.on('resolved', () => {
      this.build()
      this.app.metadataCache.offref(onResolved)
      onFirstResolve?.()
    })
    plugin.registerEvent(onResolved)

    plugin.registerEvent(
      this.app.metadataCache.on('changed', (file) => {
        this.read(file)
        this.resolveUnowned()
        this.emitChange()
      })
    )
    plugin.registerEvent(
      this.app.metadataCache.on('deleted', (file) => {
        if (this.forget(file.path)) this.emitChange()
      })
    )
    plugin.registerEvent(
      this.app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
        // The metadata cache is not keyed by the new path yet when this fires, and a
        // renamed folder reports nothing about the notes inside it, so whatever is already
        // indexed moves by path here rather than being read back from the cache.
        if (!(file instanceof TFile)) {
          if (this.rekeyFolder(oldPath, file.path)) this.emitChange()
          return
        }
        if (this.rekeyFile(oldPath, file.path)) {
          this.resolveUnowned()
          this.emitChange()
          return
        }
        this.read(file)
        this.resolveUnowned()
        if (this.tasks.has(file.path) || this.projects.has(file.path)) this.emitChange()
      })
    )
  }

  onChange(handler: () => void): () => void {
    this.changeHandlers.add(handler)
    return () => this.changeHandlers.delete(handler)
  }

  /** Archived projects are left out unless asked for, so a list that forgets shows less, not more. */
  projectRefs(includeArchived = false): ProjectRef[] {
    return [...this.projects.values()]
      .filter((ref) => includeArchived || !ref.archived)
      .sort((a, b) => (a.title < b.title ? -1 : a.title > b.title ? 1 : 0))
  }

  isArchived(path: string): boolean {
    return this.projectRef(path)?.archived === true
  }

  /** Tasks past due and the last date anything is due, without loading the project. */
  dueSummary(ref: ProjectRef): { overdue: number; latestDue: string } {
    const complete = this.completeStatuses()
    const now = today().toString()
    let overdue = 0
    let latestDue = ''
    for (const task of this.countableTasks(ref)) {
      if (!task.due) continue
      if (task.due > latestDue) latestDue = task.due
      if (task.due < now && !complete.has(task.status)) overdue++
    }
    return { overdue, latestDue }
  }

  projectRef(path: string): ProjectRef | null {
    return this.projects.get(normalizePath(path)) ?? null
  }

  projectPaths(includeArchived = false): string[] {
    return this.projectRefs(includeArchived).map((ref) => ref.path)
  }

  taskRefs(projectPath: string): TaskRef[] {
    const paths = this.tasksByProject.get(normalizePath(projectPath))
    if (!paths) return []
    const refs: TaskRef[] = []
    for (const path of paths) {
      const ref = this.tasks.get(path)
      if (ref) refs.push(ref)
    }
    return refs
  }

  /** The fixed statuses that count as finished. */
  completeStatuses(): Set<string> {
    return new Set(DEFAULT_STATUSES.filter((status) => status.complete).map((status) => status.id))
  }

  /** One task per id, archived ones left out, so counts match what the project's views show. */
  private countableTasks(ref: ProjectRef): TaskRef[] {
    const seen = new Set<string>()
    const tasks: TaskRef[] = []
    for (const task of this.taskRefs(ref.path)) {
      if (task.archived || seen.has(task.id)) continue
      seen.add(task.id)
      tasks.push(task)
    }
    return tasks
  }

  /** Task totals for a project row, without loading the project. */
  counts(ref: ProjectRef): { total: number; done: number } {
    const complete = this.completeStatuses()
    let total = 0
    let done = 0
    for (const task of this.countableTasks(ref)) {
      total++
      if (complete.has(task.status)) done++
    }
    return { total, done }
  }

  /**
   * A task anywhere in the vault. This is what lets a dependency point outside its own
   * project: ids are resolved here rather than inside one project's tree.
   */
  task(taskId: string): TaskRef | null {
    return this.taskById.get(taskId) ?? null
  }

  allTaskRefs(): TaskRef[] {
    return [...this.tasks.values()]
  }

  /**
   * Would making `fromId` depend on `toId` close a cycle, following dependencies wherever
   * they lead? The graph spans projects, so a cycle can too.
   */
  wouldCreateCycle(fromId: string, toId: string): boolean {
    return reaches(this.dependentsMap(), fromId, toId)
  }

  /** Tasks anywhere in the vault that list this one as a dependency. */
  dependents(taskId: string): TaskRef[] {
    return [...this.tasks.values()].filter((ref) => ref.dependencies.includes(taskId))
  }

  /** Predecessor id -> ids of everything waiting on it, across every project. */
  dependentsMap(): Map<string, string[]> {
    if (!this.dependentsDirty) return this.cachedDependents
    const map = new Map<string, string[]>()
    for (const ref of this.tasks.values()) {
      for (const depId of ref.dependencies) {
        const list = map.get(depId)
        if (list) list.push(ref.id)
        else map.set(depId, [ref.id])
      }
    }
    this.cachedDependents = map
    this.dependentsDirty = false
    return map
  }

  /**
   * Task ids that notes in more than one project claim, id to every ref holding it.
   * This is what a project folder copied on disk looks like: the copy keeps every id
   * of the original. A repeated id inside one project doesn't count; an archived task
   * and its replacement can share one legitimately.
   */
  findTaskIdCollisions(): Map<string, TaskRef[]> {
    const byId = new Map<string, TaskRef[]>()
    for (const ref of this.tasks.values()) {
      if (!ref.projectPath) continue
      const list = byId.get(ref.id)
      if (list) list.push(ref)
      else byId.set(ref.id, [ref])
    }
    const collisions = new Map<string, TaskRef[]>()
    for (const [id, refs] of byId) {
      if (new Set(refs.map((ref) => ref.projectPath)).size > 1) collisions.set(id, refs)
    }
    return collisions
  }

  /** Project ids more than one project note claims. */
  findProjectIdCollisions(): Map<string, ProjectRef[]> {
    const byId = new Map<string, ProjectRef[]>()
    for (const ref of this.projects.values()) {
      const list = byId.get(ref.id)
      if (list) list.push(ref)
      else byId.set(ref.id, [ref])
    }
    const collisions = new Map<string, ProjectRef[]>()
    for (const [id, refs] of byId) {
      if (refs.length > 1) collisions.set(id, refs)
    }
    return collisions
  }

  /** The project owning a task note, by location first and by its `projectId` when it moved. */
  projectPathForTask(taskPath: string): string | null {
    return this.tasks.get(normalizePath(taskPath))?.projectPath ?? this.resolveOwner(normalizePath(taskPath), '')
  }

  private read(file: TFile): void {
    const path = normalizePath(file.path)
    const cache = this.app.metadataCache.getFileCache(file)
    // No cache entry at all means Obsidian has not caught up with this path yet, which is
    // where a rename leaves it. Keep what is indexed rather than dropping the note.
    if (!cache) return
    this.forget(path)
    if (this.isExcluded(path)) return
    const frontmatter = cache.frontmatter
    if (!frontmatter) return
    if (frontmatter[FRONTMATTER_KEY] === true && !insideTaskFolder(path)) this.addProject(path, file, frontmatter)
    else if (frontmatter[TASK_FRONTMATTER_KEY] === true) this.addTask(path, frontmatter)
  }

  private addProject(path: string, file: TFile, frontmatter: Record<string, unknown>): void {
    const ref: ProjectRef = {
      path,
      id: str(frontmatter.id, file.basename),
      title: str(frontmatter.title, file.basename),
      icon: str(frontmatter.icon, '\u{1F4CB}'),
      color: readColor(frontmatter.color) ?? DEFAULT_PROJECT_COLOR,
      tags: (typeof frontmatter.tags === 'string' ? frontmatter.tags.split(/[\s,]+/) : stringList(frontmatter.tags))
        .map((tag) => tag.replace(/^#/, ''))
        .filter(Boolean),
      customFields: customFieldList(frontmatter.customFields),
      archived: frontmatter.archived === true,
      autoArchiveDays: ownAutoArchiveDays(frontmatter)
    }
    this.projects.set(path, ref)
    this.projectPathById.set(ref.id, path)
  }

  private addTask(path: string, frontmatter: Record<string, unknown>): void {
    const projectId = str(frontmatter.projectId)
    const ref: TaskRef = {
      id: str(frontmatter.id, path),
      path,
      projectId,
      projectPath: this.resolveOwner(path, projectId),
      title: str(frontmatter.title, `Untitled`),
      status: str(frontmatter.status, 'capture'),
      priority: str(frontmatter.priority, 'medium'),
      start: str(frontmatter.start),
      due: str(frontmatter.due),
      completed: str(frontmatter.completed),
      dependencies: stringList(frontmatter.dependencies).map((raw) => refToId(this.app, raw, path)),
      archived: path.split('/').at(-2) === 'Archive'
    }
    this.tasks.set(path, ref)
    this.taskById.set(ref.id, ref)
    this.dependentsDirty = true
    this.own(ref)
  }

  /**
   * Location wins: a task note lives in its project's `_tasks/` folder, which resolves
   * whatever order the files are indexed in. `projectId` covers a note moved out of it.
   */
  private resolveOwner(taskPath: string, projectRef: string): string | null {
    const byLocation = projectPathForTaskPath(taskPath)
    if (byLocation) return byLocation
    if (!projectRef) return null
    return isRefLink(projectRef)
      ? refToPath(this.app, projectRef, taskPath)
      : (this.projectPathById.get(projectRef) ?? null)
  }

  /** A task indexed before its project can only be placed once that project shows up. */
  private resolveUnowned(): void {
    for (const ref of this.tasks.values()) {
      if (ref.projectPath !== null) continue
      const owner = this.resolveOwner(ref.path, ref.projectId)
      if (!owner) continue
      ref.projectPath = owner
      this.own(ref)
    }
  }

  private own(ref: TaskRef): void {
    if (!ref.projectPath) return
    let bucket = this.tasksByProject.get(ref.projectPath)
    if (!bucket) {
      bucket = new Set()
      this.tasksByProject.set(ref.projectPath, bucket)
    }
    bucket.add(ref.path)
  }

  /** Moves an indexed note to its new path. False when the path held nothing indexed. */
  private rekeyFile(oldPath: string, newPath: string): boolean {
    const from = normalizePath(oldPath)
    const to = normalizePath(newPath)
    const project = this.projects.get(from)
    const task = this.tasks.get(from)
    if (!project && !task) return false
    this.forget(from)
    if (this.isExcluded(to)) return true
    if (project) {
      project.path = to
      this.projects.set(to, project)
      this.projectPathById.set(project.id, to)
      this.reownTasks(from, to)
      return true
    }
    if (task) {
      task.path = to
      task.projectPath = this.resolveOwner(to, task.projectId)
      task.archived = to.split('/').at(-2) === 'Archive'
      this.tasks.set(to, task)
      this.taskById.set(task.id, task)
      this.own(task)
    }
    return true
  }

  /** Moves everything indexed under a renamed folder to its new path. */
  private rekeyFolder(oldPath: string, newPath: string): boolean {
    const from = normalizePath(oldPath) + '/'
    const to = normalizePath(newPath) + '/'
    const projects = [...this.projects.values()].filter((ref) => ref.path.startsWith(from))
    const tasks = [...this.tasks.values()].filter((ref) => ref.path.startsWith(from))
    if (!projects.length && !tasks.length) return false
    // Projects first: a task's owner is resolved from the folder it now sits in.
    for (const ref of projects) {
      this.forget(ref.path)
      ref.path = to + ref.path.slice(from.length)
      this.projects.set(ref.path, ref)
      this.projectPathById.set(ref.id, ref.path)
    }
    for (const ref of tasks) {
      this.forget(ref.path)
      ref.path = to + ref.path.slice(from.length)
      ref.projectPath = this.resolveOwner(ref.path, ref.projectId)
      ref.archived = ref.path.split('/').at(-2) === 'Archive'
      this.tasks.set(ref.path, ref)
      this.taskById.set(ref.id, ref)
      this.own(ref)
    }
    return true
  }

  /**
   * Task notes keep their own paths when their project note is renamed, so ownership has
   * to follow the project rather than wait for each of them to be read again.
   */
  private reownTasks(oldProjectPath: string, newProjectPath: string): boolean {
    const from = normalizePath(oldProjectPath)
    const to = normalizePath(newProjectPath)
    const bucket = this.tasksByProject.get(from)
    if (!bucket || !this.projects.has(to)) return false
    this.tasksByProject.delete(from)
    for (const taskPath of bucket) {
      const ref = this.tasks.get(taskPath)
      if (ref) ref.projectPath = to
    }
    this.tasksByProject.set(to, bucket)
    return true
  }

  /** Drops whatever was indexed at a path. Reports whether anything was. */
  private forget(path: string): boolean {
    const normalized = normalizePath(path)
    const task = this.tasks.get(normalized)
    if (task) {
      this.tasks.delete(normalized)
      if (this.taskById.get(task.id) === task) this.taskById.delete(task.id)
      if (task.projectPath) this.tasksByProject.get(task.projectPath)?.delete(normalized)
      this.dependentsDirty = true
      return true
    }
    const project = this.projects.get(normalized)
    if (project) {
      this.projects.delete(normalized)
      if (this.projectPathById.get(project.id) === normalized) this.projectPathById.delete(project.id)
      return true
    }
    return false
  }

  private isExcluded(path: string): boolean {
    return this.getSettings().excludedFolders.some((folder) => {
      const normalized = normalizePath(folder)
      return normalized !== '' && (path === normalized || path.startsWith(normalized + '/'))
    })
  }

  private emitChange(): void {
    for (const handler of this.changeHandlers) handler()
  }
}
