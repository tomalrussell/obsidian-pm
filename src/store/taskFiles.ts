import { type App, normalizePath } from 'obsidian'
import { type Task, taskFilePath } from '@dotpm/core'
import { findIgnoringCase } from './vaultFs'

/** A basename of this exact length that prefixes the title's slug is kept as-is. */
const LEGACY_SLUG_CAP = 40

/** New tasks get the bare slug; an existing file stays put while its name still matches the title. */
export function resolveTaskPath(task: Task, folder: string, previousPath: string | undefined): string {
  const desired = taskFilePath(task.title, folder)
  if (!previousPath) return desired
  const desiredBasename = desired.slice(desired.lastIndexOf('/') + 1).replace(/\.md$/, '')
  const previousFolder = previousPath.slice(0, previousPath.lastIndexOf('/'))
  const previousBasename = previousPath.slice(previousPath.lastIndexOf('/') + 1).replace(/\.md$/, '')
  if (previousFolder !== folder) return desired
  // A note named by hand keeps capitals the lowercase slug drops; on macOS and Windows
  // it is already the file the slug names.
  const previousLower = previousBasename.toLowerCase()
  const desiredLower = desiredBasename.toLowerCase()
  if (previousLower === desiredLower) return previousPath
  // The slug turns spaces into dashes, so a number behind a space is the one given to a
  // task whose title another task already holds.
  if (previousLower.startsWith(`${desiredLower} `) && /^\d+$/.test(previousLower.slice(desiredLower.length + 1))) {
    return previousPath
  }
  const legacyBasename = `${desiredBasename}-${task.id.slice(0, 8)}`
  if (previousBasename === legacyBasename) return previousPath
  if (previousBasename.length === LEGACY_SLUG_CAP && previousBasename === desiredBasename.slice(0, LEGACY_SLUG_CAP)) {
    return previousPath
  }
  return desired
}

export class TaskFileNameConflictError extends Error {
  constructor(public readonly path: string) {
    super(`A note named "${fileNameFromPath(path)}" already exists.`)
    this.name = 'TaskFileNameConflictError'
  }

  get fileName(): string {
    return fileNameFromPath(this.path)
  }
}

export class UnreadableNoteError extends Error {
  constructor(public readonly path: string) {
    super(`Could not read the properties of "${fileNameFromPath(path)}".`)
    this.name = 'UnreadableNoteError'
  }
}

function fileNameFromPath(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '')
}

/** A free path for a file named `fileName` in `folder`, numbered when the name is taken or already claimed. */
export function uniqueChildPath(app: App, folder: string, fileName: string, claimed?: ReadonlySet<string>): string {
  const dot = fileName.lastIndexOf('.')
  const base = dot > 0 ? fileName.slice(0, dot) : fileName
  const ext = dot > 0 ? fileName.slice(dot) : ''
  let candidate = normalizePath(`${folder}/${base}${ext}`)
  for (let n = 1; claimed?.has(candidate) || findIgnoringCase(app, candidate); n++) {
    candidate = normalizePath(`${folder}/${base} ${n}${ext}`)
  }
  return candidate
}
