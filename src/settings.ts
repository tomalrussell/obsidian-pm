import { App, Notice, PluginSettingTab, Setting, debounce } from 'obsidian'
import type { SettingDefinitionItem, SettingDefinitionPage } from 'obsidian'
import type PMPlugin from './main'
import {
  type PMSettings,
  DEFAULT_PALETTE_COLOR,
  DEFAULT_SETTINGS,
  priorityIconSetLabels,
  makeId,
  flattenTasks,
  setDateFormat
} from '@dotpm/core'
import { saveShortcutLabel } from './utils'
import { renderCustomFieldFields, renderCustomFieldOptions } from '@dotpm/ui'
import { renderPaletteFields } from './ui/PaletteListEditor'

export type { PMSettings }
export { DEFAULT_SETTINGS }

export class PMSettingTab extends PluginSettingTab {
  plugin: PMPlugin
  /** A folder name is typed one character at a time; each sweep costs the whole vault. */
  private readonly rebuildIndex: () => void

  constructor(app: App, plugin: PMPlugin) {
    super(app, plugin)
    this.plugin = plugin
    this.icon = 'chart-gantt'
    this.rebuildIndex = debounce(() => this.plugin.index.build(), 500)
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        type: 'group',
        heading: `General`,
        items: [
          {
            name: `New project folder`,
            desc: `Create new projects in this folder. Leave it empty to use the vault root.`,
            aliases: ['projects folder', 'location'],
            control: {
              type: 'folder',
              key: 'projectsFolder',
              defaultValue: 'Projects',
              placeholder: `Vault root`
            }
          },
          this.excludedFoldersPage(),
          {
            name: `Open projects in`,
            desc: `Choose where a project opens. Select "Tasks" to skip the overview page and open the table, timeline, or board.`,
            aliases: ['click', 'project list', 'overview'],
            control: {
              type: 'dropdown',
              key: 'projectSurface',
              options: { overview: `Overview`, tasks: `Tasks` }
            }
          },
          {
            name: `Default tasks view`,
            desc: `Choose the view a project's tasks open in.`,
            aliases: ['default view'],
            control: {
              type: 'dropdown',
              key: 'defaultView',
              options: { table: `Table`, gantt: `Timeline`, kanban: `Board` }
            }
          },
          {
            name: `Open tasks in`,
            desc: `Choose where tasks open. Select "Tab" to also open task notes in the task editor instead of Obsidian's editor.`,
            control: {
              type: 'dropdown',
              key: 'taskEditorSurface',
              options: { modal: `Modal`, tab: `Tab` }
            }
          },
          {
            name: `Save tasks on close`,
            desc: `Save changes when the task editor is closed.`,
            control: { type: 'toggle', key: 'saveTaskOnClose' }
          },
          {
            name: `Save shortcut`,
            desc: `Choose the shortcut that creates or saves tasks and projects.`,
            aliases: ['hotkey', 'keyboard'],
            control: {
              type: 'dropdown',
              key: 'editorSaveModifier',
              options: { Shift: saveShortcutLabel('Shift'), Mod: saveShortcutLabel('Mod') }
            }
          },
          {
            name: `Show release notes after updates`,
            desc: `Open a tab with the release notes after the plugin updates.`,
            aliases: ['changelog', "what's new", 'update'],
            control: { type: 'toggle', key: 'showReleaseNotes' }
          }
        ]
      },
      {
        type: 'group',
        heading: `Style`,
        items: [
          {
            name: `Show tag colors`,
            desc: `Give each tag a colored dot derived from its name.`,
            aliases: ['appearance'],
            control: { type: 'toggle', key: 'showTagColors' }
          },
          {
            name: `Date format`,
            desc: `Set how dates are written, using tokens such as YYYY, MM, DD, MMM and ddd. Leave it empty for the default format.`,
            aliases: ['appearance', 'date', 'moment'],
            control: { type: 'text', key: 'dateFormat', placeholder: 'YYYY-MM-DD' }
          },
          {
            name: `Priority icons`,
            desc: `Choose the icons for priorities that have no icon of their own.`,
            aliases: ['appearance', 'chevrons', 'signal'],
            control: {
              type: 'dropdown',
              key: 'priorityIcons',
              options: priorityIconSetLabels()
            }
          }
        ]
      },
      {
        type: 'group',
        heading: `Table`,
        items: [
          {
            name: `Show subtree connections`,
            desc: `Draw lines tying a subtask row back to its parent.`,
            aliases: ['tree', 'indent', 'subtask'],
            control: { type: 'toggle', key: 'showSubtreeConnections' }
          },
          {
            name: `Line borders`,
            desc: `Draw rules between rows, between columns, or both.`,
            aliases: ['grid', 'lines'],
            control: {
              type: 'dropdown',
              key: 'lineBorders',
              options: {
                none: `None`,
                horizontal: `Horizontal`,
                vertical: `Vertical`,
                both: `Both`
              }
            }
          }
        ]
      },
      {
        type: 'group',
        heading: `Timeline`,
        items: [
          {
            name: `Default granularity`,
            desc: `Choose the time unit for each column in the timeline.`,
            aliases: ['timeline', 'zoom'],
            control: {
              type: 'dropdown',
              key: 'ganttGranularity',
              options: {
                day: `Day`,
                week: `Week`,
                month: `Month`,
                quarter: `Quarter`,
                year: `Year`
              }
            }
          },
          {
            name: `Week label`,
            desc: `Choose the text shown in weekly header cells.`,
            aliases: ['timeline'],
            control: {
              type: 'dropdown',
              key: 'ganttWeekLabel',
              options: {
                weekNumber: `Week number (w15)`,
                dateRange: `Date range (Apr 7 – 13)`,
                both: `Both (w15: Apr 7 – 13)`
              }
            }
          }
        ]
      },
      {
        type: 'group',
        heading: `Scheduling`,
        items: [
          {
            name: `Auto-schedule`,
            desc: `Adjust dependent task dates when a task changes.`,
            aliases: ['dependencies'],
            control: { type: 'toggle', key: 'autoSchedule' }
          },
          {
            name: `Pull dependents forward`,
            desc: `Move dependent tasks earlier when a task is completed before its due date.`,
            aliases: ['dependencies'],
            control: {
              type: 'toggle',
              key: 'pullForwardOnEarlyFinish',
              disabled: () => !this.plugin.settings.autoSchedule
            }
          }
        ]
      },
      {
        type: 'group',
        heading: `Archive`,
        items: [
          {
            name: `Auto-archive completed tasks`,
            desc: `Move completed tasks to the project's archive after this many days. Set it to 0 to keep them in place.`,
            aliases: ['archive', 'cleanup', 'done'],
            control: {
              type: 'slider',
              key: 'autoArchiveDays',
              min: 0,
              max: 90,
              step: 1
            }
          }
        ]
      },
      {
        type: 'group',
        heading: `Notifications`,
        items: [
          {
            name: `Due date reminders`,
            desc: `Show a banner when a task is approaching its due date.`,
            aliases: ['notifications', 'banner'],
            control: { type: 'toggle', key: 'notificationsEnabled' }
          },
          {
            name: `Days in advance`,
            desc: `Notify this many days before a task is due.`,
            aliases: ['notifications', 'reminders', 'lead time'],
            control: {
              type: 'slider',
              key: 'notificationLeadDays',
              min: 1,
              max: 14,
              step: 1,
              disabled: () => !this.plugin.settings.notificationsEnabled
            }
          }
        ]
      },
      {
        type: 'group',
        heading: `Task fields`,
        items: [this.prioritiesPage(), this.customFieldsPage()]
      }
    ]
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    await super.setControlValue(key, value)
    // Today's pass ran against the old window, so it has to run again to reflect the new one.
    if (key === 'autoArchiveDays') {
      this.plugin.settings.lastAutoArchiveDate = ''
      await this.plugin.autoArchiver.check()
    }
    if (key === 'dateFormat') setDateFormat(this.plugin.settings.dateFormat)
    this.plugin.refreshViews()
    this.refreshDomState()
  }

  private customFieldsPage(): SettingDefinitionPage {
    const fields = this.plugin.settings.customFields
    return {
      type: 'page',
      name: `Custom fields`,
      desc: `Manage the extra task properties available across all projects.`,
      displayValue: () =>
        this.plugin.settings.customFields.length === 1
          ? `${this.plugin.settings.customFields.length} field`
          : `${this.plugin.settings.customFields.length} fields`,
      items: [
        {
          type: 'list',
          heading: `Custom fields`,
          emptyState: `No custom fields.`,
          items: fields.map((field) => ({
            name: field.name,
            render: (setting: Setting) => {
              setting.setClass('pm-palette-row')
              setting.setClass('pm-cf-settings-row')
              renderCustomFieldFields(
                setting.controlEl,
                field,
                () => this.persist(),
                () => this.update()
              )
              renderCustomFieldOptions(setting.controlEl, field, () => this.persist())
            }
          })),
          onReorder: (from, to) => this.reorder(fields, from, to),
          onDelete: (index) => {
            fields.splice(index, 1)
            this.persist()
            this.update()
          },
          addItem: {
            name: `Add custom field`,
            action: () => {
              fields.push({ id: makeId(), name: `New field`, type: 'text' })
              this.persist()
              this.update()
            }
          }
        }
      ]
    }
  }

  private prioritiesPage(): SettingDefinitionPage {
    const priorities = this.plugin.settings.priorities
    return {
      type: 'page',
      name: `Priorities`,
      desc: `Manage the labels, colors, and icons of task priorities.`,
      displayValue: () =>
        this.plugin.settings.priorities.length === 1
          ? `${this.plugin.settings.priorities.length} priority`
          : `${this.plugin.settings.priorities.length} priorities`,
      items: [
        {
          type: 'list',
          heading: `Priorities`,
          emptyState: `No priorities.`,
          items: priorities.map((priority) => ({
            name: priority.label,
            render: (setting: Setting) => {
              setting.setClass('pm-palette-row')
              renderPaletteFields(setting.controlEl, priority, () => this.persist())
            }
          })),
          onReorder: (from, to) => this.reorder(priorities, from, to),
          onDelete: (index) => this.deleteEntry('priority', index),
          addItem: {
            name: `Add priority`,
            action: () => {
              priorities.push({
                id: 'priority-' + makeId().slice(0, 6),
                label: `New priority`,
                color: DEFAULT_PALETTE_COLOR,
                icon: ''
              })
              this.persist()
              this.update()
            }
          }
        }
      ]
    }
  }

  private excludedFoldersPage(): SettingDefinitionPage {
    const folders = this.plugin.settings.excludedFolders
    return {
      type: 'page',
      name: `Excluded folders`,
      desc: `Manage the folders to skip when looking for projects and tasks, such as templates.`,
      displayValue: () =>
        this.plugin.settings.excludedFolders.length === 1
          ? `${this.plugin.settings.excludedFolders.length} folder`
          : `${this.plugin.settings.excludedFolders.length} folders`,
      items: [
        {
          type: 'list',
          heading: `Excluded folders`,
          emptyState: `No folders excluded.`,
          items: folders.map((folder, index) => ({
            name: folder || `Unnamed folder`,
            render: (setting: Setting) => {
              setting.setClass('pm-palette-row')
              setting.addText((text) =>
                text
                  .setPlaceholder(`Templates`)
                  .setValue(folder)
                  .onChange((value) => {
                    this.plugin.settings.excludedFolders[index] = value
                    this.persist()
                    this.rebuildIndex()
                  })
              )
            }
          })),
          onDelete: (index) => {
            folders.splice(index, 1)
            this.persist()
            this.plugin.index.build()
            this.update()
          },
          addItem: {
            name: `Add folder`,
            action: () => {
              folders.push('')
              this.persist()
              this.update()
            }
          }
        }
      ]
    }
  }

  private persist(): void {
    void this.plugin.saveSettings()
    this.plugin.refreshViews()
  }

  private reorder<T>(items: T[], from: number, to: number): void {
    const [moved] = items.splice(from, 1)
    items.splice(to, 0, moved)
    this.persist()
    this.update()
  }

  private deleteEntry(field: 'priority', index: number): void {
    const entries = this.plugin.settings.priorities
    if (entries.length <= 1) {
      new Notice(`You must have at least one priority.`)
      return
    }
    const [removed] = entries.splice(index, 1)
    this.persist()
    this.update()
    void this.remapOrphanTasks(field, removed.id, removed.label)
  }

  private async remapOrphanTasks(field: 'priority', deletedId: string, deletedLabel: string): Promise<void> {
    const configs = this.plugin.settings.priorities
    if (configs.length === 0) return
    const fallback = configs[0]
    // Only projects the index says still use the deleted value are worth loading.
    const affected = this.plugin.index
      .projectRefs(true)
      .filter((ref) => this.plugin.index.taskRefs(ref.path).some((task) => task[field] === deletedId))
      .map((ref) => ref.path)
    const projects = await this.plugin.store.loadProjects(affected)
    let remapped = 0
    for (const project of projects) {
      // A project defining this status or priority itself is unaffected by a global delete.
      const own = project.config?.priorities
      if (own?.some((entry) => entry.id === deletedId)) continue
      const ids = flattenTasks(project.tasks)
        .filter(({ task }) => task[field] === deletedId)
        .map(({ task }) => task.id)
      if (ids.length) {
        await this.plugin.store.updateTasks(project, ids, { [field]: fallback.id })
        remapped += ids.length
      }
    }
    if (remapped > 0) {
      new Notice(
        remapped === 1
          ? `Remapped ${remapped} task from '${deletedLabel}' to '${fallback.label}'.`
          : `Remapped ${remapped} tasks from '${deletedLabel}' to '${fallback.label}'.`
      )
    }
  }
}
