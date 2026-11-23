import { today } from './dates'
import type { TaskIndex } from './store/TaskIndex'

export type TaskStatus = string
export type TaskPriority = string
export type GanttGranularity = 'day' | 'week' | 'month' | 'quarter' | 'year'
export type GanttWeekLabel = 'weekNumber' | 'dateRange' | 'both'
export type ViewMode = 'table' | 'gantt' | 'kanban'
export const GANTT_GRANULARITIES: GanttGranularity[] = ['day', 'week', 'month', 'quarter', 'year']
export type LineBorders = 'none' | 'horizontal' | 'vertical' | 'both'
export type DateBucket = 'overdue' | 'today' | 'this-week' | 'this-month'
export type SortDir = 'asc' | 'desc'
export type DueUrgency = 'normal' | 'near' | 'overdue'
export type TaskType = 'task' | 'milestone' | 'subtask'

export const SORT_KEYS = ['title', 'status', 'priority', 'due', 'progress'] as const
export type SortKey = (typeof SORT_KEYS)[number]

/** One key of a sort; a view sorts by up to `MAX_SORT_RULES` of them, first rule first. */
export interface SortRule {
  key: SortKey
  dir: SortDir
}

export const MAX_SORT_RULES = 3

export interface Task {
  id: string
  title: string
  description: string
  type: TaskType // a milestone has zero duration
  status: TaskStatus
  priority: TaskPriority
  start: string // YYYY-MM-DD, empty string = unset
  due: string // YYYY-MM-DD, empty string = unset
  progress: number // 0-100
  completed: string // YYYY-MM-DD, empty string = not completed; stamped when status becomes complete
  tags: string[]
  subtasks: Task[]
  dependencies: string[] // task IDs
  createdAt: string
  updatedAt: string
  filePath?: string // vault path to this task's .md file
  archived?: boolean // runtime only, derived from file location in Archive/ subfolder
}

export interface Project {
  id: string
  title: string
  description: string
  color: string // hex
  icon: string // emoji
  tasks: Task[]
  createdAt: string
  updatedAt: string
  filePath: string // resolved vault path
  /** Kept out of lists, pickers and sweeps. */
  archived?: boolean
  /** Per-project overrides for the global settings. Absent fields inherit. */
  config?: ProjectConfig
  /** Not serialized. Rebuilt on load, maintained by the store's mutators. */
  taskIndex: TaskIndex
}

/** Tasks are excluded: they change through the task mutators, never a whole-project write. */
export type ProjectPatch = Partial<Pick<Project, 'title' | 'description' | 'color' | 'icon' | 'config' | 'archived'>>

export const FILTER_OPS = [
  'any',
  'none',
  'all',
  'empty',
  'not-empty',
  'contains',
  'not-contains',
  'between',
  'bucket'
] as const
export type FilterOp = (typeof FILTER_OPS)[number]

/** A built-in field condition with selected values, text, a date bucket or date range. */
export interface FilterCondition {
  field: string
  op: FilterOp
  value?: string[] | string
}

/** Conditions combine with AND; the ids inside one condition with OR. */
export interface FilterState {
  conditions: FilterCondition[]
  showArchived: boolean
}

/** What a view shows: the saved filter plus the search text, which is never saved. */
export interface TaskQuery {
  filter: FilterState
  text: string
}

/** Which fields one presentation shows, in order. */
export interface FieldList {
  visible: string[]
}

/** Per view mode. A mode left out shows its default fields. */
export type ViewFields = Partial<Record<ViewMode, FieldList>>

export const PROJECT_SORT_KEYS = ['title', 'progress', 'due'] as const
export type ProjectSortKey = (typeof PROJECT_SORT_KEYS)[number]

export interface ProjectSortRule {
  key: ProjectSortKey
  dir: SortDir
}

export const PROJECT_PROGRESS = ['not-started', 'in-progress', 'complete'] as const
export type ProjectProgress = (typeof PROJECT_PROGRESS)[number]

/** Values within one list match with OR; the lists combine with AND. An absent list matches every project. */
export interface ProjectListFilter {
  tags?: string[]
  progress?: ProjectProgress[]
}

export type ProjectGroupBy = 'none' | 'folder' | 'tag'

/** The project list's columns after the title, in their default order. */
export const PROJECT_LIST_FIELDS = ['progress', 'tasks', 'due'] as const
export type ProjectListField = (typeof PROJECT_LIST_FIELDS)[number]

/** What the project list shows. Archived projects follow `PMSettings.showArchivedProjects`. */
export interface ProjectListState {
  filter: ProjectListFilter
  /** Empty keeps the stored project order. */
  sort: ProjectSortRule[]
  group: ProjectGroupBy
  /** The columns shown after the title, in order. Left out while every column shows in the default order. */
  fields?: ProjectListField[]
}

export interface PerProjectFilter {
  filter: FilterState
  sort: SortRule[]
  fields: ViewFields
  ganttGranularity: GanttGranularity
}

export interface StatusConfig {
  id: string
  label: string
  color: string
  icon: string
  complete: boolean
}

/** Overrides a project may set in its own file. An absent field falls back to the global settings. */
export interface ProjectConfig {
  defaultView?: ViewMode
  autoArchiveDays?: number
  showSubtreeConnections?: boolean
  lineBorders?: LineBorders
}

/**
 * A project's config with every fallback applied. Views and modals read this rather
 * than the global settings, so another task source can supply its own configuration.
 */
export interface ResolvedProjectConfig {
  statuses: StatusConfig[]
  priorities: PriorityConfig[]
  priorityIcons: PriorityIconSet
  defaultView: ViewMode
  autoArchiveDays: number
  showSubtreeConnections: boolean
  lineBorders: LineBorders
}

export interface PriorityConfig {
  id: TaskPriority
  label: string
  color: string
  icon: string
}

export type PriorityIconSet = 'chevrons' | 'signal' | 'arrows' | 'alerts' | 'none'

/** One icon per rank, highest priority first. Ranks past the fifth carry no icon. */
export const PRIORITY_ICON_SETS: Record<PriorityIconSet, string[]> = {
  chevrons: ['chevrons-up', 'chevron-up', 'equal', 'chevron-down', 'chevrons-down'],
  signal: ['signal', 'signal-high', 'signal-medium', 'signal-low', 'signal-zero'],
  arrows: ['arrow-up', 'arrow-up-right', 'arrow-right', 'arrow-down-right', 'arrow-down'],
  alerts: ['octagon-alert', 'triangle-alert', 'circle-alert', 'info', 'circle-small'],
  none: []
}

export interface PMSettings {
  /** Where new projects are created. Projects are discovered vault-wide, wherever they live. */
  projectsFolder: string
  /** Folders discovery skips, for templates and archives holding pm-project notes. */
  excludedFolders: string[]
  defaultView: ViewMode
  ganttGranularity: GanttGranularity
  ganttWeekLabel: GanttWeekLabel
  statuses: StatusConfig[]
  priorities: PriorityConfig[]
  /** Icons for priorities that don't carry their own. */
  priorityIcons: PriorityIconSet
  /** Days after completion before a task moves to its project's archive. 0 turns it off. */
  autoArchiveDays: number
  /** The day the archive sweep last ran, so it runs at most once a day. */
  lastAutoArchiveDate: string
  showSubtreeConnections: boolean
  lineBorders: LineBorders
  showTagColors: boolean
  /** Moment-style tokens for every date label. Empty uses the default date format. */
  dateFormat: string
  saveTaskOnClose: boolean
  taskEditorSurface: 'modal' | 'tab'
  /** Key shortcut to create or save tasks and projects. */
  editorSaveModifier: 'Shift' | 'Mod'
  /** Where a project link lands: its overview page or its tasks in the default view. */
  projectSurface: 'overview' | 'tasks'
  /** Keyed by scope key, e.g. `project:Projects/Roadmap.md`. */
  projectFilters: Record<string, PerProjectFilter>
  /** The fields a scope shows before it has an entry in `projectFilters`. */
  defaultFields: ViewFields
  /** Collapsed task ids per project path. Lives here so a toggle doesn't rewrite task files. */
  collapsedTasks: Record<string, string[]>
  /** Whether the project list shows archived projects. */
  showArchivedProjects: boolean
  projectList: ProjectListState
  /** Open the release notes in a tab after the plugin updates. */
  showReleaseNotes: boolean
  /** The plugin version that last ran, so an update can be told apart from a restart. */
  lastSeenVersion: string
}

export const DEFAULT_STATUSES: StatusConfig[] = [
  { id: 'capture', label: 'capture', color: '#8a94a0', icon: '', complete: false },
  { id: 'next', label: 'next', color: '#8b72be', icon: '', complete: false },
  { id: 'in-progress', label: 'in-progress', color: '#c47070', icon: '', complete: false },
  { id: 'done', label: 'done', color: '#79b58d', icon: '', complete: true },
  { id: 'someday', label: 'someday', color: '#767491', icon: '', complete: false }
]

export const DEFAULT_PRIORITIES: PriorityConfig[] = [
  { id: 'yesterday', label: 'yesterday', color: '#c47070', icon: '' },
  { id: 'high', label: 'high', color: '#b8a06b', icon: '' },
  { id: 'medium', label: 'medium', color: '#8a94a0', icon: '' },
  { id: 'low', label: 'low', color: '#79b58d', icon: '' }
]

/** The default palettes for a vault that has none yet. */
export function defaultStatuses(): StatusConfig[] {
  return DEFAULT_STATUSES.map((status) => ({ ...status }))
}

export function defaultPriorities(): PriorityConfig[] {
  return DEFAULT_PRIORITIES.map((priority) => ({ ...priority }))
}

export const DEFAULT_SETTINGS: PMSettings = {
  projectsFolder: 'Projects',
  excludedFolders: [],
  defaultView: 'table',
  ganttGranularity: 'week',
  ganttWeekLabel: 'weekNumber',
  statuses: DEFAULT_STATUSES,
  priorities: DEFAULT_PRIORITIES,
  priorityIcons: 'chevrons',
  showSubtreeConnections: true,
  lineBorders: 'none',
  showTagColors: true,
  dateFormat: '',
  autoArchiveDays: 0,
  lastAutoArchiveDate: '',
  saveTaskOnClose: true,
  taskEditorSurface: 'modal',
  editorSaveModifier: 'Shift',
  projectSurface: 'overview',
  projectFilters: {},
  defaultFields: {},
  collapsedTasks: {},
  showArchivedProjects: false,
  projectList: makeDefaultProjectList(),
  showReleaseNotes: true,
  lastSeenVersion: ''
}

export function makeId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

export function makeTask(overrides: Partial<Task> = {}): Task {
  const now = new Date().toISOString()
  return {
    id: makeId(),
    title: 'New task',
    description: '',
    type: 'task',
    status: 'capture',
    priority: 'medium',
    start: today().toString(),
    due: '',
    progress: 0,
    completed: '',
    tags: [],
    subtasks: [],
    dependencies: [],
    createdAt: now,
    updatedAt: now,
    ...overrides
  }
}

export const DEFAULT_PROJECT_COLOR = '#8b72be'
export const DEFAULT_PALETTE_COLOR = '#8a94a0'
export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/
export const DEFAULT_PROJECT_ICON = '📋'

export function makeProject(title: string, filePath: string): Project {
  const now = new Date().toISOString()
  return {
    id: makeId(),
    title,
    description: '',
    color: DEFAULT_PROJECT_COLOR,
    icon: DEFAULT_PROJECT_ICON,
    tasks: [],
    createdAt: now,
    updatedAt: now,
    filePath,
    taskIndex: new Map()
  }
}

export function makeDefaultProjectList(): ProjectListState {
  return { filter: {}, sort: [], group: 'none' }
}

export function makeDefaultSort(): SortRule[] {
  return [{ key: 'status', dir: 'asc' }]
}

export function makeDefaultFilter(): FilterState {
  return { conditions: [], showArchived: false }
}
