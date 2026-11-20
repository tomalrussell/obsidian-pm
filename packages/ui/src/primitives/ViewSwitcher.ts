import { setIcon, setTooltip } from '#platform'

export interface ViewSwitcherOption<T extends string> {
  id: T
  icon: string
  label: string
}

export interface ViewSwitcherProps<T extends string> {
  options: ViewSwitcherOption<T>[]
  active: T
  onChange: (id: T) => void
}

export class ViewSwitcher<T extends string> {
  el: HTMLElement

  constructor(parentEl: HTMLElement, props: ViewSwitcherProps<T>) {
    this.el = parentEl.createDiv({ cls: 'pm-view-switcher', attr: { role: 'group', 'aria-label': 'View mode' } })
    for (const opt of props.options) {
      const btn = this.el.createEl('button', {
        cls: 'pm-view-btn',
        attr: { type: 'button', 'aria-label': opt.label, 'aria-pressed': String(opt.id === props.active) }
      })
      setIcon(btn.createSpan('pm-view-btn-icon'), opt.icon)
      btn.createSpan({ cls: 'pm-view-btn-label', text: opt.label })
      setTooltip(btn, opt.label)
      btn.toggleClass('pm-view-btn--active', opt.id === props.active)
      btn.addEventListener('click', () => {
        this.el.querySelectorAll('.pm-view-btn').forEach((button) => {
          const active = button === btn
          button.toggleClass('pm-view-btn--active', active)
          button.setAttribute('aria-pressed', String(active))
        })
        props.onChange(opt.id)
      })
    }
  }
}
