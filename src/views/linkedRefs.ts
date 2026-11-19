import type { App } from 'obsidian'
import type { NoteLink } from '@dotpm/ui'

/** Turns wikilink values into labels and navigation handlers for generic link fields. */
export function linkedRefs(app: App, values: string[], sourcePath: string): NoteLink[] {
  return values.map((raw) => {
    const trimmed = raw.trim()
    const inner = /^\[\[(.+)\]\]$/.exec(trimmed)?.[1]
    if (!inner) return { name: trimmed }
    const [target, alias] = inner.split('|', 2).map((part) => part.trim())
    const file = app.metadataCache.getFirstLinkpathDest(target, sourcePath)
    const name = alias || file?.basename || target.split('/').at(-1)?.replace(/\.md$/i, '') || target
    return {
      name,
      unresolved: !file,
      onClick: file ? () => app.workspace.openLinkText(file.path, sourcePath) : undefined
    }
  })
}
