import { type Task, flattenTasks } from '@dotpm/core'

/** The tasks a board deals cards for: the top-level ones, or every task once subtasks get cards of their own. */
export function boardCandidates(tasks: Task[], fields: string[]): Task[] {
  return fields.includes('subtasks') ? flattenTasks(tasks).map((flat) => flat.task) : tasks
}

/** A description as one line of plain text, cut to what a card has room for. */
export function descriptionPreview(markdown: string): string | undefined {
  const text = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^[ \t]*[#>\-*+]+[ \t]+/gm, '')
    .replace(/[*~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return text ? text.slice(0, 240) : undefined
}
