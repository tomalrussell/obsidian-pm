import { TFile } from 'obsidian'
import type PMPlugin from './main'
import { isRefLink } from './store/refs'
import { legacyBoardFields, makeDefaultFilter, makeDefaultSort, parseFrontmatter, isOldFormat } from '@dotpm/core'

/** Rewrites projects whose tasks are embedded in frontmatter as one file per task. */
export async function migrateProjects(plugin: PMPlugin): Promise<void> {
  for (const path of plugin.index.projectPaths(true)) {
    const file = plugin.app.vault.getAbstractFileByPath(path)
    if (!(file instanceof TFile)) continue
    try {
      const content = await plugin.app.vault.read(file)
      const parsed = parseFrontmatter(content)
      if (parsed.kind !== 'frontmatter' || parsed.frontmatter['pm-project'] !== true) continue
      if (!isOldFormat(parsed.frontmatter)) continue

      const project = await plugin.store.loadProject(file)
      if (!project || project.tasks.length === 0) continue

      await plugin.store.saveProject(project)
    } catch (e) {
      console.error(`[PM] Migration failed for ${file.path}:`, e)
    }
  }
}

const LEGACY_BOARD_KEYS = ['kanbanShowSubtasks', 'kanbanShowDescriptionPreview']

/**
 * Moves a project's own "Show subtasks" and "Show description preview" overrides into the
 * board card fields of that project's view, then drops them from the note. A note without
 * them is left alone, which is what makes a second run free.
 */
export async function migrateBoardCardConfig(plugin: PMPlugin): Promise<void> {
  let changed = false
  for (const path of plugin.index.projectPaths(true)) {
    const config = frontmatterOf(plugin, path)?.config as Record<string, unknown> | undefined
    if (!config || !LEGACY_BOARD_KEYS.some((key) => key in config)) continue
    const file = plugin.app.vault.getAbstractFileByPath(path)
    if (!(file instanceof TFile)) continue
    const key = `project:${path}`
    const entry = (plugin.settings.projectFilters[key] ??= {
      filter: makeDefaultFilter(),
      sort: makeDefaultSort(),
      fields: structuredClone(plugin.settings.defaultFields),
      ganttGranularity: plugin.settings.ganttGranularity
    })
    // A key the note leaves out inherited the global setting, which loadSettings has already moved here.
    const had = entry.fields.kanban?.visible ?? []
    const own = (key: string, field: string): boolean =>
      typeof config[key] === 'boolean' ? config[key] === true : had.includes(field)
    const kanban = legacyBoardFields(
      own('kanbanShowSubtasks', 'subtasks'),
      own('kanbanShowDescriptionPreview', 'description')
    ).kanban
    if (kanban) entry.fields.kanban = kanban
    else delete entry.fields.kanban
    try {
      await plugin.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
        const own = frontmatter.config as Record<string, unknown> | undefined
        if (!own) return
        for (const legacy of LEGACY_BOARD_KEYS) Reflect.deleteProperty(own, legacy)
        if (!Object.keys(own).length) Reflect.deleteProperty(frontmatter, 'config')
      })
    } catch (e) {
      console.error(`[PM] Failed to move the board settings out of "${path}":`, e)
    }
    changed = true
  }
  if (changed) await plugin.saveSettings()
}

const REF_KEYS = ['projectId', 'parentId', 'subtaskIds', 'dependencies', 'taskIds']

function holdsBareId(frontmatter: Record<string, unknown> | undefined): boolean {
  if (!frontmatter) return false
  for (const key of REF_KEYS) {
    const value = frontmatter[key]
    const entries = Array.isArray(value) ? value : [value]
    if (entries.some((entry) => typeof entry === 'string' && entry !== '' && !isRefLink(entry))) return true
  }
  return false
}

function frontmatterOf(plugin: PMPlugin, path: string): Record<string, unknown> | undefined {
  const file = plugin.app.vault.getAbstractFileByPath(path)
  return file instanceof TFile ? plugin.app.metadataCache.getFileCache(file)?.frontmatter : undefined
}

/**
 * Points the notes that still name a task or project by id at the note itself. Both forms
 * read the same, so this only makes a vault written across the change consistent. It reads
 * the frontmatter cache rather than the notes, and touches nothing in a vault that holds
 * no ids, which is what makes a second run free.
 */
export async function migrateTaskRefs(plugin: PMPlugin): Promise<void> {
  for (const path of plugin.index.projectPaths(true)) {
    const stale = plugin.index
      .taskRefs(path)
      .filter((ref) => holdsBareId(frontmatterOf(plugin, ref.path)))
      .map((ref) => ref.id)
    const projectNoteStale = holdsBareId(frontmatterOf(plugin, path))
    if (stale.length === 0 && !projectNoteStale) continue

    try {
      const project = await plugin.store.loadProjectByPath(path)
      if (!project) continue
      await plugin.store.normalizeTaskRefs(project, stale, projectNoteStale)
    } catch (e) {
      console.error(`[PM] Failed to update the references in "${path}":`, e)
    }
  }
}
