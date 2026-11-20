import { App, PluginSettingTab, Setting, debounce } from 'obsidian'
import type { SettingDefinitionItem, SettingDefinitionPage } from 'obsidian'
import type PMPlugin from './main'
import { type PMSettings, DEFAULT_SETTINGS, setDateFormat } from '@dotpm/core'
import { saveShortcutLabel } from './utils'

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
}
