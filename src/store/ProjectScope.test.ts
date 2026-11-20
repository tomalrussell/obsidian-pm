import type { App } from 'obsidian'
import { beforeEach, describe, expect, it } from 'vitest'
import { makeFakeApp } from '#test/fakeVault'
import { DEFAULT_SETTINGS, makeTask, type PMSettings, type Project } from '@dotpm/core'
import { ProjectStore } from './ProjectStore'
import { ProjectScope, resolveScopePaths, scopeKey, selectionSpec } from './ProjectScope'
import { VaultIndex } from './VaultIndex'

const SETTINGS: PMSettings = { ...DEFAULT_SETTINGS }

function newStore(): ProjectStore {
  const { app } = makeFakeApp()
  return new ProjectStore(app as unknown as App, () => SETTINGS)
}

describe('scopeKey', () => {
  it('is stable per spec', () => {
    expect(scopeKey({ kind: 'project', path: 'A.md' })).toBe('project:A.md')
    expect(scopeKey({ kind: 'vault' })).toBe('vault')
  })

  it('names a picked set by its paths in any order', () => {
    expect(scopeKey({ kind: 'picked', paths: ['B.md', 'A.md'] })).toBe('picked:A.md|B.md')
    expect(scopeKey({ kind: 'picked', paths: ['A.md', 'B.md'] })).toBe('picked:A.md|B.md')
  })
})

describe('selectionSpec', () => {
  it('names one project alone', () => {
    expect(selectionSpec(['A.md'])).toEqual({ kind: 'project', path: 'A.md' })
  })

  it('picks any other set, keeping its order', () => {
    expect(selectionSpec(['A.md', 'A1.md'])).toEqual({ kind: 'picked', paths: ['A.md', 'A1.md'] })
    expect(selectionSpec(['B.md', 'A.md', 'A1.md', 'A2.md'])).toEqual({
      kind: 'picked',
      paths: ['B.md', 'A.md', 'A1.md', 'A2.md']
    })
  })
})

describe('resolveScopePaths', () => {
  let index: VaultIndex

  beforeEach(async () => {
    const fake = makeFakeApp({ liveMetadataCache: true })
    const note = (id: string, title: string, parent = '') =>
      `---\npm-project: true\nid: ${id}\ntitle: ${title}\n${parent ? `parent: "[[${parent}]]"\n` : ''}---\n`
    await fake.vault.create('Work/Platform.md', note('p1', 'Platform'))
    await fake.vault.create('Work/Billing.md', note('p2', 'Billing', 'Platform'))
    await fake.vault.create('Work/Deep.md', note('p3', 'Deep', 'Billing'))
    await fake.vault.create('Personal/Garden.md', note('p4', 'Garden'))
    await fake.vault.create('Personal/Old.md', note('p5', 'Old').replace(/---\n$/, 'archived: true\n---\n'))
    await fake.vault.create('Personal/Older.md', note('p6', 'Older', 'Old'))
    index = new VaultIndex(fake.app as unknown as App, () => SETTINGS)
    index.build()
  })

  it('leaves only explicitly archived projects out of folder and vault scopes', () => {
    expect(resolveScopePaths({ kind: 'folder', path: 'Personal' }, index)).toEqual([
      'Personal/Garden.md',
      'Personal/Older.md'
    ])
    expect(resolveScopePaths({ kind: 'vault' }, index)).toHaveLength(5)
  })

  it('resolves one project', () => {
    expect(resolveScopePaths({ kind: 'project', path: 'Work/Platform.md' }, index)).toEqual(['Work/Platform.md'])
  })

  it('resolves a folder', () => {
    expect(resolveScopePaths({ kind: 'folder', path: 'Personal' }, index)).toEqual([
      'Personal/Garden.md',
      'Personal/Older.md'
    ])
  })

  it('resolves the whole vault', () => {
    expect(resolveScopePaths({ kind: 'vault' }, index)).toHaveLength(5)
  })

  it('resolves picked projects in the order they were picked, without the ones gone', () => {
    const spec = { kind: 'picked' as const, paths: ['Personal/Garden.md', 'Gone.md', 'Work/Platform.md'] }
    expect(resolveScopePaths(spec, index)).toEqual(['Personal/Garden.md', 'Work/Platform.md'])
  })

  it('resolves a project that no longer exists to nothing', () => {
    expect(resolveScopePaths({ kind: 'project', path: 'Gone.md' }, index)).toEqual([])
  })
})

describe('ProjectScope', () => {
  let store: ProjectStore
  let alpha: Project
  let beta: Project

  beforeEach(async () => {
    store = newStore()
    alpha = await store.createProject('Alpha', 'Projects')
    beta = await store.createProject('Beta', 'Work')
    await store.insertTask(alpha, makeTask({ title: 'Alpha one' }))
    await store.insertTask(beta, makeTask({ title: 'Beta one' }))
  })

  it('lists the tasks of every project in scope order', () => {
    const scope = new ProjectScope({ kind: 'vault' }, [alpha, beta], store)
    expect(scope.tasks().map((t) => t.title)).toEqual(['Alpha one', 'Beta one'])
  })

  it('answers which project owns a task', () => {
    const scope = new ProjectScope({ kind: 'vault' }, [alpha, beta], store)
    expect(scope.projectOf(beta.tasks[0].id)).toBe(beta)
    expect(scope.projectOf('nope')).toBeNull()
  })

  it('takes the primary project as the target for new work', () => {
    const scope = new ProjectScope({ kind: 'vault' }, [alpha, beta], store)
    expect(scope.primary).toBe(alpha)
    expect(scope.isMulti).toBe(true)
  })

  it('keeps the fixed status options across projects', async () => {
    const scope = new ProjectScope({ kind: 'vault' }, [alpha, beta], store)

    const ids = scope.config.statuses.map((s) => s.id)
    expect(ids.slice(0, DEFAULT_SETTINGS.statuses.length)).toEqual(DEFAULT_SETTINGS.statuses.map((s) => s.id))
    expect(ids).toEqual(DEFAULT_SETTINGS.statuses.map((s) => s.id))
  })

  it('uses the fixed status options for every project', async () => {
    const scope = new ProjectScope({ kind: 'vault' }, [alpha, beta], store)

    expect(scope.configOf(beta.tasks[0].id).statuses.map((s) => s.id)).toEqual(
      DEFAULT_SETTINGS.statuses.map((s) => s.id)
    )
    expect(scope.configOf(alpha.tasks[0].id).statuses.map((s) => s.id)).toEqual(
      DEFAULT_SETTINGS.statuses.map((s) => s.id)
    )
  })

  it('leaves a single-project scope reading exactly like the project', () => {
    const scope = new ProjectScope({ kind: 'project', path: alpha.filePath }, [alpha], store)
    expect(scope.isMulti).toBe(false)
    expect(scope.tasks()).toBe(alpha.tasks)
    expect(scope.config).toEqual(store.configFor(alpha))
    expect(scope.label()).toBe('Alpha')
  })

  it('unions custom fields', async () => {
    await store.updateProject(alpha, {
      customFields: [{ id: 'cf1', name: 'Client', type: 'text' }]
    })
    await store.updateProject(beta, {
      customFields: [{ id: 'cf2', name: 'Risk', type: 'text' }]
    })
    const scope = new ProjectScope({ kind: 'vault' }, [alpha, beta], store)

    expect(scope.customFields().map((f) => f.id)).toEqual(['cf1', 'cf2'])
  })
})
