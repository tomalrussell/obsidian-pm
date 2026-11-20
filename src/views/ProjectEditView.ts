import { ButtonComponent, Menu, ItemView, WorkspaceLeaf } from 'obsidian'
import type PMPlugin from '#main'
import { addTabPageItems, refreshTabTitle } from '#ui/tab'
import { type Project, type ProjectConfig, type ProjectPatch } from '@dotpm/core'
import {
  safeAsync,
  renderPropRow,
  renderGlyph,
  renderIconControl,
  renderInputControl,
  renderSelectControl,
  EmptyState
} from '@dotpm/ui'
import { confirmDialog } from '#ui/ModalFactory'

export const PM_PROJECT_EDIT_VIEW_TYPE = 'pm-project-edit'

export interface ProjectEditState {
  filePath?: string
  [key: string]: unknown
}

export class ProjectEditView extends ItemView {
  plugin: PMPlugin
  private state: ProjectEditState = {}
  private project: Project | null = null
  private container!: HTMLElement

  constructor(leaf: WorkspaceLeaf, plugin: PMPlugin) {
    super(leaf)
    this.plugin = plugin
    this.navigation = false
  }

  getViewType(): string {
    return PM_PROJECT_EDIT_VIEW_TYPE
  }
  getDisplayText(): string {
    return this.project?.title ?? `Project`
  }
  getIcon(): string {
    return 'settings'
  }

  onPaneMenu(menu: Menu, source: string): void {
    super.onPaneMenu(menu, source)
    const project = this.project
    if (!project) return
    addTabPageItems(menu, this.plugin, this.leaf, project.filePath, ['overview', 'tasks', 'note'])
  }

  async setState(state: ProjectEditState, result: unknown): Promise<void> {
    const changed = state.filePath !== this.state.filePath
    this.state = state
    if (changed || !this.project) await this.loadProject()
    await super.setState(state, result as import('obsidian').ViewStateResult)
  }

  getState(): ProjectEditState {
    return this.state
  }

  onOpen(): Promise<void> {
    this.containerEl.addClass('pm-view')
    this.contentEl.empty()
    this.contentEl.addClass('pm-root')
    this.container = this.contentEl.createDiv('pm-edit')
    return Promise.resolve()
  }

  onClose(): Promise<void> {
    this.contentEl.empty()
    return Promise.resolve()
  }

  private async loadProject(): Promise<void> {
    const path = this.state.filePath
    this.project = path ? await this.plugin.store.loadProjectByPath(path) : null
    if (!this.project) {
      this.container.empty()
      new EmptyState(this.container)
        .setIcon('📋')
        .setTitle(`No project here`)
        .setBody(`It may have been deleted or renamed.`)
      return
    }
    await this.plugin.store.loadProjectBody(this.project)
    refreshTabTitle(this.leaf)
    this.render()
  }

  private readonly save = safeAsync(async (patch: ProjectPatch) => {
    if (this.project) await this.plugin.store.updateProject(this.project, patch)
  })

  /** Sets or clears one override; the config goes away entirely when its last field clears. */
  private patchConfig<K extends keyof ProjectConfig>(key: K, value: ProjectConfig[K] | undefined): void {
    const entries = Object.entries({ ...this.project?.config, [key]: value }).filter(([, v]) => v !== undefined)
    this.save({ config: entries.length ? Object.fromEntries(entries) : undefined })
    // Today's pass ran against the old window, so it has to run again.
    if (key === 'autoArchiveDays') this.plugin.settings.lastAutoArchiveDate = ''
  }

  private section(title: string, hint = ''): HTMLElement {
    const section = this.container.createDiv('pm-edit-section')
    section.createDiv({ cls: 'pm-section-label', text: title })
    if (hint) section.createDiv({ cls: 'pm-modal-hint', text: hint })
    return section
  }

  render(): void {
    const project = this.project
    if (!project) return
    this.container.empty()

    this.renderHeader(project)
    this.renderGeneral(project)
    this.renderBehavior(project)
    this.renderDangerZone(project)
  }

  private renderHeader(project: Project): void {
    const header = this.container.createDiv('pm-edit-header')
    const tile = header.createDiv({ cls: 'pm-overview-icon' })
    tile.style.setProperty('--pm-overview-tint', project.color)
    renderGlyph(tile, { icon: project.icon, color: project.color })
    const identity = header.createDiv('pm-overview-identity')
    identity.createDiv({ cls: 'pm-overview-title', text: project.title })
    identity.createDiv({ cls: 'pm-overview-subline', text: `Project settings` })
    new ButtonComponent(header)
      .setButtonText(`Done`)
      .setCta()
      .onClick(safeAsync(() => this.plugin.router.openProjectOverview(project.filePath, this.leaf)))
  }

  private renderGeneral(project: Project): void {
    const section = this.section(`General`)
    const props = section.createDiv('pm-edit-props')

    renderPropRow(props, `Name`, () => {
      const cell = createDiv('pm-prop-value')
      renderInputControl({
        container: cell,
        value: project.title,
        placeholder: `Project name`,
        onChange: (value) => {
          const title = value.trim()
          if (!title || title === project.title) return
          this.save({ title })
          this.render()
          refreshTabTitle(this.leaf)
        }
      })
      return cell
    })

    renderPropRow(props, `Icon`, () => {
      const cell = createDiv('pm-prop-value')
      renderIconControl({
        container: cell,
        value: project.icon,
        color: project.color,
        onChange: (icon) => {
          this.save({ icon })
          this.render()
        }
      })
      return cell
    })

    renderPropRow(props, `Color`, () => {
      const cell = createDiv('pm-prop-value')
      const picker = cell.createEl('input', { type: 'color', cls: 'pm-color-custom' })
      picker.value = project.color
      picker.title = `Project color`
      picker.addEventListener('change', () => {
        this.save({ color: picker.value })
        this.render()
      })
      return cell
    })

    renderPropRow(props, `Archived`, () => {
      const cell = createDiv('pm-prop-value')
      renderSelectControl({
        container: cell,
        value: project.archived ? 'yes' : 'no',
        options: [
          { id: 'no', label: `No` },
          { id: 'yes', label: `Yes` }
        ],
        onChange: (id) => {
          this.save({ archived: id === 'yes' || undefined })
          this.render()
        }
      })
      return cell
    })

    const desc = section.createDiv('pm-edit-block')
    desc.createEl('label', { text: `Description`, cls: 'pm-label' })
    const area = desc.createEl('textarea', { cls: 'pm-input pm-edit-desc' })
    area.placeholder = `What is this project about?`
    area.value = project.description
    area.addEventListener('change', () => {
      this.save({ description: area.value })
    })
  }

  private renderBehavior(project: Project): void {
    const section = this.section(`View and archiving`, `Overrides for this project`)
    const props = section.createDiv('pm-edit-props')
    const row = <K extends keyof ProjectConfig>(
      label: string,
      key: K,
      options: { value: NonNullable<ProjectConfig[K]>; label: string }[]
    ): void => {
      renderPropRow(props, label, () => {
        const cell = createDiv('pm-prop-value')
        const current = project.config?.[key]
        renderSelectControl({
          container: cell,
          value: current === undefined ? 'inherit' : String(options.findIndex((o) => o.value === current)),
          options: [
            { id: 'inherit', label: `Use global` },
            ...options.map((option, i) => ({ id: String(i), label: option.label }))
          ],
          onChange: (id) => {
            this.patchConfig(key, id === 'inherit' ? undefined : options[Number(id)].value)
            this.render()
          }
        })
        return cell
      })
    }

    row(`Default tasks view`, 'defaultView', [
      { value: 'table', label: `Table` },
      { value: 'gantt', label: `Timeline` },
      { value: 'kanban', label: `Board` }
    ])
    row(`Auto-archive completed tasks`, 'autoArchiveDays', [
      { value: 0, label: `Never` },
      ...[7, 14, 30, 90].map((days) => ({
        value: days,
        label: days === 1 ? `After ${days} day` : `After ${days} days`
      }))
    ])
    row(`Subtree connections in table`, 'showSubtreeConnections', [
      { value: true, label: `Show` },
      { value: false, label: `Hide` }
    ])
    row(`Line borders in table`, 'lineBorders', [
      { value: 'none', label: `None` },
      { value: 'horizontal', label: `Horizontal` },
      { value: 'vertical', label: `Vertical` },
      { value: 'both', label: `Both` }
    ])
  }

  private renderDangerZone(project: Project): void {
    const section = this.container.createDiv('pm-edit-danger')
    const text = section.createDiv('pm-edit-danger-text')
    text.createDiv({ cls: 'pm-edit-danger-title', text: `Delete project` })
    text.createDiv({ cls: 'pm-modal-hint', text: `Removes the project note. Its task files are left in the vault.` })
    new ButtonComponent(section)
      .setButtonText(`Delete project`)
      .setDestructive()
      .onClick(
        safeAsync(async () => {
          const ok = await confirmDialog(this.app, `Delete "${project.title}"?`)
          if (!ok) return
          await this.plugin.store.deleteProject(project)
          this.leaf.detach()
        })
      )
  }
}
