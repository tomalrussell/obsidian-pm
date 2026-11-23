import { ItemView, Menu, Platform, Scope, WorkspaceLeaf } from 'obsidian'
import type PMPlugin from '#main'
import { addTabPageItems, refreshTabTitle } from '#ui/tab'
import {
  type GanttGranularity,
  type Project,
  type SortRule,
  type TaskQuery,
  type ViewFields,
  type ViewMode,
  flattenTasks,
  shownFields,
  GANTT_GRANULARITIES,
  bestConditionToDrop,
  countActiveFilters,
  filterFieldLabel,
  isQueryActive,
  makeDefaultFilter,
  makeDefaultSort,
  sameValue,
  matchesQuery,
  DEFAULT_PRIORITIES,
  DEFAULT_STATUSES
} from '@dotpm/core'
import {
  folderOf,
  ProjectScope,
  projectFolderOf,
  resolveScopePaths,
  scopeKey,
  type ScopeSpec,
  selectionSpec
} from '#store'
import {
  ChipButton,
  clampZoom,
  MAX_ZOOM,
  MIN_ZOOM,
  Stepper,
  stepZoom,
  EmptyState,
  openFieldsPopover,
  FilterBar,
  openProjectSwitcher,
  openSearchPopover,
  openSortPopover,
  renderFieldsPanel,
  renderFilterPanel,
  renderSortPanel,
  renderBreadcrumb,
  ViewSwitcher,
  safeAsync,
  SearchBox,
  showMenuBelow,
  SplitButton,
  ViewHeader,
  type FieldsPopoverProps,
  type FilterSetup,
  type PlatformMenu,
  type SearchBoxProps,
  type SheetTab,
  type SortPopoverProps,
  type TuneSheetProps,
  type SortField,
  type StepperProps,
  type SwitcherProject,
  type TuneItem,
  summarizeSort,
  syncSortButton,
  type SortSummary
} from '@dotpm/ui'
import type { SubView } from './SubView'
import { TableView } from './table/TableView'
import { GanttView } from './gantt/GanttView'
import { KanbanView } from './KanbanView'
import { openTaskModal } from '#ui/ModalFactory'
import { collapsedTaskIds, setAllCollapsed } from './collapse'

export const PM_PROJECT_VIEW_TYPE = 'pm-project'

interface ProjectViewState {
  scope?: ScopeSpec | { kind: 'subtree'; path: string }
  /** How a project view was addressed before scopes; still accepted from saved layouts. */
  filePath?: string
  anchor?: string
  [key: string]: unknown
}

const MODES: ViewMode[] = ['table', 'gantt', 'kanban']
const MODE_ICONS: Record<ViewMode, string> = { table: 'table', gantt: 'chart-gantt', kanban: 'kanban' }
const SCOPE_ICONS = { picked: 'layers', folder: 'folder', vault: 'vault' }
const modeLabel = (mode: ViewMode): string => ({ table: `Table`, gantt: `Timeline`, kanban: `Board` })[mode]
const granularityLabel = (granularity: GanttGranularity): string =>
  ({ day: `Day`, week: `Week`, month: `Month`, quarter: `Quarter`, year: `Year` })[granularity]

function ends(list: { label: string }[]): [string, string] | undefined {
  return list.length ? [list[0].label, list[list.length - 1].label] : undefined
}

const sortFields = (): SortField[] => [
  { id: 'title', label: `Task` },
  { id: 'status', label: `Status`, ends: ends(DEFAULT_STATUSES) },
  { id: 'priority', label: `Priority`, ends: ends(DEFAULT_PRIORITIES) },
  { id: 'due', label: `Due` },
  { id: 'progress', label: `Progress` }
]

/** One of a mode's own controls, as the options slot, the Tune list and the More menu draw it. */
interface ViewOption {
  id: 'today' | 'scale' | 'collapse'
  icon: string
  label: string
  /** The current value: the Tune list's faint state, and the chip's text when `chip` is `value`. */
  value?: string
  /** How the options slot draws it: icon and label, the value with a chevron, or the icon alone. */
  chip: 'label' | 'value' | 'icon'
  run: (anchor: HTMLElement) => void
}

function specOf(state: ProjectViewState): ScopeSpec | null {
  if (state.scope?.kind === 'subtree') return { kind: 'project', path: state.scope.path }
  if (state.scope) return state.scope
  if (state.filePath) return { kind: 'project', path: state.filePath }
  return null
}

export class ProjectView extends ItemView {
  plugin: PMPlugin
  projectScope: ProjectScope | null = null
  private spec: ScopeSpec | null = null
  /** The project last shown on its own, which "This project" returns to from a wider scope. */
  private anchorPath: string | null = null
  currentView: ViewMode
  /** The saved filter plus the search text, which lives only as long as this view. */
  query: TaskQuery = { filter: makeDefaultFilter(), text: '' }
  sort: SortRule[] = makeDefaultSort()
  fields: ViewFields = {}
  /** Percent of the scale's day width. Kept per device, not in the view. */
  zoom = 100
  granularity: GanttGranularity
  private subview: SubView | null = null
  private headerEl!: HTMLElement
  private bodyEl!: HTMLElement
  private emptyEl!: HTMLElement
  private header: ViewHeader | null = null
  private filterBar: FilterBar | null = null
  private searchBox: SearchBox | null = null
  private queryBarOpen = false
  private countEl: HTMLElement | null = null
  private filterButton: ChipButton | null = null
  private sortButton: ChipButton | null = null
  private fieldsButton: ChipButton | null = null
  private zoomStepper: Stepper | null = null
  private keyScope: Scope
  private pendingRefresh: Promise<void> | null = null
  private initialized = false
  /** Set once the default view mode is applied, so reloads don't undo a mode switch. */
  private defaultViewAppliedFor: string | null = null
  /**
   * The paths the current load covers, claimed before it starts. Loading a project can
   * write to it, and that write comes back as an index change, so comparing against the
   * projects already in hand would reload on top of a load that has not finished.
   */
  private loadedPaths: string[] = []

  constructor(leaf: WorkspaceLeaf, plugin: PMPlugin) {
    super(leaf)
    this.plugin = plugin
    this.currentView = plugin.settings.defaultView
    this.granularity = plugin.settings.ganttGranularity
    this.navigation = false
    this.keyScope = new Scope(this.app.scope)
    this.scope = this.keyScope
  }

  getViewType(): string {
    return PM_PROJECT_VIEW_TYPE
  }
  getDisplayText(): string {
    return this.projectScope?.label() ?? `Project`
  }

  getIcon(): string {
    return 'chart-gantt'
  }

  onPaneMenu(menu: Menu, source: string): void {
    super.onPaneMenu(menu, source)
    const scope = this.projectScope
    const primary = scope?.primary
    if (!scope || !primary) return
    if (!scope.isMulti) addTabPageItems(menu, this.plugin, this.leaf, primary.filePath, ['note', 'edit'])
  }

  /** The project a command should act on: the only one, or the group's primary. */
  get project(): Project | null {
    return this.projectScope?.primary ?? null
  }

  async setState(state: ProjectViewState, result: unknown): Promise<void> {
    const spec = specOf(state)
    if (typeof state.anchor === 'string') this.anchorPath = state.anchor
    if (spec && (!this.spec || scopeKey(this.spec) !== scopeKey(spec))) {
      this.spec = spec
      await this.loadScope()
    }
    await super.setState(state, result as import('obsidian').ViewStateResult)
  }

  getState(): ProjectViewState {
    return {
      scope: this.spec ?? undefined,
      filePath: this.projectScope?.primary?.filePath,
      anchor: this.anchorPath ?? undefined
    }
  }

  onOpen(): Promise<void> {
    // Setup only. setState is the sole loader; this just guarantees the scaffold and
    // listeners exist for hosts that open the view without it.
    this.ensureInitialized()
    return Promise.resolve()
  }

  onClose(): Promise<void> {
    this.subview?.destroy?.()
    this.subview = null
    this.header?.destroy()
    this.header = null
    return Promise.resolve()
  }

  // Pane Relief and Hover Editor restore a deferred leaf via setState without ever
  // calling onOpen, so the one-time setup runs from whichever fires first.
  private ensureInitialized(): void {
    if (this.initialized) return
    this.initialized = true

    this.containerEl.addClass('pm-view')
    const root = this.contentEl
    root.empty()
    root.addClass('pm-root')
    this.headerEl = root.createDiv('pm-vh-mount')
    this.bodyEl = root.createDiv('pm-content')
    this.emptyEl = root.createDiv('pm-filter-empty pm-hidden')

    this.register(
      this.plugin.store.onProjectChanged((path) => {
        if (this.scopeDependsOn(path)) this.redraw()
      })
    )
    // A scope changes when a project joins or leaves it, which for a single-project scope
    // includes the project appearing once the index has caught up with the vault.
    this.register(
      this.plugin.index.onChange(() => {
        if (!this.spec) return
        const paths = resolveScopePaths(this.spec, this.plugin.index)
        const current = this.loadedPaths
        if (paths.length !== current.length || paths.some((path, i) => path !== current[i])) {
          void this.loadScope()
        }
      })
    )
  }

  private scopeDependsOn(path: string): boolean {
    const projects = this.projectScope?.projects
    if (!projects) return false
    return projects.some((project) => project.filePath === path)
  }

  /**
   * Something outside the DOM changed: a project in scope, or a setting that decides how
   * it is drawn. The store keeps one instance per file, so the projects are already
   * current and only the DOM needs catching up.
   */
  redraw(): void {
    if (!this.projectScope || !this.spec) return
    if (!this.projectScope.primary) {
      this.renderEmptyScope()
      return
    }
    refreshTabTitle(this.leaf)
    // Rebuilding the header would drop the caret out of the search box.
    if (this.headerEl.contains(activeDocument.activeElement)) this.syncHeader()
    else this.renderHeader()
    void this.refreshProject()
  }

  private async loadScope(): Promise<void> {
    this.ensureInitialized()
    if (!this.spec) return
    if (this.spec.kind === 'project') this.anchorPath = this.spec.path
    const paths = resolveScopePaths(this.spec, this.plugin.index)
    this.loadedPaths = paths
    const projects = await this.plugin.store.loadProjects(paths)
    this.projectScope = new ProjectScope(this.spec, projects)
    if (!this.projectScope.primary) {
      this.renderEmptyScope()
      return
    }
    if (this.defaultViewAppliedFor !== this.projectScope.key) {
      this.defaultViewAppliedFor = this.projectScope.key
      this.currentView = this.plugin.settings.defaultView
    }
    this.loadFilterFromSettings()
    this.zoom = clampZoom(Number(this.app.loadLocalStorage(this.zoomKey())) || 100)
    this.queryBarOpen = countActiveFilters(this.query.filter) > 0
    refreshTabTitle(this.leaf)
    this.renderHeader()
    this.renderCurrentView()
  }

  private async switchScope(spec: ScopeSpec): Promise<void> {
    this.spec = spec
    await this.loadScope()
    await this.leaf.setViewState({ type: PM_PROJECT_VIEW_TYPE, state: this.getState() })
  }

  /** Moves this leaf to another scope in the same mode, or opens it in a new tab. */
  private async goTo(spec: ScopeSpec, newTab: boolean): Promise<void> {
    if (newTab) {
      await this.plugin.router.openScope(spec)
      return
    }
    this.defaultViewAppliedFor = scopeKey(spec)
    await this.switchScope(spec)
  }

  private loadFilterFromSettings(): void {
    const saved = this.projectScope ? this.plugin.settings.projectFilters[this.projectScope.key] : undefined
    if (saved) {
      this.query.filter = saved.filter
      this.sort = saved.sort
      this.fields = saved.fields
      this.granularity = saved.ganttGranularity
      return
    }
    this.query.filter = makeDefaultFilter()
    this.sort = makeDefaultSort()
    this.fields = structuredClone(this.plugin.settings.defaultFields)
    this.granularity = this.plugin.settings.ganttGranularity
  }

  private async persistFilter(): Promise<void> {
    if (!this.projectScope) return
    this.plugin.settings.projectFilters[this.projectScope.key] = {
      filter: this.query.filter,
      sort: this.sort,
      fields: this.fields,
      ganttGranularity: this.granularity
    }
    await this.plugin.saveSettings()
  }

  private renderEmptyScope(): void {
    this.header?.destroy()
    this.header = null
    this.filterBar = null
    this.headerEl.empty()
    this.bodyEl.empty()
    this.bodyEl.removeClass('pm-hidden')
    this.emptyEl.addClass('pm-hidden')
    const msg = this.bodyEl.createDiv('pm-empty-state')
    msg.createEl('h3', { text: `Nothing to show` })
    msg.createEl('p', { text: `No project here. It may have been deleted or renamed.` })
  }

  private renderHeader(): void {
    const scope = this.projectScope
    const primary = scope?.primary
    if (!scope || !primary) return
    this.header?.destroy()
    const header = new ViewHeader(this.headerEl)
    this.header = header
    this.renderContextSlot(header.context, scope, primary)
    new ViewSwitcher<ViewMode>(header.context, {
      options: MODES.map((mode) => ({ id: mode, icon: MODE_ICONS[mode], label: modeLabel(mode) })),
      active: this.currentView,
      onChange: (mode) => this.switchMode(mode)
    })
    this.renderViewSlot(header.view)
    this.renderQuerySlot(header.query)
    this.renderOptionsSlot(header.options, scope)
    this.renderActionsSlot(header.actions)
    header
      .setTuneItems(() => this.tuneItems())
      .setTuneSheet(() => this.tuneSheet())
      .setMoreMenu((menu, anchor) => this.fillMoreMenu(menu, anchor))
    this.renderFilterBar()
    this.syncHeader()
  }

  /** Brings the parts that follow the filter, sort and task counts up to date without rebuilding them. */
  private syncHeader(): void {
    const counts = this.taskCounts()
    this.countEl?.setText(this.countLabel(counts))
    this.filterBar?.setSummary(`${counts.shown} of ${counts.total} shown`)
    this.syncFilterEmpty(counts)
    const filters = countActiveFilters(this.query.filter)
    this.filterButton?.setBadge(filters).setActive(filters > 0)
    this.searchBox?.setValue(this.query.text)
    this.header?.tune.setBadge(filters).setActive(isQueryActive(this.query))
    if (this.fieldsButton) {
      const hidden = this.hiddenFieldCount()
      this.fieldsButton
        .setDetail(hidden ? (hidden === 1 ? `${hidden} hidden` : `${hidden} hidden`) : '')
        .setActive(this.fields[this.currentView] !== undefined)
    }
    this.zoomStepper?.setValue(`${this.zoom}%`, this.zoom <= MIN_ZOOM, this.zoom >= MAX_ZOOM)
    if (this.sortButton) syncSortButton(this.sortButton, this.sortSummary())
    this.header?.fit()
  }

  /** Replaces a body the filter has emptied with a way back: the one condition that frees the most tasks. */
  private syncFilterEmpty(counts: { shown: number; total: number }): void {
    const scope = this.projectScope
    const emptied = !!scope && isQueryActive(this.query) && counts.shown === 0 && counts.total > 0
    this.emptyEl.empty()
    this.emptyEl.toggleClass('pm-hidden', !emptied)
    this.bodyEl.toggleClass('pm-hidden', emptied)
    if (!scope || !emptied) return
    const state = new EmptyState(this.emptyEl).setIcon('search-x')
    const { conditions } = this.query.filter
    if (!conditions.length) {
      state.setTitle(`Nothing matches ${this.query.text.trim()}`)
      return
    }
    const ctx = scope.filterContext()
    const tasks = flattenTasks(scope.tasks()).map((flat) => flat.task)
    const best = bestConditionToDrop(tasks, this.query, ctx)
    const apply = (): void => {
      this.handleFilterMutation()
      this.renderFilterBar()
    }
    state.setTitle(`No tasks match these filters`)
    if (best) {
      const label = filterFieldLabel(conditions[best.index].field)
      state
        .setBody(
          best.shown === 1
            ? `Removing ${label} would show ${best.shown} task.`
            : `Removing ${label} would show ${best.shown} tasks.`
        )
        .setAction(`Remove ${label}`, () => {
          conditions.splice(best.index, 1)
          apply()
        })
    } else {
      state.setBody(`No single filter brings any task back.`)
    }
    state.addSecondaryAction(`Clear all filters`, () => {
      this.query.filter.conditions = []
      apply()
    })
  }

  /** The tasks shown, and how many projects they come from when there are several. */
  private countLabel(counts: { shown: number; total: number }): string {
    const tasks = isQueryActive(this.query)
      ? `${counts.shown} of ${counts.total}`
      : counts.total === 1
        ? `${counts.total} task`
        : `${counts.total} tasks`
    const scope = this.projectScope
    if (!scope?.isMulti) return tasks
    return `${scope.projects.length === 1 ? `${scope.projects.length} project` : `${scope.projects.length} projects`} · ${tasks}`
  }

  private taskCounts(): { shown: number; total: number } {
    const scope = this.projectScope
    if (!scope) return { shown: 0, total: 0 }
    const ctx = scope.filterContext()
    const all = flattenTasks(scope.tasks())
    const total = all.filter((flat) => this.query.filter.showArchived || !flat.task.archived).length
    const shown = all.filter((flat) => matchesQuery(flat.task, this.query, ctx)).length
    return { shown, total }
  }

  private renderContextSlot(parent: HTMLElement, scope: ProjectScope, primary: Project): void {
    const kind = scope.spec.kind
    const count = scope.projects.length
    const common = {
      onSwitch: (anchor: HTMLElement) => this.openSwitcher(anchor, scope, primary),
      switchLabel: `Switch project`,
      foldLabel: `Projects`
    }
    if (kind === 'project') {
      renderBreadcrumb(parent, {
        ...common,
        icon: primary.icon,
        color: primary.color,
        ancestors: [],
        title: primary.title,
        badge: count > 1 ? `+${count - 1}` : undefined
      })
      return
    }
    const named = kind === 'picked' ? scope.projects.slice(0, 2) : []
    let title = `All projects`
    if (kind === 'picked') title = named.map((project) => project.title).join(', ')
    else if (scope.spec.kind === 'folder') title = scope.spec.path || `Vault`
    renderBreadcrumb(parent, {
      ...common,
      icon: SCOPE_ICONS[kind],
      ancestors: [],
      title,
      badge: kind === 'picked' && count > named.length ? `+${count - named.length}` : undefined,
      scoped: true
    })
  }

  private showModeMenu(anchor: HTMLElement, scope: ProjectScope, primary: Project): void {
    const menu = new Menu()
    this.addModeItems(menu, scope, primary)
    showMenuBelow(menu, anchor)
  }

  /** The three modes with the current one checked, then the project's overview when there is one project. */
  private addModeItems(menu: PlatformMenu, scope: ProjectScope, primary: Project): void {
    for (const mode of MODES) {
      menu.addItem((item) =>
        item
          .setTitle(modeLabel(mode))
          .setIcon(MODE_ICONS[mode])
          .setChecked(mode === this.currentView)
          .onClick(() => this.switchMode(mode))
      )
    }
    if (scope.isMulti) return
    menu.addSeparator()
    menu.addItem((item) =>
      item
        .setTitle(`Overview`)
        .setIcon('file-text')
        .onClick(safeAsync(() => this.plugin.router.openProjectOverview(primary.filePath, this.leaf)))
    )
  }

  private switchMode(mode: ViewMode): void {
    if (mode === this.currentView) return
    this.currentView = mode
    this.renderHeader()
    this.renderCurrentView()
  }

  private openSwitcher(anchor: HTMLElement, scope: ProjectScope, primary: Project): void {
    const index = this.plugin.index
    const spec = scope.spec
    const projects: SwitcherProject[] = index.projectRefs().map((ref) => ({
      path: ref.path,
      title: ref.title,
      icon: ref.icon,
      color: ref.color,
      folder: this.containingFolder(ref.path),
      taskCount: index.counts(ref).total
    }))
    projects.sort((a, b) => (a.folder < b.folder ? -1 : a.folder > b.folder ? 1 : 0))
    const anchorProject = scope.projects.find((project) => project.filePath === this.anchorPath) ?? primary
    const path = spec.kind === 'project' ? spec.path : anchorProject.filePath
    const folder = this.containingFolder(path)
    const options: { label: string; spec: ScopeSpec }[] = [
      {
        label: `Only ${index.projectRef(path)?.title ?? anchorProject.title}`,
        spec: { kind: 'project', path }
      }
    ]
    options.push(
      {
        label: folder ? `Folder: ${folder}` : `Vault folder`,
        spec: { kind: 'folder', path: folder }
      },
      { label: `All projects`, spec: { kind: 'vault' } }
    )

    openProjectSwitcher(anchor, {
      projects,
      selected: scope.projects.map((project) => project.filePath),
      current: spec.kind === 'project' ? spec.path : undefined,
      presets: options.map((option) => ({
        label: option.label,
        active: scope.key === scopeKey(option.spec),
        onPick: safeAsync(() => this.goTo(option.spec, false))
      })),
      onPick: safeAsync((picked: string) => this.goTo({ kind: 'project', path: picked }, false)),
      onShow: safeAsync((paths: string[]) => {
        return this.goTo(selectionSpec(paths), false)
      })
    })
  }

  /** The folder a project sits in. A project owns its folder, so that is the one holding it. */
  private containingFolder(projectPath: string): string {
    return folderOf(projectFolderOf(this.app, projectPath) ?? projectPath)
  }

  private renderViewSlot(parent: HTMLElement): void {
    this.countEl = parent.createSpan('pm-vh-count')
  }

  private renderQuerySlot(parent: HTMLElement): void {
    this.searchBox = new SearchBox(parent, this.searchProps())
    this.filterButton = new ChipButton(parent)
      .setIcon('list-filter')
      .setLabel(`Filter`)
      .setAriaLabel(`Filter`)
      .onClick(() => this.openFilter())
    this.sortButton = null
    this.fieldsButton = null
    if (this.currentView !== 'gantt') {
      const sortButton = new ChipButton(parent).setAriaLabel(`Sort`)
      sortButton.onClick(() => this.openSort(sortButton.el))
      this.sortButton = sortButton
    }
    const fieldsButton = new ChipButton(parent).setIcon('columns-3').setLabel(`Fields`).setAriaLabel(`Fields`)
    fieldsButton.onClick(() => this.openFields(fieldsButton.el))
    this.fieldsButton = fieldsButton
  }

  private searchProps(): SearchBoxProps {
    return {
      value: this.query.text,
      label: `Search`,
      placeholder: `Search tasks…`,
      clearLabel: `Clear`,
      onChange: (value) => {
        this.query.text = value
        this.syncHeader()
        this.refreshSubview()
      }
    }
  }

  private openFilter(): void {
    this.queryBarOpen = true
    if (!this.filterBar) this.renderFilterBar()
    this.filterBar?.openPicker()
  }

  private openSort(anchor: HTMLElement): void {
    openSortPopover(anchor, this.sortProps())
  }

  /** What the sort panel edits; `after` runs after each change, for a host that follows it. */
  private sortProps(after?: () => void): SortPopoverProps {
    const sorted = (): void => {
      this.syncHeader()
      this.refreshSubview()
      void this.persistFilter()
      after?.()
    }
    return {
      fields: sortFields(),
      sort: this.sort,
      onChange: sorted,
      onReset: () => {
        this.sort.splice(0, this.sort.length, ...makeDefaultSort())
        sorted()
      }
    }
  }

  private openFields(anchor: HTMLElement): void {
    const props = this.fieldsProps()
    if (props) openFieldsPopover(anchor, props)
  }

  private fieldsProps(after?: () => void): FieldsPopoverProps | null {
    const scope = this.projectScope
    if (!scope) return null
    return {
      mode: this.currentView,
      fields: this.fields,
      catalog: scope.fieldCatalog(),
      onChange: () => {
        this.handleFieldsChange()
        after?.()
      }
    }
  }

  /** The sort as the header names it, or nothing at the default. */
  private sortSummary(): SortSummary | undefined {
    return sameValue(this.sort, makeDefaultSort()) ? undefined : summarizeSort(sortFields(), this.sort)
  }

  /** How many of the mode's default fields are hidden, counted only once the mode's fields were changed. */
  private hiddenFieldCount(): number {
    const scope = this.projectScope
    if (!scope || this.fields[this.currentView] === undefined) return 0
    // Counted against the defaults, so fields a mode never shows unless asked don't read as hidden.
    const catalog = scope.fieldCatalog()
    const shown = shownFields(this.fields, this.currentView, catalog)
    return shownFields({}, this.currentView, catalog).filter((id) => !shown.includes(id)).length
  }

  /** The query and option controls as the Tune button lists them in a narrow header. */
  private tuneItems(): TuneItem[][] {
    const scope = this.projectScope
    const primary = scope?.primary
    if (!scope || !primary) return []
    const mode: TuneItem = {
      icon: MODE_ICONS[this.currentView],
      label: `View mode`,
      state: modeLabel(this.currentView),
      onOpen: (anchor) => this.showModeMenu(anchor, scope, primary)
    }
    const filters = countActiveFilters(this.query.filter)
    const sort = this.sortSummary()
    const hidden = this.hiddenFieldCount()
    const query: TuneItem[] = [
      {
        icon: 'search',
        label: `Search`,
        state: this.query.text.trim(),
        onOpen: (anchor) => openSearchPopover(anchor, this.searchProps())
      },
      {
        icon: 'list-filter',
        label: `Filter`,
        state: filters ? String(filters) : '',
        onOpen: () => this.openFilter()
      }
    ]
    if (this.currentView !== 'gantt') {
      query.push({
        icon: 'arrow-down-up',
        label: `Sort`,
        state: sort ? `${sort.label} ${sort.more}`.trim() : '',
        onOpen: (anchor) => this.openSort(anchor)
      })
    }
    query.push({
      icon: 'columns-3',
      label: `Fields`,
      state: hidden ? (hidden === 1 ? `${hidden} hidden` : `${hidden} hidden`) : '',
      onOpen: (anchor) => this.openFields(anchor)
    })
    const options = this.viewOptions(scope).map((option): TuneItem => {
      if (option !== 'zoom') return { icon: option.icon, label: option.label, state: option.value, onOpen: option.run }
      return {
        icon: 'zoom-in',
        label: `Zoom`,
        control: (parent) => {
          const sync = (): void => {
            stepper.setValue(`${this.zoom}%`, this.zoom <= MIN_ZOOM, this.zoom >= MAX_ZOOM)
          }
          const stepper = new Stepper(parent, this.zoomProps(sync))
          sync()
        }
      }
    })
    return [[mode], query, options]
  }

  /** Rebuilt rather than refreshed, so the table keeps its scroll position while its columns change. */
  private handleFieldsChange(): void {
    this.syncHeader()
    this.renderCurrentView()
    void this.persistFilter()
  }

  /** The phone's sheet: a tab for each query control this mode has, and how many tasks it leaves. */
  private tuneSheet(): TuneSheetProps {
    const tabs: SheetTab[] = []
    const setup = this.filterSetup()
    if (setup) {
      tabs.push({
        id: 'filter',
        label: `Filter`,
        badge: () => countActiveFilters(this.query.filter),
        render: (parent, changed) =>
          renderFilterPanel(
            parent,
            setup,
            () => {
              this.handleFilterMutation()
              changed()
            },
            'list',
            { showClear: false }
          )
      })
    }
    if (this.currentView !== 'gantt') {
      tabs.push({
        id: 'sort',
        label: `Sort`,
        render: (parent, changed) => renderSortPanel(parent, this.sortProps(changed))
      })
    }
    tabs.push({
      id: 'fields',
      label: `Fields`,
      render: (parent, changed) => {
        const props = this.fieldsProps(changed)
        if (props) renderFieldsPanel(parent, props)
      }
    })
    return {
      tabs,
      clear: {
        label: `Clear all`,
        canClear: () => countActiveFilters(this.query.filter) > 0,
        onClear: () => {
          this.query.filter.conditions = []
          this.query.filter.showArchived = false
          this.handleFilterMutation()
        }
      },
      doneLabel: () =>
        this.taskCounts().shown === 1 ? `Show ${this.taskCounts().shown} task` : `Show ${this.taskCounts().shown} tasks`
    }
  }

  /** The phone's "More" menu: the view mode and the options the header has no room for. */
  private fillMoreMenu(menu: PlatformMenu, anchor: HTMLElement): void {
    const scope = this.projectScope
    const primary = scope?.primary
    if (!scope || !primary) return
    this.addModeItems(menu, scope, primary)
    const options = this.viewOptions(scope)
    if (options.length) menu.addSeparator()
    for (const option of options) {
      if (option === 'zoom') {
        menu.addItem((item) =>
          item
            .setTitle(`Zoom in`)
            .setIcon('zoom-in')
            .setDisabled(this.zoom >= MAX_ZOOM)
            .onClick(() => this.setZoom(stepZoom(this.zoom, 1)))
        )
        menu.addItem((item) =>
          item
            .setTitle(`Zoom out`)
            .setIcon('zoom-out')
            .setDisabled(this.zoom <= MIN_ZOOM)
            .onClick(() => this.setZoom(stepZoom(this.zoom, -1)))
        )
        continue
      }
      const title = option.value ? `${option.label}: ${option.value}` : option.label
      menu.addItem((item) =>
        item
          .setTitle(title)
          .setIcon(option.icon)
          .onClick(() => option.run(anchor))
      )
    }
    if (this.currentView === 'gantt') {
      menu.addSeparator()
      menu.addItem((item) =>
        item
          .setTitle(`Add milestone`)
          .setIcon('diamond')
          .onClick(() => this.addTask(anchor, { type: 'milestone' }))
      )
    }
  }

  private renderOptionsSlot(parent: HTMLElement, scope: ProjectScope): void {
    this.zoomStepper = null
    for (const option of this.viewOptions(scope)) {
      if (option === 'zoom') {
        this.zoomStepper = new Stepper(parent, this.zoomProps())
        continue
      }
      const chip = new ChipButton(parent).setAriaLabel(option.label)
      if (option.chip === 'value') chip.setLabel(option.value ?? '').setChevron(true)
      else chip.setIcon(option.icon).setLabel(option.chip === 'label' ? option.label : '')
      if (option.chip === 'icon') chip.setTooltip(option.label)
      chip.onClick(() => option.run(chip.el))
    }
  }

  /**
   * The mode's own controls in their order: on the timeline Today, the scale and the zoom, then collapse on anything but the board. The options slot, the Tune list
   * and the More menu all draw this list; `zoom` stands for the stepper, which each draws its own way.
   */
  private viewOptions(scope: ProjectScope): (ViewOption | 'zoom')[] {
    const options: (ViewOption | 'zoom')[] = []
    if (this.currentView === 'gantt') {
      options.push(
        {
          id: 'today',
          icon: 'calendar-check',
          label: `Today`,
          chip: 'label',
          run: () => this.scrollToToday()
        },
        {
          id: 'scale',
          icon: 'calendar-range',
          label: `Timeline scale`,
          value: granularityLabel(this.granularity),
          chip: 'value',
          run: (anchor) => this.openScaleMenu(anchor)
        },
        'zoom'
      )
    }
    if (this.currentView !== 'kanban') {
      const anyCollapsed = collapsedTaskIds(this.plugin.settings, scope.projects).size > 0
      options.push({
        id: 'collapse',
        icon: anyCollapsed ? 'chevrons-up-down' : 'chevrons-down-up',
        label: anyCollapsed ? `Expand all` : `Collapse all`,
        chip: 'icon',
        run: () => this.toggleCollapseAll(scope, anyCollapsed)
      })
    }
    return options
  }

  private scrollToToday(): void {
    if (this.subview instanceof GanttView) this.subview.scrollToToday()
  }

  private openScaleMenu(anchor: HTMLElement): void {
    const menu = new Menu()
    for (const granularity of GANTT_GRANULARITIES) {
      menu.addItem((item) =>
        item
          .setTitle(granularityLabel(granularity))
          .setChecked(granularity === this.granularity)
          .onClick(() => this.setGranularity(granularity))
      )
    }
    showMenuBelow(menu, anchor)
  }

  /** The zoom stepper's handlers; `onZoom` runs after each step, for a stepper the header doesn't keep current. */
  private zoomProps(onZoom?: () => void): StepperProps {
    const zoomTo = (zoom: number): void => {
      this.setZoom(zoom)
      onZoom?.()
    }
    return {
      decreaseLabel: `Zoom out`,
      increaseLabel: `Zoom in`,
      resetLabel: `Reset zoom`,
      onDecrease: () => zoomTo(stepZoom(this.zoom, -1)),
      onIncrease: () => zoomTo(stepZoom(this.zoom, 1)),
      onReset: () => zoomTo(100)
    }
  }

  private toggleCollapseAll(scope: ProjectScope, anyCollapsed: boolean): void {
    setAllCollapsed(this.plugin.settings, scope.projects, !anyCollapsed)
    void this.plugin.saveSettings()
    this.renderHeader()
    this.refreshSubview()
  }

  /** Zoom is per device, so it is kept in this vault's local storage rather than in the view. */
  private zoomKey(): string {
    return `dotpm-timeline-zoom:${this.projectScope?.key ?? ''}`
  }

  private setZoom(zoom: number): void {
    if (zoom === this.zoom) return
    this.zoom = zoom
    this.rememberZoom()
    if (this.subview instanceof GanttView) this.subview.setZoom(zoom)
  }

  private rememberZoom(): void {
    this.app.saveLocalStorage(this.zoomKey(), this.zoom === 100 ? null : this.zoom)
    this.syncHeader()
  }

  private setGranularity(granularity: GanttGranularity): void {
    if (granularity === this.granularity) return
    this.granularity = granularity
    void this.persistFilter()
    this.renderHeader()
    this.renderCurrentView()
  }

  private renderActionsSlot(parent: HTMLElement): void {
    const add = new SplitButton(parent).setIcon('plus').setLabel(`Add task`)
    add.onClick(() => this.addTask(add.el))
    if (this.currentView === 'gantt') {
      add.onMenu(`More to add`, (anchor) => {
        const menu = new Menu()
        menu.addItem((item) =>
          item
            .setTitle(`Add milestone`)
            .setIcon('diamond')
            .onClick(() => this.addTask(add.el, { type: 'milestone' }))
        )
        showMenuBelow(menu, anchor, 'right')
      })
    }
  }

  private filterSetup(): FilterSetup | null {
    const scope = this.projectScope
    if (!scope) return null
    return {
      filter: this.query.filter,
      tasks: flattenTasks(scope.tasks()).map((flat) => flat.task),
      ctx: scope.filterContext(),
      priorities: DEFAULT_PRIORITIES,
      projects: scope.isMulti
        ? scope.projects.map((project) => ({ id: project.id, title: project.title, color: project.color }))
        : []
    }
  }

  /** The applied filters under the header. A phone reaches them through the Tune sheet instead. */
  private renderFilterBar(): void {
    const header = this.header
    const setup = this.filterSetup()
    if (!header || !setup) return
    header.bar.empty()
    this.filterBar = null
    if (!this.queryBarOpen || Platform.isPhone) return
    const counts = this.taskCounts()
    this.filterBar = new FilterBar(header.bar, {
      ...setup,
      summary: `${counts.shown} of ${counts.total} shown`,
      onChange: () => this.handleFilterMutation(),
      onClose: () => {
        this.queryBarOpen = false
        this.renderFilterBar()
      }
    })
  }

  private handleFilterMutation(): void {
    this.syncHeader()
    void this.persistFilter()
    this.refreshSubview()
  }

  private refreshSubview(): void {
    this.subview?.render()
  }

  /** With several projects in view, a new task has to say which one it belongs to. */
  private addTask(anchor: HTMLElement, defaults?: Parameters<typeof openTaskModal>[2]['defaults']): void {
    const scope = this.projectScope
    if (!scope?.primary) return
    const open = (project: Project): void => {
      openTaskModal(this.plugin, project, {
        defaults,
        onSave: async () => {
          await this.refreshProject()
        }
      })
    }
    if (!scope.isMulti) {
      open(scope.primary)
      return
    }
    const menu = new Menu()
    for (const project of scope.projects) {
      menu.addItem((item) =>
        item
          .setTitle(project.title)
          .setIcon('plus')
          .onClick(() => open(project))
      )
    }
    showMenuBelow(menu, anchor)
  }

  private renderCurrentView(): void {
    const scope = this.projectScope
    if (!scope?.primary) return

    let savedGanttScroll: ReturnType<GanttView['getScrollPosition']> | null = null
    if (this.currentView === 'gantt' && this.subview instanceof GanttView) {
      savedGanttScroll = this.subview.getScrollPosition()
    }

    let savedTableScrollTop: number | null = null
    if (this.currentView === 'table' && this.subview instanceof TableView) {
      savedTableScrollTop = this.subview.getScrollTop()
    }

    this.subview?.destroy?.()
    this.bodyEl.empty()
    this.subview = null

    switch (this.currentView) {
      case 'table': {
        const table = new TableView(
          this.bodyEl,
          scope,
          this.plugin,
          () => this.refreshProject(),
          this.query,
          this.sort,
          safeAsync(async () => {
            this.syncHeader()
            await this.persistFilter()
          }),
          this.keyScope,
          this.fields
        )
        if (savedTableScrollTop !== null) table.setPendingScrollTop(savedTableScrollTop)
        this.subview = table
        break
      }
      case 'gantt': {
        const gantt = new GanttView(
          this.bodyEl,
          scope,
          this.plugin,
          () => this.refreshProject(),
          this.query,
          this.granularity,
          this.keyScope,
          this.fields,
          this.zoom,
          (zoom) => {
            this.zoom = zoom
            this.rememberZoom()
          }
        )
        if (savedGanttScroll) gantt.setPendingScroll(savedGanttScroll)
        this.subview = gantt
        break
      }
      case 'kanban':
        this.subview = new KanbanView(
          this.bodyEl,
          scope,
          this.plugin,
          () => this.refreshProject(),
          this.query,
          this.sort,
          this.fields
        )
        break
    }
    this.bodyEl.toggleClass('pm-content--kanban', this.currentView === 'kanban')
    this.subview?.render()
  }

  /**
   * Re-render from the projects in memory. Coalesced, so a mutation reporting back
   * through both its own callback and the store's change event paints once.
   */
  refreshProject(): Promise<void> {
    if (this.pendingRefresh) return this.pendingRefresh
    this.pendingRefresh = new Promise((resolve) => {
      window.setTimeout(() => {
        this.pendingRefresh = null
        if (this.projectScope?.primary) {
          if (this.subview?.refresh) this.subview.refresh()
          else if (this.subview) this.subview.render()
          else this.renderCurrentView()
          this.syncHeader()
        }
        resolve()
      }, 0)
    })
    return this.pendingRefresh
  }
}
