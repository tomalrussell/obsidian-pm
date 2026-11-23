import { MarkdownView, Plugin, WorkspaceLeaf } from 'obsidian'
import {
  DEFAULT_SETTINGS,
  defaultPriorities,
  defaultStatuses,
  hydrateFilter,
  hydrateFields,
  hydrateSort,
  legacyBoardFields,
  type PMSettings,
  type Project,
  type Task,
  flattenTasks,
  setDateFormat
} from '@dotpm/core'
import { ProjectStore, VaultIndex, type ProjectRef } from './store'
import { safeAsync } from '@dotpm/ui'
import { installObsidianPlatform } from './platform'
import { PMSettingTab } from './settings'
import { ProjectView, PM_PROJECT_VIEW_TYPE } from './views/ProjectView'
import { ProjectOverviewView, PM_PROJECT_OVERVIEW_VIEW_TYPE } from './views/ProjectOverviewView'
import { ProjectEditView, PM_PROJECT_EDIT_VIEW_TYPE } from './views/ProjectEditView'
import { DashboardView, PM_DASHBOARD_VIEW_TYPE } from './views/DashboardView'
import { TaskView, PM_TASK_VIEW_TYPE } from './views/TaskView'
import { PMViewRouter } from './views/PMViewRouter'
import {
  openTaskModal,
  openProjectCreate,
  openProjectPicker,
  openTaskPicker,
  openImportModal,
  confirmDialog
} from './ui/ModalFactory'
import { AutoArchiver } from './components/AutoArchiver'
import { IdRepair } from './components/IdRepair'
import { migrateBoardCardConfig, migrateProjects, migrateProjectLayout, migrateTaskRefs } from './migration'

export default class PMPlugin extends Plugin {
  settings: PMSettings = { ...DEFAULT_SETTINGS }
  store!: ProjectStore
  index!: VaultIndex
  autoArchiver!: AutoArchiver
  idRepair!: IdRepair
  router!: PMViewRouter
  private viewRefreshScheduled = false
  undoStack: Array<{ undo: () => Promise<void>; redo: () => Promise<void> }> = []
  redoStack: Array<{ undo: () => Promise<void>; redo: () => Promise<void> }> = []

  pushUndo(entry: { undo: () => Promise<void>; redo: () => Promise<void> }): void {
    this.undoStack.push(entry)
    if (this.undoStack.length > 20) this.undoStack.shift()
    this.redoStack = []
  }

  async undoLastAction(): Promise<void> {
    const entry = this.undoStack.pop()
    if (entry) {
      await entry.undo()
      this.redoStack.push(entry)
    }
  }

  async redoLastAction(): Promise<void> {
    const entry = this.redoStack.pop()
    if (entry) {
      await entry.redo()
      this.undoStack.push(entry)
    }
  }

  async onload(): Promise<void> {
    installObsidianPlatform()
    await this.loadSettings()
    setDateFormat(this.settings.dateFormat)
    this.index = new VaultIndex(this.app, () => this.settings)
    // The first sweep can run against a half-filled metadata cache, so it runs again once
    // the index has caught up. Everything in it is safe to repeat.
    this.index.register(this, () => {
      void this.startupSweep()
    })
    this.store = new ProjectStore(this.app, () => this.settings, this.index)
    this.store.registerVaultSync(this)
    this.autoArchiver = new AutoArchiver(this)
    this.idRepair = new IdRepair(this)
    this.router = new PMViewRouter(this)
    this.registerView(PM_PROJECT_VIEW_TYPE, (leaf) => new ProjectView(leaf, this))
    this.registerView(PM_PROJECT_OVERVIEW_VIEW_TYPE, (leaf) => new ProjectOverviewView(leaf, this))
    this.registerView(PM_PROJECT_EDIT_VIEW_TYPE, (leaf) => new ProjectEditView(leaf, this))
    this.registerView(PM_DASHBOARD_VIEW_TYPE, (leaf) => new DashboardView(leaf, this))
    this.registerView(PM_TASK_VIEW_TYPE, (leaf) => new TaskView(leaf, this))

    this.app.workspace.onLayoutReady(
      safeAsync(async () => {
        this.index.build()
        await this.startupSweep()
      })
    )

    this.addRibbonIcon('chart-gantt', `Project manager`, async () => {
      await this.router.openDashboard()
    })

    this.addCommand({
      id: 'open-projects',
      name: `Open projects pane`,
      callback: () => {
        void this.router.openDashboard()
      }
    })

    this.addCommand({
      id: 'new-project',
      name: `Create new project`,
      callback: () => {
        openProjectCreate(this)
      }
    })

    this.addCommand({
      id: 'new-task',
      name: `Create new task`,
      callback: () => {
        this.pickProjectThenCreateTask(null)
      }
    })

    this.addCommand({
      id: 'new-subtask',
      name: `Create new subtask`,
      callback: () => {
        this.pickProjectThenCreateTask('pick-parent')
      }
    })

    this.addCommand({
      id: 'undo-last-action',
      name: `Undo last action`,
      callback: () => {
        void this.undoLastAction()
      }
    })

    this.addCommand({
      id: 'redo-last-action',
      name: `Redo last action`,
      callback: () => {
        void this.redoLastAction()
      }
    })

    this.addCommand({
      id: 'open-all-projects',
      name: `Open all projects in one view`,
      callback: () => {
        void this.router.openScope({ kind: 'vault' })
      }
    })

    this.addCommand({
      id: 'rebuild-project-index',
      name: `Rebuild project index`,
      callback: () => {
        this.index.build()
      }
    })

    this.addCommand({
      id: 'archive-completed-tasks',
      name: `Archive completed tasks`,
      callback: () => {
        void this.archiveCompletedTasks()
      }
    })

    this.addCommand({
      id: 'import-notes-as-tasks',
      name: `Import notes as tasks`,
      callback: () => {
        this.importNotes()
      }
    })

    this.addCommand({
      id: 'create-task-from-selection',
      name: `Create task from selection`,
      editorCheckCallback: (checking, editor) => {
        const selection = editor.getSelection().trim()
        if (!selection) return false
        if (checking) return true
        this.createTaskFromText(selection)
        return true
      }
    })

    this.registerEvent(
      this.app.workspace.on('editor-menu', (menu, editor) => {
        const selection = editor.getSelection().trim()
        if (!selection) return
        menu.addItem((item) =>
          item
            .setTitle(`Create task from selection`)
            .setIcon('list-plus')
            .onClick(() => this.createTaskFromText(selection))
        )
      })
    )

    this.addCommand({
      id: 'open-current-as-project',
      name: `Open current file as project`,
      checkCallback: (checking: boolean) => {
        const md = this.app.workspace.getActiveViewOfType(MarkdownView)
        const file = md?.file
        if (!file) return false
        const cache = this.app.metadataCache.getFileCache(file)
        if (cache?.frontmatter?.['pm-project'] !== true) return false
        if (checking) return true
        void this.router.openProjectLink(file.path, md.leaf)
        return true
      }
    })

    this.addSettingTab(new PMSettingTab(this.app, this))
    this.autoArchiver.start()
    this.idRepair.start()
  }

  /** Opens a note in Obsidian's own editor, in a new tab unless given a leaf. */
  async openAsMarkdown(path: string, leaf?: WorkspaceLeaf): Promise<void> {
    const file = this.app.vault.getFileByPath(path)
    if (!file) return
    const target = leaf ?? this.app.workspace.getLeaf('tab')
    await target.openFile(file)
  }

  async loadSettings(): Promise<void> {
    const saved = (await this.loadData()) as Partial<PMSettings> | null
    // Cloned: a shallow merge would hand the live settings the very arrays and objects
    // DEFAULT_SETTINGS holds, and the first edit would write into the defaults.
    this.settings = Object.assign(structuredClone(DEFAULT_SETTINGS), saved ?? {})
    Reflect.deleteProperty(this.settings, 'peopleFolder')
    Reflect.deleteProperty(this.settings, 'globalTeamMembers')
    for (const key of [
      'localApiEnabled',
      'localApiPort',
      'localApiToken',
      'collapsedProjects',
      'customFields',
      'notificationsEnabled',
      'notificationLeadDays',
      'autoSchedule',
      'pullForwardOnEarlyFinish',
      'scopeViews',
      'projectListViews'
    ]) {
      Reflect.deleteProperty(this.settings, key)
    }
    Reflect.deleteProperty(this.settings.projectList, 'activeViewId')
    this.settings.statuses = defaultStatuses()
    this.settings.priorities = defaultPriorities()
    this.settings.priorityIcons = 'chevrons'
    if (!this.settings.projectFilters) this.settings.projectFilters = {}
    if (!this.settings.collapsedTasks) this.settings.collapsedTasks = {}
    if (!this.settings.excludedFolders) this.settings.excludedFolders = []

    let migrated = [
      'localApiEnabled',
      'localApiPort',
      'localApiToken',
      'collapsedProjects',
      'customFields',
      'notificationsEnabled',
      'notificationLeadDays',
      'autoSchedule',
      'pullForwardOnEarlyFinish',
      'scopeViews',
      'projectListViews'
    ].some((key) => saved && key in saved)
    // Filters were keyed by project path before a view could cover several projects.
    for (const key of Object.keys(this.settings.projectFilters)) {
      if (key.includes(':')) continue
      this.settings.projectFilters[`project:${key}`] = this.settings.projectFilters[key]
      Reflect.deleteProperty(this.settings.projectFilters, key)
      migrated = true
    }

    // Sort was held by the table alone and had one key, the timeline scale was one setting
    // for every view, a filter was a fixed set of facets before it became conditions, and
    // what a board card shows was two settings.
    const legacyBoard = (saved ?? {}) as { kanbanShowSubtasks?: boolean; kanbanShowDescriptionPreview?: boolean }
    const legacyBoardKeys = ['kanbanShowSubtasks', 'kanbanShowDescriptionPreview']
    if (legacyBoardKeys.some((key) => key in this.settings)) {
      this.settings.defaultFields = legacyBoardFields(
        !!legacyBoard.kanbanShowSubtasks,
        !!legacyBoard.kanbanShowDescriptionPreview
      )
      for (const key of legacyBoardKeys) Reflect.deleteProperty(this.settings, key)
      migrated = true
    }
    const defaultFields = hydrateFields(this.settings.defaultFields)
    if (JSON.stringify(defaultFields) !== JSON.stringify(this.settings.defaultFields)) {
      this.settings.defaultFields = defaultFields
      migrated = true
    }
    for (const entry of Object.values(this.settings.projectFilters)) {
      for (const key of ['activeSavedViewId', 'group']) {
        if (key in entry) {
          Reflect.deleteProperty(entry, key)
          migrated = true
        }
      }
      const normalized = {
        filter: hydrateFilter(entry.filter),
        fields: hydrateFields(entry.fields ?? this.settings.defaultFields)
      }
      if (JSON.stringify(normalized) !== JSON.stringify({ filter: entry.filter, fields: entry.fields })) {
        Object.assign(entry, normalized)
        migrated = true
      }
      if (!Array.isArray(entry.sort)) {
        entry.sort = hydrateSort(entry as unknown as Record<string, unknown>)
        Reflect.deleteProperty(entry, 'sortKey')
        Reflect.deleteProperty(entry, 'sortDir')
        migrated = true
      }
      if (!entry.ganttGranularity) {
        entry.ganttGranularity = this.settings.ganttGranularity
        migrated = true
      }
    }

    // ganttHideDone was a global toggle, now expressed as a per-project status filter.
    const legacy = (saved ?? {}) as { ganttHideDone?: boolean }
    if (legacy.ganttHideDone === true) {
      const nonTerminal = this.settings.statuses.filter((s) => !s.complete).map((s) => s.id)
      for (const entry of Object.values(this.settings.projectFilters)) {
        if (!entry.filter.conditions.some((condition) => condition.field === 'status')) {
          entry.filter.conditions.push({ field: 'status', op: 'any', value: nonTerminal })
        }
      }
      migrated = true
    }

    if (migrated) await this.saveSettings()
  }

  /**
   * A scope key is `vault`, or a kind and a path. Only the path-bearing ones can go
   * stale, and a key that names no path at all is kept rather than guessed at.
   */
  private scopeKeyResolves(key: string): boolean {
    if (key.startsWith('subtree:')) return false
    const separator = key.indexOf(':')
    if (separator === -1) return true
    return key
      .slice(separator + 1)
      .split('|')
      .every((path) => path === '' || this.app.vault.getAbstractFileByPath(path) !== null)
  }

  /** Archives or restores this project. */
  async setProjectArchived(path: string, archived: boolean): Promise<void> {
    const project = await this.store.loadProjectByPath(path)
    if (!project) return
    await this.store.updateProject(project, { archived: archived || undefined })
  }

  /** A project with no window of its own archives everything it has finished. */
  private async archiveCompletedTasks(): Promise<void> {
    const scoped = this.app.workspace.getActiveViewOfType(ProjectView)?.projectScope?.projects.map((p) => p.filePath)
    const plans = await this.autoArchiver.plan(scoped?.length ? scoped : this.index.projectPaths(), true)
    const tasks = plans.reduce((sum, plan) => sum + plan.tasks, 0)
    if (!tasks) {
      return
    }
    const ok = await confirmDialog(
      this.app,
      tasks === 1
        ? `Archive ${tasks} completed task in ${plans.length === 1 ? `${plans.length} project` : `${plans.length} projects`}?`
        : `Archive ${tasks} completed tasks in ${plans.length === 1 ? `${plans.length} project` : `${plans.length} projects`}?`,
      `Archive`
    )
    if (!ok) return
    await this.autoArchiver.apply(plans)
  }

  /** The startup work that reads the index: migration, pruning, and the archive sweep. */
  private async startupSweep(): Promise<void> {
    await migrateProjects(this)
    await migrateProjectLayout(this)
    await migrateTaskRefs(this)
    await migrateBoardCardConfig(this)
    await this.idRepair.check()
    await this.cleanupStaleProjectFilters()
    await this.autoArchiver.check()
  }

  async cleanupStaleProjectFilters(): Promise<void> {
    const filters = this.settings.projectFilters
    const cleaned: typeof filters = {}
    let dirty = false
    for (const [key, entry] of Object.entries(filters)) {
      if (this.scopeKeyResolves(key)) {
        cleaned[key] = entry
      } else {
        dirty = true
      }
    }
    const cleanedCollapsed: typeof this.settings.collapsedTasks = {}
    for (const [path, ids] of Object.entries(this.settings.collapsedTasks)) {
      if (!this.app.vault.getAbstractFileByPath(path)) {
        dirty = true
        continue
      }
      // Only a project the index has tasks for can show that a collapsed id is gone.
      const known = this.index.taskRefs(path)
      if (!known.length) {
        cleanedCollapsed[path] = ids
        continue
      }
      const live = new Set(known.map((ref) => ref.id))
      const kept = ids.filter((id) => live.has(id))
      if (kept.length !== ids.length) dirty = true
      cleanedCollapsed[path] = kept
    }
    if (dirty) {
      this.settings.projectFilters = cleaned
      this.settings.collapsedTasks = cleanedCollapsed
      await this.saveSettings()
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings)
  }

  /**
   * A settings edit changed a palette or how a view draws itself. Nothing in the vault
   * moved, so the store's own change events say nothing about it. Coalesced, because a
   * list editor persists on every keystroke.
   */
  refreshViews(): void {
    if (this.viewRefreshScheduled) return
    this.viewRefreshScheduled = true
    window.setTimeout(() => {
      this.viewRefreshScheduled = false
      for (const leaf of this.app.workspace.getLeavesOfType(PM_PROJECT_VIEW_TYPE)) {
        if (leaf.view instanceof ProjectView) leaf.view.redraw()
      }
      for (const leaf of this.app.workspace.getLeavesOfType(PM_DASHBOARD_VIEW_TYPE)) {
        if (leaf.view instanceof DashboardView) leaf.view.render()
      }
    }, 0)
  }

  /**
   * Offers every project in the vault, loading only the one chosen. `autoSelectSingle`
   * skips a picker that would have exactly one entry.
   */
  private pickProject(onChoose: (project: Project) => void, autoSelectSingle: boolean): void {
    const refs = this.index.projectRefs()
    if (!refs.length) {
      return
    }
    const choose = (ref: ProjectRef): void => {
      void (async () => {
        const project = await this.store.loadProjectByPath(ref.path)
        if (!project) {
          return
        }
        onChoose(project)
      })()
    }
    if (autoSelectSingle && refs.length === 1) choose(refs[0])
    else openProjectPicker(this, refs, choose)
  }

  /** Picks a project, then a parent when creating a subtask, before opening the editor. */
  private pickProjectThenCreateTask(mode: null | 'pick-parent'): void {
    this.pickProject((project) => {
      if (mode === 'pick-parent') {
        const flat = flattenTasks(project.tasks)
        if (!flat.length) {
          return
        }
        openTaskPicker(
          this,
          flat.map((f) => f.task),
          (parentTask) => {
            this.openTaskModalForProject(project, parentTask.id)
          }
        )
      } else {
        this.openTaskModalForProject(project, null)
      }
    }, false)
  }

  private openTaskModalForProject(project: Project, parentId: string | null, defaults?: Partial<Task>): void {
    openTaskModal(this, project, {
      parentId,
      defaults,
      onSave: async () => {
        await this.store.saveProject(project)
        await this.router.openProjectByPath(project.filePath)
      }
    })
  }

  /** Open the task modal pre-filled from selected text, targeting a chosen project. */
  private createTaskFromText(text: string): void {
    const trimmed = text.trim()
    if (!trimmed) return

    const newlineIdx = trimmed.indexOf('\n')
    const defaults: Partial<Task> =
      newlineIdx === -1
        ? { title: trimmed }
        : { title: trimmed.slice(0, newlineIdx).trim(), description: trimmed.slice(newlineIdx + 1).trim() }

    this.pickProject((project) => {
      this.openTaskModalForProject(project, null, defaults)
    }, true)
  }

  private importNotes(): void {
    const activeLeaves = this.app.workspace.getLeavesOfType(PM_PROJECT_VIEW_TYPE)
    let activeProject: Project | null = null

    for (const leaf of activeLeaves) {
      if (!(leaf.view instanceof ProjectView)) continue
      if (leaf.view.project) {
        activeProject = leaf.view.project
        break
      }
    }

    if (activeProject) {
      const project = activeProject
      const onImportComplete = async () => {
        await this.router.openProjectByPath(project.filePath)
      }
      openImportModal(this, activeProject, onImportComplete)
      return
    }

    this.pickProject((project) => {
      const onImportComplete = async () => {
        await this.router.openProjectByPath(project.filePath)
      }
      openImportModal(this, project, onImportComplete)
    }, false)
  }
}
