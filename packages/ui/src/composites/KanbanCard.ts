import { type Task, formatDate } from '@dotpm/core'
import { Chip } from '#primitives/Chip'
import { ProgressBar } from '#primitives/ProgressBar'
import { renderDueChip } from './dueChip'
import { renderTagChip } from './tagChip'

export interface KanbanCardProps {
  /** The card fields to show, in order (`priority`, `tags`...). */
  fields: string[]
  task: Task
  priorityColor?: string
  descriptionPreview?: string
  parentTitle?: string
  /** Leading slot in the footer, filled when a card has to say where it is from. */
  renderSource?: (parent: HTMLElement) => void
  overdue: boolean
  onClick: () => void
  onContextMenu: (e: MouseEvent) => void
  onDragStart: () => void
  onDragEnd: () => void
}

export class KanbanCard {
  el: HTMLElement

  constructor(parentEl: HTMLElement, props: KanbanCardProps) {
    const { task } = props
    const card = parentEl.createDiv('pm-kanban-card')
    card.draggable = true
    card.dataset.taskId = task.id
    this.el = card

    const { fields } = props
    if (props.priorityColor && fields.includes('priority')) {
      const priorityBar = card.createDiv('pm-kanban-card-priority-bar')
      priorityBar.setCssStyles({ background: props.priorityColor })
    }

    const body = card.createDiv('pm-kanban-card-body')

    if (props.parentTitle) {
      body.createSpan({ text: props.parentTitle, cls: 'pm-kanban-card-parent' })
    }

    const titleRow = body.createDiv('pm-kanban-card-title-row')
    titleRow.createSpan({ text: task.title, cls: 'pm-kanban-card-title' })
    if (task.type === 'milestone') {
      new Chip(titleRow)
        .setLabel('M')
        .setVariant('solid')
        .setSize('sm')
        .setColor('var(--color-purple)')
        .setTooltip('Milestone')
    }
    if (task.type === 'subtask') {
      new Chip(titleRow)
        .setLabel('Sub')
        .setVariant('solid')
        .setSize('sm')
        .setColor('var(--color-green)')
        .setTooltip('Subtask')
    }

    const footer = body.createDiv('pm-kanban-card-footer')
    for (const field of fields) {
      if (field === 'description' && props.descriptionPreview) {
        body.createDiv({ cls: 'pm-kanban-card-description', text: props.descriptionPreview })
      } else if (field === 'tags' && task.tags.length) {
        const tagsEl = body.createDiv('pm-kanban-card-tags')
        for (const tag of task.tags.slice(0, 3)) {
          renderTagChip(tagsEl, tag)
        }
      } else if (field === 'progress' && task.progress > 0) {
        new ProgressBar(body).setSize('sm').setValue(task.progress)
      } else if (field === 'project') {
        props.renderSource?.(footer)
      } else if (field === 'due' && task.due) {
        renderDueChip(footer, formatDate(task.due), props.overdue ? 'overdue' : 'normal', 'sm')
      }
    }
    if (footer.childElementCount) body.appendChild(footer)
    else footer.remove()

    card.addEventListener('dragstart', (e) => {
      e.dataTransfer?.setData('text/plain', task.id)
      card.addClass('pm-kanban-card--dragging')
      window.setTimeout(() => card.addClass('pm-dragging'), 0)
      props.onDragStart()
    })

    card.addEventListener('dragend', () => {
      card.removeClass('pm-kanban-card--dragging')
      card.removeClass('pm-dragging')
      props.onDragEnd()
    })

    card.addEventListener('click', () => props.onClick())
    card.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      props.onContextMenu(e)
    })
  }
}
