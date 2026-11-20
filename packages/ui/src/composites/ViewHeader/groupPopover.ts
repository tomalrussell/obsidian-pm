import { Checkbox } from '#primitives/Checkbox'
import { Popover } from '#primitives/Popover'
import { type GroupState } from '@dotpm/core'
import { renderPopHead } from '../popoverParts'
import { renderGlyph } from '../properties/optionList'
import { renderVisibilityList } from '../visibilityList'
import type { BoardColumn } from '../../views/boardColumns'

export interface GroupPopoverProps {
  /** Edited in place. */
  group: GroupState
  /** The columns as the board would draw them now, asked again after every change. */
  columns: () => BoardColumn[]
  onChange: () => void
}

/** Status column visibility, empty columns, and drag ordering. */
export function renderGroupPanel(parent: HTMLElement, props: GroupPopoverProps): void {
  const body = parent.createDiv('pm-group-pop')
  const { group } = props

  const prefs = () => {
    group.columns ??= {}
    return group.columns
  }

  const changed = (): void => {
    render()
    props.onChange()
  }

  const render = (): void => {
    body.empty()
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

/** The status columns panel in a popover under `anchor`. */
export const openGroupPopover = (anchor: HTMLElement, props: GroupPopoverProps): Popover =>
  Popover.show({ anchor, width: 300 }, (el) => renderGroupPanel(el, props))
