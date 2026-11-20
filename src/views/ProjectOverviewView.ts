import { ButtonComponent, Menu, Component, ItemView, MarkdownRenderer, WorkspaceLeaf } from 'obsidian'
import type PMPlugin from '#main'
import { addTabPageItems, refreshTabTitle } from '#ui/tab'
import {
  type Project,
  type ResolvedProjectConfig,
  type Task,
  collectAllTags,
  flattenTasks,
  Temporal,
  formatDateLong,
  parsePlainDate,
  today,
  dateUrgency,
  isTerminalStatus
} from '@dotpm/core'
import {
  safeAsync,
  EmptyState,
  ProgressBar,
  renderPropRow,
  renderDueChip,
  renderMetricStrip,
  type MetricStat,
  renderMilestoneTimeline,
  type MilestonePoint,
  renderTagChip,
  renderGlyph
} from '@dotpm/ui'

export const PM_PROJECT_OVERVIEW_VIEW_TYPE = 'pm-project-overview'

export interface ProjectOverviewState {
  filePath?: string
  [key: string]: unknown
}

const MAX_TAGS = 8

interface Rollup {
  total: number
  done: number
  overdue: number
  latestDue: string
}

export class ProjectOverviewView extends ItemView {
  plugin: PMPlugin
  private state: ProjectOverviewState = {}
  private project: Project | null = null
  private description = new Component()
  private container!: HTMLElement

  constructor(leaf: WorkspaceLeaf, plugin: PMPlugin) {
    super(leaf)
    this.plugin = plugin
    this.navigation = false
  }

  getViewType(): string {
    return PM_PROJECT_OVERVIEW_VIEW_TYPE
  }
  getDisplayText(): string {
    return this.project?.title ?? `Project`
  }
  getIcon(): string {
    return 'gauge'
  }

  onPaneMenu(menu: Menu, source: string): void {
    super.onPaneMenu(menu, source)
    const project = this.project
    if (!project) return
    addTabPageItems(menu, this.plugin, this.leaf, project.filePath, ['tasks', 'edit', 'note'])
  }

  async setState(state: ProjectOverviewState, result: unknown): Promise<void> {
    const changed = state.filePath !== this.state.filePath
    this.state = state
    if (changed || !this.project) await this.loadProject()
    await super.setState(state, result as import('obsidian').ViewStateResult)
  }

  getState(): ProjectOverviewState {
    return this.state
  }

  onOpen(): Promise<void> {
    this.containerEl.addClass('pm-view')
    this.contentEl.empty()
    this.contentEl.addClass('pm-root')
    this.container = this.contentEl.createDiv('pm-overview')
    this.register(
      this.plugin.store.onProjectChanged((path) => {
        if (path !== this.project?.filePath) return
        refreshTabTitle(this.leaf)
        this.render()
      })
    )
    return Promise.resolve()
  }

  onClose(): Promise<void> {
    this.description.unload()
    this.contentEl.empty()
    return Promise.resolve()
  }

  private async loadProject(): Promise<void> {
    const path = this.state.filePath
    this.project = path ? await this.plugin.store.loadProjectByPath(path) : null
    refreshTabTitle(this.leaf)
    if (!this.project) {
      this.renderMissing()
      return
    }
    this.render()
  }

  private renderMissing(): void {
    this.container.empty()
    new EmptyState(this.container)
      .setIcon('📋')
      .setTitle(`No project here`)
      .setBody(`It may have been deleted or renamed.`)
  }

  render(): void {
    const project = this.project
    if (!project) return
    this.container.empty()

    const config = this.plugin.store.configFor(project)
    const tasks = flattenTasks(project.tasks)
      .map((entry) => entry.task)
      .filter((task) => !task.archived)
    const rollup = summarize(tasks, config)

    this.renderArchivedBanner(project)
    this.renderHeader(project, rollup)
    const grid = this.container.createDiv('pm-overview-grid')
    const main = grid.createDiv('pm-overview-main')
    const side = grid.createDiv('pm-overview-side')

    this.renderMetrics(main, project, rollup)
    this.renderDescription(main, project)
    this.renderMilestones(main, tasks, config)
    this.renderProperties(side, project, rollup)
  }

  private renderArchivedBanner(project: Project): void {
    if (!this.plugin.index.isArchived(project.filePath)) return
    const banner = this.container.createDiv('pm-overview-banner')
    banner.createSpan({ text: `This project is archived. It stays out of the project list, pickers and reminders.` })
    if (project.archived) {
      new ButtonComponent(banner)
        .setButtonText(`Unarchive`)
        .onClick(safeAsync(() => this.plugin.setProjectArchived(project.filePath, false)))
    }
  }

  private renderHeader(project: Project, rollup: Rollup): void {
    const header = this.container.createDiv('pm-overview-header')
    const tile = header.createDiv({ cls: 'pm-overview-icon' })
    tile.style.setProperty('--pm-overview-tint', project.color)
    renderGlyph(tile, { icon: project.icon, color: project.color })

    const identity = header.createDiv('pm-overview-identity')
    identity.createDiv({ cls: 'pm-overview-title', text: project.title })
    const bits = [
      rollup.total === 1
        ? `${rollup.done} of ${rollup.total} task done`
        : `${rollup.done} of ${rollup.total} tasks done`
    ]
    identity.createDiv({ cls: 'pm-overview-subline', text: bits.join(' · ') })

    if (!this.plugin.index.isArchived(project.filePath)) {
      new ButtonComponent(header)
        .setButtonText(`Archive`)
        .setTooltip(`Archive this project`)
        .onClick(safeAsync(() => this.plugin.setProjectArchived(project.filePath, true)))
    }
    new ButtonComponent(header)
      .setButtonText(`Edit project`)
      .onClick(safeAsync(() => this.plugin.router.openProjectEdit(project.filePath, this.leaf)))
    new ButtonComponent(header)
      .setButtonText(`Open as note`)
      .onClick(safeAsync(() => this.plugin.openAsMarkdown(project.filePath, this.leaf)))
    new ButtonComponent(header)
      .setButtonText(`Open tasks`)
      .setCta()
      .onClick(safeAsync(() => this.plugin.router.openScope({ kind: 'project', path: project.filePath }, this.leaf)))
  }

  private section(parent: HTMLElement, title: string, note = ''): HTMLElement {
    const section = parent.createDiv('pm-overview-section')
    const head = section.createDiv('pm-overview-section-head')
    head.createSpan({ cls: 'pm-section-label', text: title })
    if (note) head.createSpan({ cls: 'pm-overview-note', text: note })
    return section
  }

  private renderMetrics(parent: HTMLElement, project: Project, rollup: Rollup): void {
    const percent = rollup.total ? (rollup.done / rollup.total) * 100 : 0
    const stats: MetricStat[] = [
      {
        label: `Progress`,
        value: `${Math.round(percent)}%`,
        sub: rollup.total === 1 ? `of ${rollup.total} task` : `of ${rollup.total} tasks`,
        extra: (el) => {
          new ProgressBar(el).setSize('sm').setValue(percent).setColor(project.color)
        }
      },
      {
        label: `Tasks`,
        value: `${rollup.done} of ${rollup.total}`,
        sub: `done`
      },
      {
        label: `Overdue`,
        value: String(rollup.overdue),
        sub: `tasks past due`,
        alert: rollup.overdue > 0
      }
    ]
    renderMetricStrip(parent, stats)
  }

  private renderDescription(parent: HTMLElement, project: Project): void {
    const section = this.section(parent, `Description`)
    const body = section.createDiv('pm-overview-description')
    void this.hydrateDescription(project, body)
  }

  private async hydrateDescription(project: Project, host: HTMLElement): Promise<void> {
    await this.plugin.store.loadProjectBody(project)
    if (!host.isConnected) return
    host.empty()
    if (!project.description.trim()) {
      host.createDiv({ cls: 'pm-overview-muted', text: `No description.` })
      return
    }
    this.description.unload()
    this.description = new Component()
    this.description.load()
    await MarkdownRenderer.render(this.plugin.app, project.description, host, project.filePath, this.description)
  }

  private renderMilestones(parent: HTMLElement, tasks: Task[], config: ResolvedProjectConfig): void {
    const dated: { task: Task; date: Temporal.PlainDate }[] = []
    for (const task of tasks) {
      if (task.type !== 'milestone') continue
      const date = parsePlainDate(task.due)
      if (date) dated.push({ task, date })
    }
    dated.sort((a, b) => Temporal.PlainDate.compare(a.date, b.date))

    const done = dated.filter((entry) => isTerminalStatus(entry.task.status, config.statuses)).length
    const note = dated.length ? `${done} of ${dated.length} done` : ''
    const section = this.section(parent, `Milestones`, note)
    if (dated.length === 0) {
      section.createDiv({ cls: 'pm-overview-muted', text: `No milestones.` })
      return
    }

    const now = today()
    const first = dated[0].date
    const last = dated[dated.length - 1].date
    const lo = Temporal.PlainDate.compare(now, first) < 0 ? now : first
    const hi = Temporal.PlainDate.compare(now, last) > 0 ? now : last
    const span = Math.max(lo.until(hi, { largestUnit: 'day' }).days, 1)
    const pad = Math.max(Math.round(span * 0.06), 1)
    const start = lo.subtract({ days: pad })
    const total = span + pad * 2
    const posOf = (date: Temporal.PlainDate): number =>
      Math.round((start.until(date, { largestUnit: 'day' }).days / total) * 1000) / 10

    let nextTaken = false
    const points: MilestonePoint[] = dated.map((entry) => {
      let state: MilestonePoint['state'] = 'plan'
      if (isTerminalStatus(entry.task.status, config.statuses)) {
        state = 'done'
      } else if (!nextTaken) {
        state = 'next'
        nextTaken = true
      }
      return { name: entry.task.title, dateLabel: formatDateLong(entry.task.due), pos: posOf(entry.date), state }
    })
    renderMilestoneTimeline(section, points, posOf(now))
  }

  private renderProperties(parent: HTMLElement, project: Project, rollup: Rollup): void {
    const section = this.section(parent, `Properties`)
    const list = section.createDiv('pm-overview-props')
    const prop = (label: string, empty: boolean, emptyText: string, fill: (value: HTMLElement) => void): void => {
      renderPropRow(list, label, () => {
        const value = createDiv('pm-prop-value')
        if (empty) value.createSpan({ cls: 'pm-overview-muted', text: emptyText })
        else fill(value)
        return value
      })
    }

    const tags = collectAllTags(project.tasks)
    prop(`Tags`, tags.length === 0, `No tags`, (value) => {
      for (const tag of tags.slice(0, MAX_TAGS)) renderTagChip(value, tag, this.plugin.settings.showTagColors)
      if (tags.length > MAX_TAGS) {
        value.createSpan({ cls: 'pm-overview-muted', text: `+${tags.length - MAX_TAGS}` })
      }
    })

    prop(`Latest due`, !rollup.latestDue, `No dates`, (value) => {
      renderDueChip(value, formatDateLong(rollup.latestDue), dateUrgency(rollup.latestDue, rollup.overdue > 0))
    })
  }
}

function summarize(tasks: Task[], config: ResolvedProjectConfig): Rollup {
  const now = today()
  const rollup: Rollup = { total: 0, done: 0, overdue: 0, latestDue: '' }
  for (const task of tasks) {
    rollup.total++
    const complete = isTerminalStatus(task.status, config.statuses)
    if (complete) rollup.done++
    const due = parsePlainDate(task.due)
    if (!due) continue
    if (task.due > rollup.latestDue) rollup.latestDue = task.due
    if (!complete && Temporal.PlainDate.compare(due, now) < 0) rollup.overdue++
  }
  return rollup
}
