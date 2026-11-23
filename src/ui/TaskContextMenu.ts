import { Menu } from 'obsidian'
import type PMPlugin from '#main'
import { type Task, type Project } from '@dotpm/core'
import { safeAsync } from '@dotpm/ui'
import { openTaskModal, confirmDialog } from './ModalFactory'

export interface TaskMenuContext {
  plugin: PMPlugin
  project: Project
  onRefresh: () => Promise<void>
}

export function buildTaskContextMenu(menu: Menu, task: Task, ctx: TaskMenuContext): Menu {
  menu.addItem((item) =>
    item
      .setTitle(`Edit task`)
      .setIcon('pencil')
      .onClick(() => {
        openTaskModal(ctx.plugin, ctx.project, {
          task,
          onSave: async () => {
            await ctx.onRefresh()
          }
        })
      })
  )
  menu.addItem((item) =>
    item
      .setTitle(`Add subtask`)
      .setIcon('plus')
      .onClick(() => {
        openTaskModal(ctx.plugin, ctx.project, {
          parentId: task.id,
          onSave: async () => {
            await ctx.onRefresh()
          }
        })
      })
  )
  menu.addSeparator()
  if (task.archived) {
    menu.addItem((item) =>
      item
        .setTitle(`Unarchive`)
        .setIcon('archive-restore')
        .onClick(
          safeAsync(async () => {
            await ctx.plugin.store.unarchiveTask(ctx.project, task.id)
            await ctx.onRefresh()
          })
        )
    )
  } else {
    menu.addItem((item) =>
      item
        .setTitle(`Archive`)
        .setIcon('archive')
        .onClick(
          safeAsync(async () => {
            await ctx.plugin.store.archiveTask(ctx.project, task.id)
            await ctx.onRefresh()
          })
        )
    )
  }
  menu.addItem((item) =>
    item
      .setTitle(`Delete task`)
      .setIcon('trash')
      .onClick(
        safeAsync(async () => {
          if (await confirmDialog(ctx.plugin.app, `Delete "${task.title}"?`)) {
            await ctx.plugin.store.deleteTask(ctx.project, task.id)
            await ctx.onRefresh()
          }
        })
      )
  )
  return menu
}
