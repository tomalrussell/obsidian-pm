import type PMPlugin from '#main'
import {
  type Project,
  type Task,
  type TaskType,
  collectAllTags,
  flattenTasks,
  reaches,
  isTerminalStatus,
  priorityIcon,
  stringToColor,
  completionOutcome,
  relativeDue
} from '@dotpm/core'
import {
  renderPropRow,
  renderSelectControl,
  renderDateControl,
  renderInputControl,
  renderMultiSelect,
  renderAddProperty,
  renderDepRow,
  type SelectItem,
  type HiddenProperty
} from '@dotpm/ui'

export interface TaskFormFieldsContext {
  task: Task
  project: Project
  plugin: PMPlugin
  parentId: string | null
  setParentId: (id: string | null) => void
  rerender: () => void
  shownExtras: Set<string>
  /** Leaves the editor for the task a dependency names. */
  openTask: (path: string) => void
}

const typeOptions = (): SelectItem[] => [
  { id: 'task', label: `Task`, icon: 'square-check-big' },
  { id: 'subtask', label: `Subtask`, icon: 'git-branch' },
  { id: 'milestone', label: `Milestone`, icon: 'diamond' }
]

/**
 * The property grid. Core properties always show; the rest hide when empty behind "Add
 * property". Single-selects and dates re-render the form on change; multi-selects mutate
 * the task in place and refresh their own chips.
 */
export function renderTaskFormFields(container: HTMLElement, ctx: TaskFormFieldsContext): void {
  const { task, project, plugin, rerender, shownExtras } = ctx
  const { statuses, priorities, priorityIcons } = plugin.store.configFor(project)
  const grid = container.createDiv('pm-prop-grid')

  renderPropRow(
    grid,
    `Type`,
    () => {
      const cell = createDiv('pm-prop-value')
      renderSelectControl({
        container: cell,
        value: task.type,
        options: typeOptions(),
        onChange: (id) => {
          task.type = id as TaskType
          if (id === 'milestone') {
            task.start = ''
            task.progress = 0
          }
          if (id !== 'subtask') ctx.setParentId(null)
          rerender()
        }
      })
      return cell
    },
    'shapes'
  )

  // The parent picker shares the type row and shows only for subtasks; an empty cell holds
  // the column otherwise, so switching type never reflows the grid.
  if (task.type === 'subtask') {
    renderPropRow(
      grid,
      `Parent task`,
      () => {
        const cell = createDiv('pm-prop-value')
        const parents = flattenTasks(project.tasks)
          .map((f) => f.task)
          .filter((other) => other.id !== task.id)
        renderSelectControl({
          container: cell,
          value: ctx.parentId,
          options: [{ id: '', label: `No parent` }, ...parents.map((other) => ({ id: other.id, label: other.title }))],
          placeholder: `Select parent`,
          search: true,
          searchPlaceholder: `Search tasks…`,
          width: 230,
          onChange: (id) => {
            ctx.setParentId(id || null)
            rerender()
          }
        })
        return cell
      },
      'corner-up-right'
    )
  } else {
    grid.createDiv()
  }

  renderPropRow(
    grid,
    `Status`,
    () => {
      const cell = createDiv('pm-prop-value')
      renderSelectControl({
        container: cell,
        value: task.status,
        options: statuses.map((s) => ({ id: s.id, label: s.label, color: s.color, icon: s.icon || undefined })),
        onChange: (id) => {
          task.status = id
          rerender()
        }
      })
      return cell
    },
    'circle-dot'
  )

  renderPropRow(
    grid,
    `Priority`,
    () => {
      const cell = createDiv('pm-prop-value')
      renderSelectControl({
        container: cell,
        value: task.priority,
        options: priorities.map((p) => ({
          id: p.id,
          label: p.label,
          color: p.color,
          icon: priorityIcon(priorities, p.id, priorityIcons)
        })),
        onChange: (id) => {
          task.priority = id
          rerender()
        }
      })
      return cell
    },
    'flag'
  )

  renderPropRow(
    grid,
    task.type === 'milestone' ? `Date` : `Due`,
    () => {
      const cell = createDiv('pm-prop-value')
      renderDateControl({
        container: cell,
        value: task.due,
        emptyLabel: `Set due date`,
        hint: isTerminalStatus(task.status, statuses) ? null : relativeDue(task.due),
        onChange: (v) => {
          task.due = v
          rerender()
        }
      })
      return cell
    },
    'calendar-clock'
  )

  // Start shares the dates row with Due. Milestones have no start, so an empty cell holds
  // the slot before the next row.
  if (task.type !== 'milestone') {
    renderPropRow(
      grid,
      `Start`,
      () => {
        const cell = createDiv('pm-prop-value')
        renderDateControl({
          container: cell,
          value: task.start,
          emptyLabel: `Set start`,
          onChange: (v) => {
            task.start = v
            rerender()
          }
        })
        return cell
      },
      'play'
    )
  } else {
    grid.createDiv()
  }

  if (task.completed || isTerminalStatus(task.status, statuses)) {
    renderPropRow(
      grid,
      `Completed`,
      () => {
        const cell = createDiv('pm-prop-value')
        renderDateControl({
          container: cell,
          value: task.completed,
          emptyLabel: `Set date`,
          hint: completionOutcome(task.due, task.completed),
          onChange: (v) => {
            task.completed = v
            rerender()
          }
        })
        return cell
      },
      'circle-check-big'
    )
  }

  if (task.type !== 'milestone') {
    renderPropRow(
      grid,
      `Progress`,
      () => {
        const cell = createDiv('pm-prop-value')
        renderInputControl({
          container: cell,
          value: String(task.progress),
          inputType: 'number',
          suffix: '%',
          number: { min: 0, max: 100 },
          onChange: (v) => {
            task.progress = Number(v)
            rerender()
          }
        })
        return cell
      },
      'percent'
    )
  }

  const tagsRow = renderPropRow(
    grid,
    `Tags`,
    () => {
      const cell = createDiv('pm-prop-value')
      const projectTags = collectAllTags(project.tasks)
      renderMultiSelect({
        container: cell,
        search: true,
        addLabel: `Add tags`,
        placeholder: `Find or create…`,
        tag: true,
        colorFor: plugin.settings.showTagColors ? (tag) => stringToColor(tag) : undefined,
        selected: () => task.tags,
        options: () => projectTags.map((tag) => ({ id: tag, label: tag })),
        add: (id) => {
          if (!task.tags.includes(id)) task.tags.push(id)
        },
        remove: (id) => {
          task.tags = task.tags.filter((tag) => tag !== id)
        },
        create: (label) => {
          if (!task.tags.includes(label)) task.tags.push(label)
        }
      })
      return cell
    },
    'tag'
  )
  tagsRow.addClass('pm-prop-row--wide')

  if (task.dependencies.length > 0 || shownExtras.has('depends')) {
    const ownTasks = flattenTasks(project.tasks)
      .map((f) => f.task)
      .filter((other) => other.id !== task.id)
    const ownIds = new Set(ownTasks.map((other) => other.id))
    // Tasks in other projects can be depended on too, so the picker offers the whole
    // vault, this project first and everything else labelled with its project.
    const foreign = plugin.index
      .allTaskRefs()
      .filter((ref) => ref.id !== task.id && !ownIds.has(ref.id))
      .map((ref) => ({
        id: ref.id,
        label: ref.projectPath
          ? `${ref.title}  ·  ${plugin.index.projectRef(ref.projectPath)?.title ?? ''}`.trimEnd()
          : ref.title
      }))
    const allTasks: { id: string; label: string }[] = [
      ...ownTasks.map((other) => ({ id: other.id, label: other.title })),
      ...foreign
    ]
    const titleOf = (id: string) => allTasks.find((entry) => entry.id === id)?.label ?? id
    const depRow = renderPropRow(
      grid,
      `Depends on`,
      () => {
        const cell = createDiv('pm-prop-value')
        renderMultiSelect({
          container: cell,
          search: true,
          addLabel: `Add dependency`,
          addLabelMore: `Add another`,
          placeholder: `Search tasks…`,
          depsList: true,
          labelFor: titleOf,
          linkFor: (id) => {
            const path = plugin.index.task(id)?.path
            return path ? { path, open: () => ctx.openTask(path) } : null
          },
          selected: () => task.dependencies.filter((id) => allTasks.some((entry) => entry.id === id)),
          options: () => {
            // Built once per open, not once per candidate. A predecessor chain can leave
            // this project and come back, so every candidate is checked against the vault.
            const edges = plugin.index.dependentsMap()
            return allTasks.filter(
              (entry) => task.dependencies.includes(entry.id) || !reaches(edges, task.id, entry.id)
            )
          },
          add: (id) => {
            if (!task.dependencies.includes(id)) task.dependencies.push(id)
          },
          remove: (id) => {
            task.dependencies = task.dependencies.filter((d) => d !== id)
          }
        })
        return cell
      },
      'link-2'
    )
    depRow.addClass('pm-prop-row--wide')
  }

  // The other side of a dependency, which is otherwise only visible from the task that
  // declared it, and invisible altogether when that task is in another project.
  const blocks = plugin.index.dependents(task.id)
  if (blocks.length) {
    const blocksRow = renderPropRow(
      grid,
      `Blocks`,
      () => {
        const cell = createDiv('pm-prop-value')
        const list = cell.createDiv('pm-prop-deps')
        for (const ref of blocks) {
          const owner = ref.projectPath ? plugin.index.projectRef(ref.projectPath) : null
          renderDepRow(list, {
            id: ref.id,
            title: ref.title,
            tooltip: owner ? `In ${owner.title}` : undefined,
            link: { path: ref.path, open: () => ctx.openTask(ref.path) }
          })
        }
        return cell
      },
      'link-2'
    )
    blocksRow.addClass('pm-prop-row--wide')
  }

  const hidden: HiddenProperty[] = []
  if (task.dependencies.length === 0 && !shownExtras.has('depends')) {
    hidden.push({ id: 'depends', label: `Depends on`, icon: 'link-2' })
  }
  if (hidden.length > 0) {
    const addCell = grid.createDiv('pm-prop-add-cell')
    renderAddProperty(addCell, hidden, (id) => {
      shownExtras.add(id)
      rerender()
    })
  }
}
