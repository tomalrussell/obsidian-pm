import { describe, expect, it } from 'vitest'
import { makeDefaultProjectList, type ProjectListState } from '../types'
import {
  arrangeProjects,
  countProjectFilters,
  projectProgress,
  projectTagCounts,
  tidyProjectFields,
  type ProjectListItem
} from './ProjectList'

function item(title: string, overrides: Partial<ProjectListItem> = {}): ProjectListItem {
  return {
    path: `${title}.md`,
    title,
    folder: '',
    tags: [],
    done: 0,
    total: 0,
    overdue: 0,
    latestDue: '',
    ...overrides
  }
}

const checkout = item('Checkout', { tags: ['client'], done: 5, total: 5, latestDue: '2026-10-01' })
const onboarding = item('Onboarding', { done: 1, total: 4, latestDue: '2026-09-01' })
const acme = item('Acme', {
  folder: 'Clients',
  tags: ['client'],
  done: 6,
  total: 9
})
const website = item('Website', { folder: 'Internal', tags: ['web', 'client'] })
const roots = [website, acme, checkout, onboarding]

const state = (overrides: Partial<ProjectListState> = {}): ProjectListState => ({
  ...makeDefaultProjectList(),
  ...overrides
})
const titles = (result: ReturnType<typeof arrangeProjects>): string[][] =>
  result.groups.map((group) => group.rows.map((row) => row.item.title))

describe('arrangeProjects', () => {
  it('filters independent projects without retaining unrelated projects', () => {
    const result = arrangeProjects(roots, state(), 'checkout')
    expect(titles(result)).toEqual([['Checkout']])
    expect(result).toMatchObject({ shown: 1, total: 4 })
  })
  it('matches tags with OR and combines them with progress', () => {
    const filter = { tags: ['web', 'client'], progress: ['in-progress' as const] }
    expect(titles(arrangeProjects(roots, state({ filter }), ''))).toEqual([['Acme']])
    expect(countProjectFilters(filter)).toBe(2)
  })

  it('sorts projects by several keys, undated projects last either way', () => {
    const byDue = arrangeProjects(roots, state({ sort: [{ key: 'due', dir: 'desc' }] }), '')
    expect(titles(byDue)[0]).toEqual(['Checkout', 'Onboarding', 'Website', 'Acme'])
    const byTitle = arrangeProjects(roots, state({ sort: [{ key: 'title', dir: 'asc' }] }), '')
    expect(titles(byTitle)[0]).toEqual(['Acme', 'Checkout', 'Onboarding', 'Website'])
    const byProgress = arrangeProjects(roots, state({ sort: [{ key: 'progress', dir: 'desc' }] }), '')
    expect(titles(byProgress)[0][0]).toBe('Checkout')
  })

  it('groups projects by folder, the vault root last', () => {
    const loose = item('Loose')
    const result = arrangeProjects([...roots, loose], state({ group: 'folder' }), '')
    expect(result.groups.map((group) => group.key)).toEqual(['Clients', 'Internal', ''])
    expect(titles(result)[0]).toEqual(['Acme'])
    expect(result.groups[0].count).toBe(1)
  })

  it('puts a project under each of its tags, untagged ones last, and drops emptied groups', () => {
    const loose = item('Loose')
    const result = arrangeProjects([...roots, loose], state({ group: 'tag' }), '')
    expect(result.groups.map((group) => group.key)).toEqual(['client', 'web', ''])
    expect(titles(result)[0]).toEqual(['Website', 'Acme', 'Checkout'])
    const searched = arrangeProjects([...roots, loose], state({ group: 'tag' }), 'loose')
    expect(searched.groups.map((group) => group.key)).toEqual([''])
  })
})

describe('project helpers', () => {
  it('reads progress from each project counts', () => {
    expect(projectProgress(item('Empty'))).toBe('not-started')
    expect(projectProgress(onboarding)).toBe('in-progress')
    expect(projectProgress(checkout)).toBe('complete')
  })

  it('counts each tag across every project', () => {
    expect(projectTagCounts(roots)).toEqual([
      { tag: 'client', count: 3 },
      { tag: 'web', count: 1 }
    ])
  })
})

describe('tidyProjectFields', () => {
  it('drops the list once every column shows in the default order', () => {
    expect(tidyProjectFields(['progress', 'tasks', 'due'])).toBeUndefined()
    expect(tidyProjectFields(undefined)).toBeUndefined()
  })

  it('keeps a reordered or shortened list', () => {
    expect(tidyProjectFields(['due', 'progress', 'tasks'])).toEqual(['due', 'progress', 'tasks'])
    expect(tidyProjectFields(['progress', 'due'])).toEqual(['progress', 'due'])
    expect(tidyProjectFields([])).toEqual([])
  })
})
