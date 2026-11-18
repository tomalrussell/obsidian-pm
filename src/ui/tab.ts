import type { Menu, WorkspaceLeaf } from 'obsidian'
import type PMPlugin from '#main'

import { safeAsync } from '@dotpm/ui'

/** A page of one note that a tab's "More options" menu can open in the same tab. */
export type TabPage = 'overview' | 'tasks' | 'edit' | 'note'

/** Adds the pages to the menu in the order given, each opening `path` in `leaf`. */
export function addTabPageItems(
  menu: Menu,
  plugin: PMPlugin,
  leaf: WorkspaceLeaf,
  path: string,
  pages: TabPage[]
): void {
  const items: Record<TabPage, { title: string; icon: string; open: () => Promise<void> }> = {
    overview: {
      title: `Open overview`,
      icon: 'gauge',
      open: () => plugin.router.openProjectOverview(path, leaf)
    },
    tasks: {
      title: `Open tasks`,
      icon: 'table',
      open: () => plugin.router.openScope({ kind: 'project', path }, leaf)
    },
    edit: { title: `Edit project`, icon: 'settings', open: () => plugin.router.openProjectEdit(path, leaf) },
    note: { title: `Open as note`, icon: 'file-text', open: () => plugin.openAsMarkdown(path, leaf) }
  }
  for (const page of pages) {
    const { title, icon, open } = items[page]
    menu.addItem((item) => item.setSection('open').setTitle(title).setIcon(icon).onClick(safeAsync(open)))
  }
}

/** Redraws the tab's title from the view's display text. The method isn't in Obsidian's typings. */
export function refreshTabTitle(leaf: WorkspaceLeaf): void {
  ;(leaf as WorkspaceLeaf & { updateHeader?: () => void }).updateHeader?.()
}
