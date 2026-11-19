import { setIcon } from '#platform'
import { Popover } from '#primitives/Popover'
import { Chip } from '#primitives/Chip'
import { renderDepRow, type DepLink } from './depRow'
import { renderOptionRow } from './optionList'

export interface PickerItem {
  id: string
  label: string
  color?: string
  icon?: string
}

export interface MultiSelectOpts {
  container: HTMLElement
  selected: () => string[]
  options: () => PickerItem[]
  add: (id: string) => void
  remove: (id: string) => void
  addLabel: string
  /** Add-ghost label once at least one value is present (e.g. "Add another"). */
  addLabelMore?: string
  labelFor?: (id: string) => string
  colorFor?: (id: string) => string | undefined
  search?: boolean
  placeholder?: string
  create?: (label: string) => void
  /** Row label for the create option; defaults to `Create "<name>"`. */
  createLabel?: (name: string) => string
  tag?: boolean
  /** A vertical list of id + title-link rows. Backs Depends on. */
  depsList?: boolean
  /** The note a deps-list value stands for, turning its title into a link that opens it. */
  linkFor?: (id: string) => DepLink | null
}

/**
 * Backs Tags and Depends on. The picker popover stays open across toggles so
 * several values can be added at once.
 */
export function renderMultiSelect(opts: MultiSelectOpts): void {
  const labelOf = (id: string) => (opts.labelFor ? opts.labelFor(id) : id)
  const listMode = !!opts.depsList

  const chipsEl = listMode ? null : opts.container.createDiv('pm-prop-chips')
  const depsEl = listMode ? opts.container.createDiv('pm-prop-deps') : null
  const anchorBtn = opts.container.createEl('button', { cls: 'pm-prop-add' })
  setIcon(anchorBtn.createSpan({ cls: 'pm-glyph-icon' }), 'plus')
  const addLabelEl = anchorBtn.createSpan({ cls: 'pm-prop-add-label', text: opts.addLabel })

  const renderChips = () => {
    if (!chipsEl) return
    chipsEl.empty()
    for (const id of opts.selected()) {
      const chip = new Chip(chipsEl)
        .setLabel(labelOf(id))
        .setVariant('outline')
        .setRemovable(() => {
          opts.remove(id)
          renderValues()
        })
      if (opts.tag) chip.setTag()
      else chip.setShape('pill')
      const color = opts.colorFor?.(id)
      if (color) chip.setDot(true).setColor(color)
    }
  }

  const renderDepsList = () => {
    if (!depsEl) return
    depsEl.empty()
    for (const id of opts.selected()) {
      renderDepRow(depsEl, {
        id,
        title: labelOf(id),
        link: opts.linkFor?.(id),
        onRemove: () => {
          opts.remove(id)
          renderValues()
        }
      })
    }
  }

  const renderValues = () => {
    if (listMode) renderDepsList()
    else renderChips()
    if (addLabelEl) {
      addLabelEl.setText(opts.selected().length && opts.addLabelMore ? opts.addLabelMore : opts.addLabel)
    }
  }
  renderValues()

  let pop: Popover | null = null
  anchorBtn.addEventListener('click', () => {
    if (pop?.isOpen) {
      pop.close()
      return
    }
    const popover = new Popover({ anchor: anchorBtn, width: 230, onClose: () => (pop = null) })
    pop = popover
    let query = ''
    const searchInput = opts.search
      ? popover.contentEl.createEl('input', {
          cls: 'pm-pop-field',
          attr: { placeholder: opts.placeholder ?? 'Search…', spellcheck: 'false' }
        })
      : null
    const listEl = popover.contentEl.createDiv('pm-pop-list')

    const renderList = () => {
      listEl.empty()
      const q = query.trim().toLowerCase()
      const picked = new Map(opts.selected().map((value) => [value, value]))
      const items = opts.options().filter((it) => !q || it.label.toLowerCase().includes(q))
      const toggle = (id: string) => {
        const current = picked.get(id)
        if (current !== undefined) opts.remove(current)
        else opts.add(id)
        renderValues()
        renderList()
      }
      for (const it of items) {
        renderOptionRow(listEl, {
          label: it.label,
          color: it.color ?? opts.colorFor?.(it.id),
          icon: it.icon,
          selected: picked.has(it.id),
          onPick: () => toggle(it.id)
        })
      }
      const create = opts.create
      const matched = items.some((it) => it.label.toLowerCase() === q)
      if (create && q && !matched) {
        const label = query.trim()
        renderOptionRow(listEl, {
          label: opts.createLabel ? opts.createLabel(label) : `Create "${label}"`,
          icon: 'plus',
          accent: true,
          onPick: () => {
            create(label)
            query = ''
            if (searchInput) searchInput.value = ''
            renderValues()
            renderList()
          }
        })
      }
    }

    if (searchInput) {
      searchInput.addEventListener('input', () => {
        query = searchInput.value
        renderList()
      })
    }

    renderList()
    popover.open()
    searchInput?.focus()
  })
}
