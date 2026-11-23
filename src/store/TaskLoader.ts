import { type App, TFile, TFolder, normalizePath } from 'obsidian'
import { type Project, type Task, TASK_FRONTMATTER_KEY, hydrateTaskFromFile, parseFrontmatter } from '@dotpm/core'
import { refListToIds, refToId } from './refs'

/** Objects whose in-memory `description` is known to match disk. */
export type Hydrated = WeakSet<Task | Project>

export async function loadTasksFromFolder(
  app: App,
  hydrated: Hydrated,
  folderPath: string,
  topLevelRefs: string[],
  projectPath: string
): Promise<Task[]> {
  const folder = app.vault.getAbstractFileByPath(folderPath)
  if (!(folder instanceof TFolder)) return []

  const taskMap = new Map<string, Task>()
  const subtaskIdsMap = new Map<string, string[]>()
  const parentIdMap = new Map<string, string>()
  const archivePrefix = normalizePath(folderPath + '/Archive') + '/'

  const files: TFile[] = []
  const collect = (f: TFolder): void => {
    for (const child of f.children) {
      if (child instanceof TFile && child.extension === 'md') files.push(child)
      else if (child instanceof TFolder) collect(child)
    }
  }
  collect(folder)

  const results = await Promise.all(files.map((file) => loadTaskFile(app, file, hydrated)))

  // References are wikilinks, so the notes have to be read before any of them can be
  // followed. Anything that is not a link is an id from a vault written before that.
  const idByPath = new Map<string, string>()
  for (let i = 0; i < files.length; i++) {
    const task = results[i].task
    if (task) idByPath.set(files[i].path, task.id)
  }

  for (let i = 0; i < files.length; i++) {
    const { task, subtaskIds, parentId } = results[i]
    if (task) {
      const source = files[i].path
      if (source.startsWith(archivePrefix)) {
        task.archived = true
      }
      task.dependencies = refListToIds(app, task.dependencies, source, idByPath)
      const subIds = refListToIds(app, subtaskIds, source, idByPath)
      const pid = parentId ? refToId(app, parentId, source, idByPath) : null
      taskMap.set(task.id, task)
      if (subIds.length) subtaskIdsMap.set(task.id, subIds)
      if (pid) parentIdMap.set(task.id, pid)
    }
  }

  for (const [taskId, sids] of subtaskIdsMap) {
    const task = taskMap.get(taskId)
    if (!task) continue
    task.subtasks = []
    // A list holding both a link to a task and its bare id resolves to one id twice.
    const seen = new Set<string>()
    for (const sid of sids) {
      if (seen.has(sid)) continue
      const sub = taskMap.get(sid)
      if (!sub) continue
      task.subtasks.push(sub)
      seen.add(sid)
    }
  }

  // Re-parent orphans from the parentId in their own file.
  const childIds = new Set<string>()
  for (const t of taskMap.values()) {
    for (const s of t.subtasks) childIds.add(s.id)
  }
  for (const [taskId, pid] of parentIdMap) {
    if (childIds.has(taskId)) continue
    const parent = taskMap.get(pid)
    if (!parent) continue
    const task = taskMap.get(taskId)
    if (!task) continue
    parent.subtasks.push(task)
    childIds.add(taskId)
    if (!subtaskIdsMap.has(pid)) subtaskIdsMap.set(pid, [])
    const sids = subtaskIdsMap.get(pid)
    if (sids && !sids.includes(taskId)) sids.push(taskId)
    console.warn(
      `[PM] Self-healed orphan: re-parented task "${task.title}" (${taskId}) under "${parent.title}" (${pid})`
    )
  }

  const result: Task[] = []
  const pushed = new Set<string>()
  for (const id of refListToIds(app, topLevelRefs, projectPath, idByPath)) {
    if (pushed.has(id)) continue
    const task = taskMap.get(id)
    if (task) {
      result.push(task)
      pushed.add(id)
    }
  }
  for (const task of taskMap.values()) {
    if (pushed.has(task.id)) continue
    if (!childIds.has(task.id)) result.push(task)
  }

  return result
}

export async function loadTaskFile(
  app: App,
  file: TFile,
  hydrated: Hydrated
): Promise<{ task: Task | null; subtaskIds: string[]; parentId: string | null }> {
  try {
    // metadataCache lets us skip the body read; description stays empty until
    // loadTaskBody fills it.
    const cached = app.metadataCache.getFileCache(file)?.frontmatter
    if (cached && cached[TASK_FRONTMATTER_KEY] === true) {
      return hydrateTaskFromFile(cached, '', file.path)
    }

    const content = await app.vault.cachedRead(file)
    const parsed = parseFrontmatter(content)
    if (parsed.kind !== 'frontmatter' || parsed.frontmatter[TASK_FRONTMATTER_KEY] !== true) {
      return { task: null, subtaskIds: [], parentId: null }
    }

    const result = hydrateTaskFromFile(parsed.frontmatter, parsed.body, file.path)
    hydrated.add(result.task)
    return result
  } catch (e) {
    if (e instanceof Error && e.message.includes('ENOENT')) {
      console.warn(`[PM] Task file no longer exists, skipping: ${file.path}`)
    } else {
      console.error(`[PM] Failed to load task ${file.path}:`, e)
    }
    return { task: null, subtaskIds: [], parentId: null }
  }
}

/**
 * A note's properties and body, taken from Obsidian's own parse where it has one,
 * so a note Obsidian reads is never re-read by a second parser that might disagree.
 * The cached offset is used only when it still lands on a closing fence in the bytes
 * just read, since the cache can describe an older version of the file. Null means
 * neither parse could read the note.
 */
export async function readNote(
  app: App,
  file: TFile
): Promise<{ frontmatter: Record<string, unknown>; body: string } | null> {
  const content = await app.vault.cachedRead(file)
  const cached = app.metadataCache.getFileCache(file)
  const end = cached?.frontmatterPosition?.end.offset
  if (end !== undefined && content.startsWith('---') && content.slice(0, end).trimEnd().endsWith('---')) {
    return { frontmatter: cached?.frontmatter ?? {}, body: content.slice(end).replace(/\r\n/g, '\n').trim() }
  }
  const parsed = parseFrontmatter(content)
  if (parsed.kind === 'malformed') return null
  return { frontmatter: parsed.kind === 'frontmatter' ? parsed.frontmatter : {}, body: parsed.body }
}
