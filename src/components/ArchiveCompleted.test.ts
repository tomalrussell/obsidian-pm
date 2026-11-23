import type { App } from 'obsidian'
import { beforeEach, describe, expect, it } from 'vitest'
import { makeFakeApp } from '#test/fakeVault'
import { today, findTask, DEFAULT_SETTINGS, makeTask, type PMSettings, type Project, type Task } from '@dotpm/core'
import { ProjectStore, VaultIndex } from '#store'
import type PMPlugin from '#main'
import { planArchive } from './ArchiveCompleted'

const daysAgo = (days: number): string => today().subtract({ days }).toString()

describe('planArchive', () => {
  let app: App
  let index: VaultIndex
  let store: ProjectStore
  let plugin: PMPlugin

  beforeEach(() => {
    app = makeFakeApp({ liveMetadataCache: true }).app as unknown as App
    const settings: PMSettings = structuredClone(DEFAULT_SETTINGS)
    index = new VaultIndex(app, () => settings)
    store = new ProjectStore(app, () => settings, index)
    plugin = { app, index, store, settings, saveSettings: () => Promise.resolve() } as unknown as PMPlugin
  })

  async function addTask(project: Project, title: string, patch: Partial<Task> = {}): Promise<Task> {
    const task = makeTask({ title })
    await store.insertTask(project, task)
    if (Object.keys(patch).length) await store.updateTask(project, task.id, patch)
    return task
  }

  const done = (completed: string): Partial<Task> => ({ status: 'done', completed })

  function archived(project: Project, task: Task): boolean {
    return findTask(project.tasks, task.id)?.archived === true
  }

  async function archiveAll(): Promise<void> {
    for (const plan of await planArchive(plugin, index.projectPaths())) {
      await store.archiveTasks(plan.project, plan.rootIds)
    }
  }

  it('archives every completed task, however recently it finished', async () => {
    const project = await store.createProject('Roadmap', 'Projects')
    const old = await addTask(project, 'Old', done(daysAgo(30)))
    const justNow = await addTask(project, 'Just finished', done(today().toString()))
    const open = await addTask(project, 'Open')
    index.build()

    await archiveAll()

    expect(archived(project, old)).toBe(true)
    expect(findTask(project.tasks, old.id)?.filePath).toMatch(/\/Archive\//)
    expect(archived(project, justNow)).toBe(true)
    expect(archived(project, open)).toBe(false)
  })

  it('never archives a completed task carrying no completion date', async () => {
    const project = await store.createProject('Roadmap', 'Projects')
    const undated = await addTask(project, 'Undated', done(today().toString()))
    // Completing a task stamps the date, so it is cleared afterwards.
    await store.updateTask(project, undated.id, { completed: '' })
    index.build()

    await archiveAll()

    expect(archived(project, undated)).toBe(false)
  })

  it('leaves a task another project still depends on', async () => {
    const library = await store.createProject('Library', 'Projects')
    const consumer = await store.createProject('App', 'Projects')
    const api = await addTask(library, 'API', done(daysAgo(30)))
    await addTask(consumer, 'Client', { dependencies: [api.id] })
    index.build()

    await archiveAll()

    expect(archived(library, api)).toBe(false)
  })

  it('plans only the projects given', async () => {
    const a = await store.createProject('A', 'Projects')
    const b = await store.createProject('B', 'Projects')
    await addTask(a, 'Done A', done(daysAgo(1)))
    await addTask(b, 'Done B', done(daysAgo(1)))
    index.build()

    const plans = await planArchive(plugin, [a.filePath])

    expect(plans.map((plan) => plan.project.filePath)).toEqual([a.filePath])
  })
})
