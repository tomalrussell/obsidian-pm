import { ChipButton } from '#primitives/ChipButton'
import { IconButton } from '#primitives/IconButton'
import { Popover } from '#primitives/Popover'
import {
  type DateBucket,
  type FilterCondition,
  type FilterContext,
  type FilterOp,
  type FilterState,
  type PriorityConfig,
  type Task,
  BUILTIN_FILTER_FIELDS,
  OPS_BY_KIND,
  filterFieldIcon,
  filterFieldLabel,
  filterKind,
  filterValue,
  formatDate,
  isConditionComplete,
  priorityIcon
} from '@dotpm/core'
import { renderPopHead, renderPopSearch } from '../popoverParts'
import { renderOptionRow } from '../properties/optionList'

/** Everything the filter bar and its popover read to name fields and offer values. */
export interface FilterSetup {
  /** Edited in place. */
  filter: FilterState
  /** Every task in scope, subtasks included. */
  tasks: Task[]
  ctx: FilterContext
  priorities: PriorityConfig[]
  /** The projects in view, when there are several; the project field is offered only then. */
  projects: { id: string; title: string; color?: string }[]
}

interface ValueOption {
  id: string
  label: string
  icon?: string
  color?: string
}

const DATE_BUCKETS: DateBucket[] = ['overdue', 'today', 'this-week', 'this-month']

const bucketLabel = (bucket: DateBucket): string =>
  ({
    overdue: 'Overdue',
    today: 'Today',
    'this-week': 'This week',
    'this-month': 'This month'
  })[bucket]

/**
 * The built-in fields the picker offers.
 * Project isn't offered, since the project switcher decides which projects are in view; a
 * project condition a saved view already holds still shows and matches.
 */
export function offeredFields(): string[] {
  return BUILTIN_FILTER_FIELDS.filter((field) => field !== 'project')
}

export function valueOptions(setup: FilterSetup, field: string): ValueOption[] {
  const { ctx } = setup
  switch (field) {
    case 'status':
      return ctx.statuses.map((s) => ({ id: s.id, label: s.label, icon: s.icon, color: s.color }))
    case 'priority':
      return setup.priorities.map((p) => ({
        id: p.id,
        label: p.label,
        icon: priorityIcon(setup.priorities, p.id),
        color: p.color
      }))
    case 'type':
      return [
        { id: 'task', label: 'Task' },
        { id: 'subtask', label: 'Subtask' },
        { id: 'milestone', label: 'Milestone' }
      ]
    case 'project':
      return setup.projects.map((p) => ({ id: p.id, label: p.title, color: p.color }))
  }
  const seen = new Map<string, ValueOption>()
  for (const task of setup.tasks) {
    const value = filterValue(task, field, ctx)
    for (const v of Array.isArray(value) ? value : typeof value === 'string' && value ? [value] : []) {
      const key = v
      if (!seen.has(key)) seen.set(key, { id: v, label: v })
    }
  }
  const options = [...seen.values()]
  return options.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0))
}

function opLabel(op: FilterOp, count: number): string {
  switch (op) {
    case 'any':
      return count > 1 ? 'is any of' : 'is'
    case 'none':
      return count > 1 ? 'is none of' : 'is not'
    case 'all':
      return 'has all of'
    case 'empty':
      return 'is empty'
    case 'not-empty':
      return 'is not empty'
    case 'contains':
      return 'contains'
    case 'not-contains':
      return 'does not contain'
    case 'between':
      return 'is between'
    case 'bucket':
      return 'is'
  }
}

function rangeText(from: string, to: string): string {
  if (from && to) return `${from} to ${to}`
  return from ? `from ${from}` : `until ${to}`
}

/** The operator and value words a chip shows for a condition. */
export function describeCondition(setup: FilterSetup, condition: FilterCondition): { op: string; value: string } {
  const { value } = condition
  const values = Array.isArray(value) ? value : []
  const op = opLabel(condition.op, values.length)
  switch (condition.op) {
    case 'any':
    case 'none':
    case 'all': {
      const options = valueOptions(setup, condition.field)
      const labels = values.map((id) => options.find((o) => o.id === id)?.label ?? id)
      return { op, value: labels.join(', ') }
    }
    case 'contains':
    case 'not-contains':
      return { op, value: typeof value === 'string' ? value : '' }
    case 'bucket':
      return { op, value: typeof value === 'string' ? bucketLabel(value as DateBucket) : '' }
    case 'between': {
      const [from = '', to = ''] = values.map((v) => (v ? formatDate(v) : v))
      return { op, value: rangeText(from, to) }
    }
    default:
      return { op, value: '' }
  }
}

function countFor(setup: FilterSetup, field: string, id: string): number {
  const key = id
  let count = 0
  for (const task of setup.tasks) {
    if (task.archived && !setup.filter.showArchived) continue
    const value = filterValue(task, field, setup.ctx)
    const held = Array.isArray(value) ? value : typeof value === 'string' ? [value] : []
    if (held.some((v) => v === key)) count++
  }
  return count
}

/**
 * The field picker, which drills into one field's operator and value, or straight into
 * the condition at `start`. With `start` set to `'list'` it opens on the applied
 * conditions instead, for when the filter bar has no room for its chips; with none applied
 * yet it opens on the picker, which leads back to that list. Every edit
 * applies at once: a condition joins the filter as soon as it narrows anything and leaves
 * it when its values are cleared. `showClear: false` leaves Clear all out of the list, for
 * a host that has its own.
 */
export function renderFilterPanel(
  parent: HTMLElement,
  setup: FilterSetup,
  onChange: () => void,
  start?: number | 'list',
  { showClear = true }: { showClear?: boolean } = {}
): void {
  const body = parent.createDiv('pm-filter-pop')
  const { filter } = setup

  const showList = (): void => {
    body.empty()
    const list = body.createDiv('pm-pop-list')
    const remove = (row: HTMLElement, label: string, onRemove: () => void): void => {
      new IconButton(row)
        .setIcon('x')
        .setTooltip(`Remove ${label} filter`)
        .onClick(() => {
          onRemove()
          onChange()
          showList()
        })
        .el.addClass('pm-filter-list-remove')
    }
    filter.conditions.forEach((condition, index) => {
      const label = filterFieldLabel(condition.field)
      const { op, value } = describeCondition(setup, condition)
      const row = list.createDiv('pm-filter-list-row')
      renderOptionRow(row, {
        label,
        icon: filterFieldIcon(condition.field),
        note: `${op} ${value}`.trim(),
        onPick: () => showEditor(index, condition.field, showList)
      })
      remove(row, label, () => filter.conditions.splice(index, 1))
    })
    if (filter.showArchived) {
      const row = list.createDiv('pm-filter-list-row')
      renderOptionRow(row, {
        label: 'Archived',
        icon: 'archive',
        note: 'Included',
        onPick: () => showFields(showList)
      })
      remove(row, 'Archived', () => (filter.showArchived = false))
    }
    renderOptionRow(list, {
      label: 'Add filter',
      icon: 'plus',
      accent: true,
      onPick: () => showFields(showList)
    })
    if (!showClear || (!filter.conditions.length && !filter.showArchived)) return
    const clear = body.createDiv('pm-filter-list-foot pm-pop-section')
    renderOptionRow(clear, {
      label: 'Clear all',
      icon: 'x',
      onPick: () => {
        filter.conditions = []
        filter.showArchived = false
        onChange()
        showList()
      }
    })
  }

  const showFields = (back?: () => void): void => {
    body.empty()
    if (back) {
      renderPopHead(body, {
        title: 'Add filter',
        variant: 'title',
        back: { label: 'Back', onClick: back }
      })
    }
    const search = renderPopSearch(body, 'Filter by...', () => renderList())
    const list = body.createDiv('pm-pop-list')
    const fields = offeredFields()
    const renderList = (): void => {
      list.empty()
      const q = search.value.trim().toLowerCase()
      const shown = fields.filter((field) => !q || filterFieldLabel(field).toLowerCase().includes(q))
      for (const field of shown) {
        const index = filter.conditions.findIndex((c) => c.field === field)
        renderOptionRow(list, {
          label: filterFieldLabel(field),
          icon: filterFieldIcon(field),
          selected: index >= 0,
          onPick: () => showEditor(index >= 0 ? index : null, field, () => showFields(back))
        })
      }
      if (!q) {
        renderOptionRow(list, {
          label: 'Include archived',
          icon: 'archive',
          selected: filter.showArchived,
          onPick: () => {
            filter.showArchived = !filter.showArchived
            onChange()
            renderList()
          }
        })
      }
    }
    search.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return
      list.querySelector<HTMLButtonElement>('button')?.click()
    })
    renderList()
    search.focus()
  }

  const showEditor = (index: number | null, field: string, back?: () => void): void => {
    const kind = filterKind(field)
    if (!kind) return
    let at = index
    const draft: FilterCondition =
      at !== null ? structuredClone(filter.conditions[at]) : { field, op: OPS_BY_KIND[kind][0] }

    const commit = (): void => {
      const complete = isConditionComplete(draft)
      if (complete && at === null) {
        filter.conditions.push(structuredClone(draft))
        at = filter.conditions.length - 1
      } else if (complete && at !== null) {
        filter.conditions[at] = structuredClone(draft)
      } else if (!complete && at !== null) {
        filter.conditions.splice(at, 1)
        at = null
      } else {
        return
      }
      onChange()
    }

    body.empty()
    renderPopHead(body, {
      title: filterFieldLabel(field),
      variant: 'title',
      back: back && { label: 'Back', onClick: back }
    })

    const ops = body.createDiv('pm-filter-pop-ops')
    const valueEl = body.createDiv('pm-filter-pop-value')
    const renderOps = (): void => {
      ops.empty()
      for (const op of OPS_BY_KIND[kind]) {
        new ChipButton(ops)
          .setVariant('outline')
          .setLabel(opLabel(op, 2))
          .setActive(draft.op === op)
          .onClick(() => {
            const listOps: FilterOp[] = ['any', 'none', 'all']
            const keepsValue = listOps.includes(draft.op) && listOps.includes(op)
            draft.op = op
            if (!keepsValue) delete draft.value
            commit()
            renderOps()
            renderValue()
          })
          .el.addClass('pm-filter-pop-op')
      }
    }

    const renderValue = (): void => {
      valueEl.empty()
      switch (draft.op) {
        case 'any':
        case 'none':
        case 'all':
          renderChecklist(valueEl, setup, field, draft, commit)
          return
        case 'contains':
        case 'not-contains': {
          const input = valueEl.createEl('input', {
            cls: 'pm-pop-field',
            attr: { placeholder: 'Value', spellcheck: 'false' }
          })
          input.value = typeof draft.value === 'string' ? draft.value : ''
          input.addEventListener('input', () => {
            draft.value = input.value
            commit()
          })
          input.focus()
          return
        }
        case 'between': {
          const count = 2
          const current = Array.isArray(draft.value) ? draft.value : []
          const row = valueEl.createDiv('pm-filter-pop-range')
          const inputs: HTMLInputElement[] = []
          for (let i = 0; i < count; i++) {
            const input = row.createEl('input', {
              type: 'date',
              cls: 'pm-pop-field',
              attr: { placeholder: 'Value' }
            })
            input.value = current[i] ?? ''
            inputs.push(input)
            input.addEventListener('change', () => {
              draft.value = inputs.map((el) => el.value)
              commit()
            })
          }
          inputs[0]?.focus()
          return
        }
        case 'bucket': {
          const list = valueEl.createDiv('pm-pop-list')
          for (const bucket of DATE_BUCKETS) {
            renderOptionRow(list, {
              label: bucketLabel(bucket),
              selected: draft.value === bucket,
              onPick: () => {
                draft.value = draft.value === bucket ? undefined : bucket
                commit()
                renderValue()
              }
            })
          }
        }
      }
    }

    renderOps()
    renderValue()
    if (at === null) commit()
  }

  if (start === 'list') {
    if (filter.conditions.length || filter.showArchived) showList()
    else showFields(showList)
  } else if (start !== undefined && filter.conditions[start]) {
    showEditor(start, filter.conditions[start].field)
  } else {
    showFields()
  }
}

/** The filter panel in a popover under `anchor`. */
export const openFilterPopover = (
  anchor: HTMLElement,
  setup: FilterSetup,
  onChange: () => void,
  start?: number | 'list'
): Popover => Popover.show({ anchor, width: 300 }, (el) => renderFilterPanel(el, setup, onChange, start))

function renderChecklist(
  parent: HTMLElement,
  setup: FilterSetup,
  field: string,
  draft: FilterCondition,
  commit: () => void
): void {
  const options = valueOptions(setup, field)
  const search = options.length > 8 ? renderPopSearch(parent, 'Find value...', () => render()) : null
  const list = parent.createDiv('pm-pop-list')
  const selected = (): string[] => (Array.isArray(draft.value) ? draft.value.map(String) : [])
  const keyOf = (id: string): string => id
  const render = (): void => {
    list.empty()
    if (!options.length) {
      list.createDiv({ cls: 'pm-pop-empty', text: 'No values in this view yet.' })
      return
    }
    const q = search?.value.trim().toLowerCase() ?? ''
    for (const option of options.filter((o) => !q || o.label.toLowerCase().includes(q))) {
      const isSelected = selected().some((id) => keyOf(id) === keyOf(option.id))
      renderOptionRow(list, {
        label: option.label,
        icon: option.icon,
        color: option.color,
        note: String(countFor(setup, field, option.id)),
        selected: isSelected,
        onPick: () => {
          const current = selected()
          draft.value = isSelected ? current.filter((id) => keyOf(id) !== keyOf(option.id)) : [...current, option.id]
          commit()
          render()
        }
      })
    }
  }
  render()
  search?.focus()
}
