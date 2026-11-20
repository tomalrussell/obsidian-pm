import { createButton } from '#platform'
import { Checkbox } from '#primitives/Checkbox'
import { ChipButton } from '#primitives/ChipButton'
import { Popover } from '#primitives/Popover'

import { renderPopSearch } from '../popoverParts'
import { renderOptionRow } from '../properties/optionList'

export interface SwitcherProject {
  path: string
  title: string
  icon?: string
  color?: string
  /** The folder heading the project is listed under, '' for the vault root. */
  folder: string
  taskCount: number
}

/** One of the fixed scopes above the list, named after what it covers. */
export interface SwitcherPreset {
  label: string
  active: boolean
  onPick: () => void
}

export interface ProjectSwitcherProps {
  /** Every project. */
  projects: SwitcherProject[]
  /** The paths in view, checked when it opens. */
  selected: string[]
  /** The project the view shows alone, marked as current. */
  current?: string
  presets: SwitcherPreset[]
  /** A name was clicked: that project alone. */
  onPick: (path: string) => void
  /** The checked paths, the ones already in view first. */
  onShow: (paths: string[]) => void
}

/**
 * Which projects the view shows. Clicking a name goes to that project alone; a checkbox,
 * Space or a modifier-click adds it to the selection, which "Show N projects", Mod+Enter or
 * closing the panel applies. Returns what closing should do: apply the selection
 * when it changed and holds anything, unless something else already ended the panel.
 */
export function renderProjectSwitcherPanel(
  parent: HTMLElement,
  props: ProjectSwitcherProps,
  close: () => void
): () => void {
  const byPath = new Map(props.projects.map((project) => [project.path, project]))
  const selected = new Set(props.selected.filter((path) => byPath.has(path)))
  const before = [...selected]
  let ended = false
  const end = (): void => {
    ended = true
    close()
  }
  const show = (): void => {
    if (!selected.size) return
    ended = true
    props.onShow(ordered())
    close()
  }
  const ordered = (): string[] => [
    ...before.filter((path) => selected.has(path)),
    ...[...selected].filter((path) => !before.includes(path))
  ]

  const root = parent.createDiv('pm-switcher')
  const search = renderPopSearch(root, 'Find project or folder...', () => renderList())
  const presets = root.createDiv('pm-switcher-presets')
  for (const preset of props.presets) {
    new ChipButton(presets)
      .setVariant('outline')
      .setLabel(preset.label)
      .setActive(preset.active)
      .onClick(() => {
        preset.onPick()
        end()
      })
  }
  const list = root.createDiv('pm-pop-list pm-switcher-list')
  const foot = root.createDiv('pm-switcher-foot pm-pop-section')
  const summary = foot.createSpan('pm-switcher-summary')
  const clear = new ChipButton(foot)
    .setVariant('flat')
    .setLabel('Clear')
    .onClick(() => {
      selected.clear()
      sync()
    })
  const showButton = createButton(foot).setCta().onClick(show)

  const boxes: { path: string; box: Checkbox }[] = []
  const sync = (): void => {
    for (const { path, box } of boxes) {
      box.setChecked(selected.has(path))
    }
    const tasks = [...selected].reduce((sum, path) => sum + (byPath.get(path)?.taskCount ?? 0), 0)
    summary.setText(
      selected.size === 1
        ? `${selected.size} selected · ${tasks === 1 ? `${tasks} task` : `${tasks} tasks`}`
        : `${selected.size} selected · ${tasks === 1 ? `${tasks} task` : `${tasks} tasks`}`
    )
    clear.setDisabled(!selected.size)
    showButton
      .setButtonText(selected.size === 1 ? `Show ${selected.size} project` : `Show ${selected.size} projects`)
      .setDisabled(!selected.size)
  }
  const toggle = (path: string): void => {
    if (selected.has(path)) selected.delete(path)
    else selected.add(path)
    sync()
  }

  const renderRow = (project: SwitcherProject): void => {
    const line = list.createDiv({ cls: 'pm-switcher-line', attr: { 'data-path': project.path } })
    const box = new Checkbox(line)
      .setAriaLabel(`Show ${project.title} in this view`)
      .onChange(() => toggle(project.path))
    boxes.push({ path: project.path, box })
    const row = renderOptionRow(line, {
      label: project.title,
      icon: project.icon,
      color: project.color,
      note: String(project.taskCount),
      selected: project.path === props.current,
      onPick: (e) => {
        if (e.ctrlKey || e.metaKey) {
          toggle(project.path)
          return
        }
        if (project.path !== props.current) props.onPick(project.path)
        end()
      }
    })
    row.addClass('pm-switcher-row')
  }

  const renderList = (): void => {
    list.empty()
    boxes.length = 0
    const query = search.value.trim().toLowerCase()
    const shown = query
      ? props.projects.filter(
          (project) => project.title.toLowerCase().includes(query) || project.folder.toLowerCase().includes(query)
        )
      : props.projects
    const folders = new Map<string, SwitcherProject[]>()
    for (const project of shown) {
      const group = folders.get(project.folder)
      if (group) group.push(project)
      else folders.set(project.folder, [project])
    }
    for (const [folder, projects] of folders) {
      list.createDiv({ cls: 'pm-pop-heading', text: folder || 'Vault' })
      for (const project of projects) renderRow(project)
    }
    if (!shown.length) list.createDiv({ cls: 'pm-pop-empty', text: 'No matching projects' })
    sync()
  }

  const rows = (): HTMLButtonElement[] => list.findAll('button.pm-switcher-row') as HTMLButtonElement[]
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      show()
      return
    }
    const all = rows()
    const at = all.indexOf(e.target as HTMLButtonElement)
    if (e.target === search && e.key === 'ArrowDown') {
      e.preventDefault()
      all[0]?.focus()
      return
    }
    if (at === -1) return
    const path = all[at].closest<HTMLElement>('.pm-switcher-line')?.dataset.path
    if (!path) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const next = at + (e.key === 'ArrowDown' ? 1 : -1)
      if (next < 0) search.focus()
      else all[Math.min(next, all.length - 1)].focus()
    } else if (e.key === ' ') {
      e.preventDefault()
      toggle(path)
    }
  })

  renderList()
  return () => {
    if (ended || !selected.size) return
    if (selected.size === before.length && before.every((path) => selected.has(path))) return
    props.onShow(ordered())
  }
}

/** The switcher in a popover under `anchor`, with its search field focused. Escape discards the selection. */
export function openProjectSwitcher(anchor: HTMLElement, props: ProjectSwitcherProps): Popover {
  let applyOnClose = (): void => {}
  const onClose = (escaped: boolean): void => {
    if (!escaped) applyOnClose()
  }
  const pop = Popover.show({ anchor, width: 320, onClose }, (el, close) => {
    applyOnClose = renderProjectSwitcherPanel(el, props, close)
  })
  pop.contentEl.find('input.pm-pop-field')?.focus()
  return pop
}
