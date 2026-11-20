import {
  type ProjectListField,
  type ProjectListFilter,
  type ProjectListState,
  type ProjectProgress,
  type ProjectSortRule,
  PROJECT_LIST_FIELDS
} from '../types'
import { sameValue } from './ViewState'

export interface ProjectListItem {
  path: string
  title: string
  /** The folder holding the project's own folder, `''` at the vault root. */
  folder: string
  tags: string[]
  done: number
  total: number
  overdue: number
  latestDue: string
}

export interface ProjectListRow {
  item: ProjectListItem
}

export interface ProjectListGroup {
  /** The folder or tag the group stands for; `''` for no folder or no tag. Null when the list isn't grouped. */
  key: string | null
  rows: ProjectListRow[]
  /** Projects in the group matching the query. */
  count: number
}

export function projectProgress(item: ProjectListItem): ProjectProgress {
  if (item.total > 0 && item.done >= item.total) return 'complete'
  return item.done > 0 ? 'in-progress' : 'not-started'
}

export function countProjectFilters(filter: ProjectListFilter): number {
  return (filter.tags?.length ? 1 : 0) + (filter.progress?.length ? 1 : 0)
}

export function isProjectQueryActive(filter: ProjectListFilter, text: string): boolean {
  return countProjectFilters(filter) > 0 || text.trim() !== ''
}

function matches(item: ProjectListItem, filter: ProjectListFilter, text: string): boolean {
  const needle = text.trim().toLowerCase()
  if (needle && !item.title.toLowerCase().includes(needle)) return false
  if (filter.tags?.length && !item.tags.some((tag) => filter.tags?.includes(tag))) return false
  if (filter.progress?.length && !filter.progress.includes(projectProgress(item))) return false
  return true
}

const ratio = (item: ProjectListItem): number => (item.total ? item.done / item.total : 0)

function compareItems(a: ProjectListItem, b: ProjectListItem, sort: ProjectSortRule[]): number {
  for (const { key, dir } of sort) {
    // A project with no dates sorts after every dated one, whichever way the dates run.
    if (key === 'due' && (!a.latestDue || !b.latestDue)) {
      const undated = Number(!a.latestDue) - Number(!b.latestDue)
      if (undated !== 0) return undated
      continue
    }
    const order =
      key === 'title'
        ? compareText(a.title, b.title)
        : key === 'progress'
          ? ratio(a) - ratio(b)
          : compareText(a.latestDue, b.latestDue)
    if (order !== 0) return dir === 'asc' ? order : -order
  }
  return 0
}

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/** Each tag used by any project, with how many projects carry it, by name. */
export function projectTagCounts(roots: ProjectListItem[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const item of roots) for (const tag of item.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => compareText(a.tag, b.tag))
}

/** Flat projects, filtered and sorted within each optional folder or tag group. */
export function arrangeProjects(
  items: ProjectListItem[],
  state: ProjectListState,
  text: string
): { groups: ProjectListGroup[]; shown: number; total: number } {
  const shown = items.filter((item) => matches(item, state.filter, text))
  const rows = (projects: ProjectListItem[]): ProjectListRow[] =>
    [...projects].sort((a, b) => compareItems(a, b, state.sort)).map((item) => ({ item }))
  if (state.group === 'none') {
    return {
      groups: shown.length ? [{ key: null, rows: rows(shown), count: shown.length }] : [],
      shown: shown.length,
      total: items.length
    }
  }
  const byKey = new Map<string, ProjectListItem[]>()
  for (const item of shown) {
    const keys = state.group === 'folder' ? [item.folder] : item.tags.length ? item.tags : ['']
    for (const key of keys) byKey.set(key, [...(byKey.get(key) ?? []), item])
  }
  const keys = [...byKey.keys()].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : compareText(a, b)))
  return {
    groups: keys.map((key) => {
      const projects = byKey.get(key) ?? []
      return { key, rows: rows(projects), count: projects.length }
    }),
    shown: shown.length,
    total: items.length
  }
}

/** The columns as the project list keeps them: undefined once every column shows in the default order. */
export function tidyProjectFields(fields: readonly ProjectListField[] | undefined): ProjectListField[] | undefined {
  return !fields || sameValue(fields, PROJECT_LIST_FIELDS) ? undefined : [...fields]
}
