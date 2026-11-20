import type { App, Plugin } from 'obsidian'
import { TFile } from 'obsidian'
import { beforeEach, describe, expect, it } from 'vitest'
import { makeFakeApp, type FakeVault } from '#test/fakeVault'
import { DEFAULT_PROJECT_COLOR, DEFAULT_SETTINGS, type PMSettings } from '@dotpm/core'
import { VaultIndex } from './VaultIndex'

const expectDefined = <T>(value: T | null | undefined, message = 'expected value to be defined'): T => {
  if (value == null) throw new Error(message)
  return value
}

function projectNote(id: string, title: string, extra = ''): string {
  return `---\npm-project: true\nid: ${id}\ntitle: ${title}\n${extra}---\n\n# ${title}\n`
}

function taskNote(id: string, title: string, projectId: string, status = 'todo', due = ''): string {
  const dueLine = due ? `due: ${due}\n` : ''
  return `---\npm-task: true\nid: ${id}\nprojectId: ${projectId}\ntitle: ${title}\nstatus: ${status}\n${dueLine}---\n\n`
}

/** Collects the registrations a Plugin would clean up, so events can be driven in tests. */
function fakePlugin(): Plugin {
  return { registerEvent: () => undefined } as unknown as Plugin
}

describe('VaultIndex', () => {
  let vault: FakeVault
  let app: App
  let settings: PMSettings
  let index: VaultIndex

  beforeEach(() => {
    const fake = makeFakeApp({ liveMetadataCache: true })
    vault = fake.vault
    app = fake.app as unknown as App
    settings = { ...DEFAULT_SETTINGS }
    index = new VaultIndex(app, () => settings)
  })

  it('indexes the legacy top priority as yesterday', async () => {
    await vault.create('Projects/P.md', projectNote('p1', 'P'))
    await vault.create(
      'Projects/P_tasks/urgent.md',
      '---\npm-task: true\nid: urgent\nprojectId: p1\npriority: critical\n---\n'
    )
    index.build()
    expect(index.taskRefs('Projects/P.md')[0].priority).toBe('yesterday')
  })

  it('finds projects anywhere in the vault, not just under the projects folder', async () => {
    await vault.create('Projects/Roadmap.md', projectNote('p1', 'Roadmap'))
    await vault.create('Work/Clients/Acme.md', projectNote('p2', 'Acme'))
    await vault.create('Inbox/note.md', '# just a note\n')
    index.build()

    expect(index.projectPaths()).toEqual(['Work/Clients/Acme.md', 'Projects/Roadmap.md'])
  })

  it('ignores a project note living inside another project task folder', async () => {
    await vault.create('Projects/Roadmap.md', projectNote('p1', 'Roadmap'))
    await vault.create('Projects/Roadmap_tasks/nested.md', projectNote('p2', 'Nested'))
    index.build()

    expect(index.projectPaths()).toEqual(['Projects/Roadmap.md'])
  })

  it('attributes tasks in a project folder to that project, keeps projects independent', async () => {
    await vault.create('Projects/Roadmap/Roadmap.md', projectNote('p1', 'Roadmap'))
    await vault.create('Projects/Roadmap/_tasks/one.md', taskNote('t1', 'One', 'p1'))
    await vault.create('Projects/Roadmap/_tasks/Archive/two.md', taskNote('t2', 'Two', 'p1'))
    await vault.create('Projects/Roadmap/_tasks/loose.md', projectNote('p3', 'Loose'))
    await vault.create('Projects/Roadmap/Q3/Q3.md', projectNote('p2', 'Q3', 'parent: "[[Roadmap]]"\n'))
    index.build()

    expect(index.projectPaths()).toEqual(['Projects/Roadmap/Q3/Q3.md', 'Projects/Roadmap/Roadmap.md'])
    expect(index.projectPathForTask('Projects/Roadmap/_tasks/one.md')).toBe('Projects/Roadmap/Roadmap.md')
    expect(index.projectPathForTask('Projects/Roadmap/_tasks/Archive/two.md')).toBe('Projects/Roadmap/Roadmap.md')
  })

  it('skips excluded folders', async () => {
    await vault.create('Projects/Roadmap.md', projectNote('p1', 'Roadmap'))
    await vault.create('Templates/Project template.md', projectNote('tpl', 'Template'))
    settings = { ...settings, excludedFolders: ['Templates'] }
    index.build()

    expect(index.projectPaths()).toEqual(['Projects/Roadmap.md'])
  })

  it('attributes tasks to their project by location', async () => {
    await vault.create('Projects/Roadmap.md', projectNote('p1', 'Roadmap'))
    await vault.create('Projects/Roadmap_tasks/one.md', taskNote('t1', 'One', 'p1'))
    await vault.create('Projects/Roadmap_tasks/Archive/two.md', taskNote('t2', 'Two', 'p1'))
    index.build()

    const refs = index.taskRefs('Projects/Roadmap.md')
    expect(refs.map((r) => r.id).sort()).toEqual(['t1', 't2'])
    expect(refs.find((r) => r.id === 't2')?.archived).toBe(true)
  })

  it('attributes a task moved out of the task folder by its projectId', async () => {
    await vault.create('Projects/Roadmap.md', projectNote('p1', 'Roadmap'))
    await vault.create('Elsewhere/stray.md', taskNote('t1', 'Stray', 'p1'))
    index.build()

    expect(index.taskRefs('Projects/Roadmap.md').map((r) => r.id)).toEqual(['t1'])
    expect(index.projectPathForTask('Elsewhere/stray.md')).toBe('Projects/Roadmap.md')
  })

  it('resolves a task indexed before its project', async () => {
    await vault.create('A stray task.md', taskNote('t1', 'Stray', 'p1'))
    await vault.create('Zulu.md', projectNote('p1', 'Zulu'))
    index.build()

    expect(index.taskRefs('Zulu.md').map((r) => r.id)).toEqual(['t1'])
  })

  it('counts completion using the fixed statuses, ignoring project palettes', async () => {
    const config = 'config:\n  statuses:\n    - id: shipped\n      complete: true\n'
    await vault.create('Projects/Roadmap.md', projectNote('p1', 'Roadmap', config))
    await vault.create('Projects/Roadmap_tasks/a.md', taskNote('t1', 'A', 'p1'))
    await vault.create('Projects/Roadmap_tasks/b.md', taskNote('t2', 'B', 'p1', 'shipped'))
    await vault.create('Projects/Roadmap_tasks/c.md', taskNote('t3', 'C', 'p1', 'done'))
    index.build()

    const ref = expectDefined(index.projectRef('Projects/Roadmap.md'))
    expect(index.counts(ref)).toEqual({ total: 3, done: 1 })
  })

  it('does not let a project redefine the fixed done status', async () => {
    const config = 'config:\n  statuses:\n    - id: done\n      complete: false\n'
    await vault.create('Projects/Roadmap.md', projectNote('p1', 'Roadmap', config))
    await vault.create('Projects/Roadmap_tasks/a.md', taskNote('t1', 'A', 'p1'))
    await vault.create('Projects/Roadmap_tasks/b.md', taskNote('t2', 'B', 'p1', 'done'))
    index.build()

    expect(index.counts(expectDefined(index.projectRef('Projects/Roadmap.md')))).toEqual({ total: 2, done: 1 })
  })

  it('counts against the global palette when the project defines none', async () => {
    await vault.create('Projects/Roadmap.md', projectNote('p1', 'Roadmap'))
    await vault.create('Projects/Roadmap_tasks/a.md', taskNote('t1', 'A', 'p1'))
    await vault.create('Projects/Roadmap_tasks/b.md', taskNote('t2', 'B', 'p1', 'done'))
    index.build()

    expect(index.counts(expectDefined(index.projectRef('Projects/Roadmap.md')))).toEqual({ total: 2, done: 1 })
  })

  it('leaves archived tasks out of a project row', async () => {
    await vault.create('Projects/Roadmap.md', projectNote('p1', 'Roadmap'))
    await vault.create('Projects/Roadmap_tasks/a.md', taskNote('t1', 'A', 'p1', 'todo', '2020-01-01'))
    await vault.create('Projects/Roadmap_tasks/Archive/b.md', taskNote('t2', 'B', 'p1', 'todo', '2020-06-01'))
    index.build()

    const ref = expectDefined(index.projectRef('Projects/Roadmap.md'))
    expect(index.counts(ref)).toEqual({ total: 1, done: 0 })
    expect(index.dueSummary(ref)).toEqual({ overdue: 1, latestDue: '2020-01-01' })
  })

  it('falls back to the default color when a project note holds an invalid one', async () => {
    await vault.create('Projects/Roadmap.md', projectNote('p1', 'Roadmap', 'color: blue\n'))
    index.build()

    expect(expectDefined(index.projectRef('Projects/Roadmap.md')).color).toBe(DEFAULT_PROJECT_COLOR)
  })

  it('counts a task once when a sync conflict leaves two notes with its id', async () => {
    await vault.create('Projects/Roadmap.md', projectNote('p1', 'Roadmap'))
    await vault.create('Projects/Roadmap_tasks/a.md', taskNote('t1', 'A', 'p1', 'todo', '2020-01-01'))
    await vault.create('Projects/Roadmap_tasks/a (conflict).md', taskNote('t1', 'A', 'p1', 'todo', '2020-01-01'))
    index.build()

    const ref = expectDefined(index.projectRef('Projects/Roadmap.md'))
    expect(index.counts(ref)).toEqual({ total: 1, done: 0 })
    expect(index.dueSummary(ref).overdue).toBe(1)
  })

  it('ignores old parent links for project visibility and task counts', async () => {
    await vault.create('A.md', projectNote('p1', 'A', 'archived: true\n'))
    await vault.create('B.md', projectNote('p2', 'B', 'parent: "[[A]]"\n'))
    await vault.create('A_tasks/a.md', taskNote('t1', 'A1', 'p1', 'done'))
    await vault.create('B_tasks/b.md', taskNote('t2', 'B1', 'p2'))
    index.build()

    expect(index.projectRefs().map((ref) => ref.title)).toEqual(['B'])
    expect(index.isArchived('A.md')).toBe(true)
    expect(index.isArchived('B.md')).toBe(false)
    expect(index.counts(expectDefined(index.projectRef('B.md')))).toEqual({ total: 1, done: 0 })
  })

  describe('cross-project references', () => {
    beforeEach(async () => {
      await vault.create('A.md', projectNote('p1', 'A'))
      await vault.create('B.md', projectNote('p2', 'B'))
      await vault.create('A_tasks/one.md', taskNote('t1', 'One', 'p1'))
      await vault.create(
        'B_tasks/two.md',
        `---\npm-task: true\nid: t2\nprojectId: p2\ntitle: Two\nstatus: todo\ndependencies:\n  - t1\n---\n`
      )
      index.build()
    })

    it('resolves a task id from any project', () => {
      expect(index.task('t1')?.path).toBe('A_tasks/one.md')
      expect(index.task('nope')).toBeNull()
    })

    it('reports what depends on a task, across projects', () => {
      expect(index.dependents('t1').map((r) => r.id)).toEqual(['t2'])
      expect(index.dependents('t2')).toEqual([])
    })

    it('sees a cycle that spans two projects', () => {
      // t2 already depends on t1, so making t1 depend on t2 closes the loop.
      expect(index.wouldCreateCycle('t1', 't2')).toBe(true)
      expect(index.wouldCreateCycle('t2', 't1')).toBe(false)
    })

    it('picks up a dependency added after the first read', async () => {
      index.register(fakePlugin())
      expect(index.dependentsMap().get('t2')).toBeUndefined()

      await vault.modify(
        expectDefined(vault.getAbstractFileByPath('A_tasks/one.md') as TFile | null),
        `---\npm-task: true\nid: t1\nprojectId: p1\ntitle: One\nstatus: todo\ndependencies:\n  - t2\n---\n`
      )

      expect(index.dependentsMap().get('t2')).toEqual(['t1'])
    })
  })

  describe('incremental maintenance', () => {
    beforeEach(async () => {
      await vault.create('Projects/Roadmap.md', projectNote('p1', 'Roadmap'))
      index.build()
      index.register(fakePlugin())
    })

    it('picks up a project created after the build', async () => {
      await vault.create('Later/Side quest.md', projectNote('p2', 'Side quest'))
      expect(index.projectPaths()).toContain('Later/Side quest.md')
    })

    it('picks up a task created after the build', async () => {
      await vault.create('Projects/Roadmap_tasks/a.md', taskNote('t1', 'A', 'p1'))
      expect(index.taskRefs('Projects/Roadmap.md').map((r) => r.id)).toEqual(['t1'])
    })

    it('follows a status edit', async () => {
      const file = await vault.create('Projects/Roadmap_tasks/a.md', taskNote('t1', 'A', 'p1'))
      await vault.process(file, (c) => c.replace('status: todo', 'status: done'))
      const ref = expectDefined(index.projectRef('Projects/Roadmap.md'))
      expect(index.counts(ref)).toEqual({ total: 1, done: 1 })
    })

    it('drops a note that stops being a project', async () => {
      const file = await vault.create('Later/Side quest.md', projectNote('p2', 'Side quest'))
      await vault.process(file, (c) => c.replace('pm-project: true', 'pm-project: false'))
      expect(index.projectPaths()).not.toContain('Later/Side quest.md')
    })

    it('drops a deleted project', async () => {
      await vault.trashFile(expectDefined(vault.getAbstractFileByPath('Projects/Roadmap.md')))
      expect(index.projectPaths()).toEqual([])
    })

    it('follows a renamed project file', async () => {
      await vault.rename(expectDefined(vault.getAbstractFileByPath('Projects/Roadmap.md')), 'Projects/Plan.md')
      expect(index.projectPaths()).toEqual(['Projects/Plan.md'])
    })

    it('keeps the tasks of a project whose file is renamed', async () => {
      await vault.create('Projects/Roadmap_tasks/a.md', taskNote('t1', 'A', 'p1'))
      await vault.rename(expectDefined(vault.getAbstractFileByPath('Projects/Roadmap.md')), 'Projects/Plan.md')

      expect(index.taskRefs('Projects/Plan.md').map((r) => r.id)).toEqual(['t1'])
      expect(index.counts(expectDefined(index.projectRef('Projects/Plan.md')))).toEqual({ total: 1, done: 0 })
    })

    it('follows the tasks of a renamed task folder', async () => {
      await vault.create('Projects/Roadmap_tasks/a.md', taskNote('t1', 'A', 'p1'))
      await vault.rename(expectDefined(vault.getAbstractFileByPath('Projects/Roadmap.md')), 'Projects/Plan.md')
      await vault.rename(expectDefined(vault.getAbstractFileByPath('Projects/Roadmap_tasks')), 'Projects/Plan_tasks')

      expect(expectDefined(index.task('t1')).path).toBe('Projects/Plan_tasks/a.md')
      expect(index.taskRefs('Projects/Plan.md').map((r) => r.id)).toEqual(['t1'])
      expect(index.projectPathForTask('Projects/Plan_tasks/a.md')).toBe('Projects/Plan.md')
    })

    it('follows a project moved with its folder', async () => {
      await vault.create('Later/Side quest.md', projectNote('p2', 'Side quest'))
      await vault.rename(expectDefined(vault.getAbstractFileByPath('Later')), 'Archive box')

      expect(index.projectPaths()).toContain('Archive box/Side quest.md')
      expect(index.projectPaths()).not.toContain('Later/Side quest.md')
    })

    it('reports changes to subscribers', async () => {
      let calls = 0
      index.onChange(() => calls++)
      await vault.create('Later/Side quest.md', projectNote('p2', 'Side quest'))
      expect(calls).toBe(1)
    })
  })
})

describe('VaultIndex id collisions', () => {
  let vault: FakeVault
  let index: VaultIndex

  beforeEach(() => {
    const fake = makeFakeApp({ liveMetadataCache: true })
    vault = fake.vault
    index = new VaultIndex(fake.app as unknown as App, () => ({ ...DEFAULT_SETTINGS }))
  })

  it('reports task and project ids that two projects claim', async () => {
    await vault.create('Projects/Template/Template.md', projectNote('p1', 'Template'))
    await vault.create('Projects/Template/_tasks/one.md', taskNote('t1', 'One', 'p1'))
    await vault.create('Projects/Copy/Copy.md', projectNote('p1', 'Template'))
    await vault.create('Projects/Copy/_tasks/one.md', taskNote('t1', 'One', 'p1'))
    index.build()

    const tasks = index.findTaskIdCollisions()
    expect([...tasks.keys()]).toEqual(['t1'])
    expect(
      expectDefined(tasks.get('t1'))
        .map((ref) => ref.path)
        .sort()
    ).toEqual(['Projects/Copy/_tasks/one.md', 'Projects/Template/_tasks/one.md'])
    expect([...index.findProjectIdCollisions().keys()]).toEqual(['p1'])
  })

  it('does not report an id repeated inside one project', async () => {
    await vault.create('Projects/Roadmap/Roadmap.md', projectNote('p1', 'Roadmap'))
    await vault.create('Projects/Roadmap/_tasks/one.md', taskNote('t1', 'One', 'p1'))
    await vault.create('Projects/Roadmap/_tasks/Archive/one.md', taskNote('t1', 'One', 'p1'))
    index.build()

    expect(index.findTaskIdCollisions().size).toBe(0)
  })

  it('reports nothing when every id is unique', async () => {
    await vault.create('Projects/A/A.md', projectNote('p1', 'A'))
    await vault.create('Projects/A/_tasks/one.md', taskNote('t1', 'One', 'p1'))
    await vault.create('Projects/B/B.md', projectNote('p2', 'B'))
    await vault.create('Projects/B/_tasks/two.md', taskNote('t2', 'Two', 'p2'))
    index.build()

    expect(index.findTaskIdCollisions().size).toBe(0)
    expect(index.findProjectIdCollisions().size).toBe(0)
  })
})
