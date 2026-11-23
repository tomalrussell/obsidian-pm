import { Menu } from 'obsidian'
import type PMPlugin from '#main'
import {
  type Task,
  type FilterContext,
  type SortRule,
  type TaskQuery,
  type ResolvedProjectConfig,
  type ViewFields,
  shownFields,
  flattenTasks,
  matchesQuery,
  dueUrgency,
  getPriorityConfig
} from '@dotpm/core'
import type { ProjectScope } from '#store'
import {
  safeAsync,
  boardCandidates,
  boardColumns,
  descriptionPreview,
  compareTasks,
  KanbanColumn,
  type KanbanCardData,
  renderProjectChip
} from '@dotpm/ui'
import { openTaskModal } from '#ui/ModalFactory'
import { buildTaskContextMenu } from '#ui/TaskContextMenu'
import type { SubView } from './SubView'

export class KanbanView implements SubView {
  private dragTask: Task | null = null
  /** Resolved once per board render. */
  private config!: ResolvedProjectConfig
  private filterContext!: FilterContext
  /** The card fields, resolved once per board render. */
  private cardFields: string[] = []

  constructor(
    private container: HTMLElement,
    private scope: ProjectScope,
    private plugin: PMPlugin,
    private onRefresh: () => Promise<void>,
    private query: TaskQuery,
    private sort: SortRule[],
    private fields: ViewFields
  ) {}

  render(): void {
    this.renderBoard()
    if (this.cardFields.includes('description')) {
      void this.hydrateDescriptions()
    }
  }

  private renderBoard(): void {
    this.config = this.scope.config
    this.filterContext = this.scope.filterContext()
    this.cardFields = shownFields(this.fields, 'kanban', this.scope.fieldCatalog())
    this.container.empty()
    this.container.addClass('pm-kanban-view')

    const board = this.container.createDiv('pm-kanban-board')
    const columns = boardColumns(this.visibleTasks())
    for (const column of columns) {
      new KanbanColumn(board, {
        column,
        fields: this.cardFields,
        cards: column.tasks.map((task) => this.buildCardData(task)),
        onCardClick: (task) => this.openTask(task),
        onCardContextMenu: (task, e) => this.openContextMenu(task, e),
        onCardDragStart: (task) => {
          this.dragTask = task
        },
        onCardDragEnd: () => {
          this.dragTask = null
        },
        onDrop: (taskId, to) => this.handleDrop(taskId, to)
      })
    }

  }

  /** Descriptions load lazily from the note body, so previews fill in on a second render. */
  private async hydrateDescriptions(): Promise<void> {
    const pending = boardCandidates(this.scope.tasks(), this.cardFields).filter(
      (t) => t.filePath && !t.description && matchesQuery(t, this.query, this.filterContext)
    )
    if (!pending.length) return
    await Promise.all(pending.map((t) => this.plugin.store.loadTaskBody(t)))
    if (pending.some((t) => t.description)) this.renderBoard()
  }

  private visibleTasks(): Task[] {
    return boardCandidates(this.scope.tasks(), this.cardFields)
      .filter((task) => matchesQuery(task, this.query, this.filterContext))
      .sort((a, b) => compareTasks(a, b, this.sort, this.config.statuses, this.config.priorities))
  }

  private buildCardData(task: Task): KanbanCardData {
    const priorityConfig = getPriorityConfig(this.config.priorities, task.priority)
    const priorityColor =
      priorityConfig && task.priority !== 'medium' && task.priority !== 'low' ? priorityConfig.color : undefined

    let parentTitle: string | undefined
    if (this.cardFields.includes('subtasks') && task.type === 'subtask') {
      const parent = this.findParentTask(task.id)
      if (parent) parentTitle = parent.title
    }

    const owner = this.scope.isMulti ? this.scope.projectOf(task.id) : null

    return {
      task,
      priorityColor,
      descriptionPreview: this.cardFields.includes('description') ? descriptionPreview(task.description) : undefined,
      parentTitle,
      renderSource: owner
        ? (el) =>
            renderProjectChip(el, {
              title: owner.title,
              color: owner.color,
              onClick: safeAsync(() => this.plugin.router.openProjectLink(owner.filePath))
            })
        : undefined,
      overdue: dueUrgency(task, this.config.statuses) === 'overdue',
      showTagColors: this.plugin.settings.showTagColors
    }
  }

  private findParentTask(taskId: string): Task | null {
    for (const ft of flattenTasks(this.scope.tasks())) {
      const parent = ft.task
      if (parent.subtasks.some((s) => s.id === taskId)) return parent
    }
    return null
  }

  private openTask(task: Task): void {
    const owner = this.scope.projectOf(task.id)
    if (!owner) return
    openTaskModal(this.plugin, owner, {
      task,
      onSave: async () => {
        await this.onRefresh()
      }
    })
  }

  private openContextMenu(task: Task, e: MouseEvent): void {
    const owner = this.scope.projectOf(task.id)
    if (!owner) return
    const menu = new Menu()
    buildTaskContextMenu(menu, task, { plugin: this.plugin, project: owner, onRefresh: this.onRefresh })
    menu.showAtMouseEvent(e)
  }

  private async handleDrop(taskId: string, status: string): Promise<void> {
    const task = this.dragTask
    if (!task || task.id !== taskId || task.status === status) return
    if (!this.config.statuses.some((option) => option.id === status)) return
    const owner = this.scope.projectOf(taskId)
    if (!owner) return
    await this.plugin.store.updateTask(owner, task.id, { status })
    await this.onRefresh()
  }
}
