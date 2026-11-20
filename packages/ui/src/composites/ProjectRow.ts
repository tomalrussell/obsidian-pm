import { type ProjectListField } from '@dotpm/core'
import { Chip } from '#primitives/Chip'
import { IconButton } from '#primitives/IconButton'
import { ProgressBar } from '#primitives/ProgressBar'
import { renderDueChip, type DueUrgency } from './dueChip'
import { renderGlyph } from './properties'

export interface ProjectRowProps {
  title: string
  icon: string
  color: string
  /** The cells after the title, in order. */
  fields: ProjectListField[]
  archived: boolean
  tasksDone: number
  tasksTotal: number
  overdue: number
  /** Formatted by the caller; empty when nothing in the project has a date. */
  dueLabel: string
  dueUrgency: DueUrgency
  onClick: () => void
  onContextMenu: (e: MouseEvent) => void
  onActions: (e: MouseEvent) => void
}

const ROW_IGNORE_SELECTOR = 'button, .pm-chip--interactive, .pm-icon-btn'

export class ProjectRow {
  el: HTMLTableRowElement

  constructor(tbody: HTMLElement, props: ProjectRowProps) {
    this.el = tbody.createEl('tr', { cls: 'pm-table-row pm-project-row' })
    if (props.archived) this.el.addClass('pm-table-row--archived')
    const title = this.el.createEl('td', { cls: 'pm-table-cell-title' })
    const inner = title.createDiv('pm-table-title-inner')
    renderGlyph(inner.createSpan({ cls: 'pm-project-row-icon' }), { icon: props.icon, color: props.color })
    inner.createSpan({ text: props.title, cls: 'pm-task-title-text' })
    if (props.archived) new Chip(inner).setLabel('Archived').setVariant('outline').setSize('sm')

    for (const field of props.fields) renderCell(this.el.createEl('td', { cls: 'pm-table-cell' }), field, props)

    const actions = this.el.createEl('td', { cls: 'pm-table-cell pm-table-cell-actions' })
    new IconButton(actions)
      .setIcon('more-horizontal')
      .setTooltip('Project actions')
      .setRevealOnHover(true)
      .onClick((e) => props.onActions(e))

    this.el.addEventListener('click', (e) => {
      const target = e.target as HTMLElement
      if (target.closest(ROW_IGNORE_SELECTOR)) return
      props.onClick()
    })
    this.el.addEventListener('contextmenu', (e) => props.onContextMenu(e))
  }
}

function renderCell(cell: HTMLElement, field: ProjectListField, props: ProjectRowProps): void {
  switch (field) {
    case 'progress':
      cell.addClass('pm-table-cell-progress')
      new ProgressBar(cell)
        .setSize('sm')
        .setValue(props.tasksTotal ? (props.tasksDone / props.tasksTotal) * 100 : 0)
        .setColor(props.color)
        .setShowLabel(true)
      return
    case 'tasks':
      cell.createSpan({ cls: 'pm-project-row-tasks', text: `${props.tasksDone}/${props.tasksTotal}` })
      if (props.overdue > 0) {
        new Chip(cell)
          .setLabel(props.overdue === 1 ? `${props.overdue} overdue` : `${props.overdue} overdue`)
          .setVariant('solid')
          .setColor('var(--color-red)')
          .setSize('sm')
          .setStrong()
      }
      return
    case 'due':
      if (props.dueLabel) renderDueChip(cell, props.dueLabel, props.dueUrgency, 'sm')
      else cell.createSpan({ cls: 'pm-project-row-empty', text: '—' })
  }
}
