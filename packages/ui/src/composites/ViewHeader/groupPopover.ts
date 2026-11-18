import { Checkbox } from '#primitives/Checkbox'
import { Popover } from '#primitives/Popover'
import { type GroupState } from '@dotpm/core'
import { renderPopHead } from '../popoverParts'
import { renderGlyph } from '../properties/optionList'
import { renderVisibilityList } from '../visibilityList'
import type { BoardColumn } from '../../views/boardColumns'

export interface GroupPopoverProps {
  fields: { id: string; label: string }[]
  /** Edited in place. */
  group: GroupState
  /** The field the columns stand for now, which is the default when `group.field` isn't offered. */
  field: () => string
  /** The columns as the board would draw them now, asked again after every change. */
  columns: () => BoardColumn[]
  onChange: () => void
}

/**
 * What the board's columns stand for, and which of them show: the field, whether empty
 * columns hide, and the column list, dragged to reorder and toggled by its eye.
 */
export function renderGroupPanel(parent: HTMLElement, props: GroupPopoverProps): void {
  const body = parent.createDiv('pm-group-pop')
  const { group } = props

  const prefs = () => {
    group.columns ??= {}
    const key = props.field()
    group.columns[key] ??= {}
    return group.columns[key]
  }

  const changed = (): void => {
    render()
    props.onChange()
  }

  const render = (): void => {
    body.empty()
    const byRow = body.createDiv('pm-group-row')
    byRow.createSpan({ cls: 'pm-group-label', text: 'Columns by' })
    const field = byRow.createEl('select', { cls: 'dropdown pm-group-field' })
    for (const option of props.fields) {
      field.createEl('option', { value: option.id, text: option.label }).selected = option.id === props.field()
    }
    field.addEventListener('change', () => {
      group.field = field.value
      changed()
    })

    const emptyRow = body.createEl('label', { cls: 'pm-group-row' })
    emptyRow.createSpan({ cls: 'pm-group-label', text: 'Hide empty columns' })
    new Checkbox(emptyRow).setChecked(!!group.hideEmpty).onChange((checked) => {
      if (checked) group.hideEmpty = true
      else delete group.hideEmpty
      changed()
    })

    const columns = props.columns()
    renderPopHead(body, {
      title: 'Columns',
      section: true,
      action: {
        label: 'Show all',
        disabled: !prefs().hidden?.length,
        onClick: () => {
          delete prefs().hidden
          changed()
        }
      }
    })

    renderVisibilityList(body, {
      rows: columns.map((column) => ({
        id: column.id,
        label: column.label,
        hidden: prefs().hidden?.includes(column.id) ?? false,
        detail: column.tasks.length ? String(column.tasks.length) : 'empty',
        quiet: !column.tasks.length,
        glyph: (el) => renderGlyph(el, { icon: column.icon, color: column.color })
      })),
      showLabel: 'Show column',
      hideLabel: 'Hide column',
      onToggle: (id) => {
        const hidden = new Set(prefs().hidden ?? [])
        if (hidden.has(id)) hidden.delete(id)
        else hidden.add(id)
        if (hidden.size) prefs().hidden = [...hidden]
        else delete prefs().hidden
        changed()
      },
      onReorder: (ids) => {
        prefs().order = ids
        changed()
      }
    })
  }

  render()
}

/** The group panel in a popover under `anchor`. */
export const openGroupPopover = (anchor: HTMLElement, props: GroupPopoverProps): Popover =>
  Popover.show({ anchor, width: 300 }, (el) => renderGroupPanel(el, props))
