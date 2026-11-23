import { App, PluginSettingTab, Setting, debounce } from 'obsidian'
import type { SettingDefinitionItem, SettingDefinitionPage } from 'obsidian'
import type PMPlugin from './main'
import { type PMSettings, DEFAULT_SETTINGS } from '@dotpm/core'

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
            desc: `Choose where the task editor opens: in a modal or in a tab.`,
            control: {
              type: 'dropdown',
              key: 'taskEditorSurface',
              options: { modal: `Modal`, tab: `Tab` }
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
          }
        ]
      }
    ]
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    await super.setControlValue(key, value)
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
