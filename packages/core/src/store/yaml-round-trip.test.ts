import { describe, expect, it } from 'vitest'
import { DEFAULT_PROJECT_COLOR, makeProject, makeTask, type Project, type Task } from '../types'
import {
  hydrateFields,
  hydrateFilter,
  hydrateSort,
  hydrateProjectFromFrontmatter,
  hydrateTaskFromFile
} from './YamlHydrator'
import { parseFrontmatter } from './YamlParser'
import {
  buildTaskFrontmatter,
  foreignFrontmatter,
  PROJECT_FRONTMATTER_KEYS,
  serializeProject,
  serializeTask,
  TASK_FRONTMATTER_KEYS,
  taskFilePath,
  type RefWriter
} from './YamlSerializer'

/** Stands in for Obsidian: every fixture file name here is unique, so none needs its path. */
const refs: RefWriter = {
  link: (targetPath, title) => `[[${targetPath.replace(/^.*\//, '').replace(/\.md$/, '')}|${title}]]`,
  task: (task) => (task.filePath ? refs.link(task.filePath, task.title) : null),
  dependency: () => null
}

function roundTripTask(
  t: Task,
  project: Project = makeProject('Test', 'Projects/Test.md'),
  parent: Task | null = null
) {
  const md = serializeTask(t, project, parent, [], refs)
  const parsed = parseFrontmatter(md)
  if (parsed.kind !== 'frontmatter') throw new Error('frontmatter missing')
  return hydrateTaskFromFile(parsed.frontmatter, parsed.body, 'Projects/Test_tasks/task.md')
}

function roundTripProject(p: Project) {
  const md = serializeProject(p, [], refs)
  const parsed = parseFrontmatter(md)
  if (parsed.kind !== 'frontmatter') throw new Error('frontmatter missing')
  return {
    project: hydrateProjectFromFrontmatter(parsed.frontmatter, parsed.body, p.filePath, 'Test'),
    frontmatter: parsed.frontmatter
  }
}

describe('task round-trip', () => {
  it('preserves core scheduling and metadata fields', () => {
    const original = makeTask({
      id: 'task-1',
      title: 'Design API',
      description: 'Draft the endpoints.',
      status: 'in-progress',
      priority: 'high',
      start: '2026-04-01',
      due: '2026-04-10',
      progress: 50,
      tags: ['api', 'design'],
      dependencies: ['dep-1']
    })
    const { task, subtaskIds, parentId } = roundTripTask(original)

    expect(task.id).toBe(original.id)
    expect(task.title).toBe(original.title)
    expect(task.description).toBe(original.description)
    expect(task.status).toBe(original.status)
    expect(task.priority).toBe(original.priority)
    expect(task.start).toBe(original.start)
    expect(task.due).toBe(original.due)
    expect(task.progress).toBe(original.progress)
    expect(task.tags).toEqual(original.tags)
    expect(task.dependencies).toEqual(original.dependencies)
    expect(subtaskIds).toEqual([])
    expect(parentId).toBeNull()
  })

  it('records subtaskIds and parentId when present', () => {
    const child = makeTask({ id: 'child-1' })
    const parent = makeTask({ id: 'parent-1', subtasks: [child] })
    const project = makeProject('Test', 'Projects/Test.md')

    const top = roundTripTask(parent, project, null)
    expect(top.subtaskIds).toEqual(['child-1'])
    expect(top.parentId).toBeNull()

    const nested = roundTripTask(child, project, parent)
    expect(nested.subtaskIds).toEqual([])
    expect(nested.parentId).toBe('parent-1')
  })

  it('preserves a milestone type and empty start', () => {
    const original = makeTask({ id: 'm-1', type: 'milestone', start: '', due: '2026-05-01' })
    const { task } = roundTripTask(original)
    expect(task.type).toBe('milestone')
    expect(task.start).toBe('')
    expect(task.due).toBe('2026-05-01')
  })

  it('subtask wikilinks derive from sub.filePath, falling back to a bare slug', () => {
    const project = makeProject('P', 'Projects/P.md')
    const legacySub = makeTask({ id: 'sub-legacy', title: 'Legacy', filePath: 'Projects/P_tasks/legacy-12345678.md' })
    const newSub = makeTask({ id: 'sub-new', title: 'Fresh One' }) // no filePath yet
    const parent = makeTask({ id: 'parent', subtasks: [legacySub, newSub] })
    const md = serializeTask(parent, project, null, [], refs)
    expect(md).toContain('[[legacy-12345678|Legacy]]')
    expect(md).toContain('[[fresh-one|Fresh One]]')
  })

  it('drops auto-generated Parent wiki-link and Subtasks section from the description', () => {
    const child = makeTask({ id: 'child' })
    const parent = makeTask({ id: 'parent-x', description: 'User-written note.', subtasks: [child] })
    const { task } = roundTripTask(parent)
    expect(task.description).toBe('User-written note.')
  })

  it('keeps only the usable values in tags and dependencies', () => {
    const frontmatter: Record<string, unknown> = {
      id: 't-x',
      tags: ['api', 2026, { name: 'design' }],
      dependencies: ['dep-1', null]
    }
    const { task } = hydrateTaskFromFile(frontmatter, '', 'path.md')
    expect(task.tags).toEqual(['api', '2026'])
    expect(task.dependencies).toEqual(['dep-1'])
  })
})

describe('project round-trip', () => {
  it('preserves core project fields', () => {
    const p = makeProject('My Project', 'Projects/MyProject.md')
    p.description = 'A great project.'
    p.color = '#ff0000'
    p.icon = '\u{1F680}'

    const { project } = roundTripProject(p)
    expect(project.title).toBe('My Project')
    expect(project.description).toBe('A great project.')
    expect(project.color).toBe('#ff0000')
    expect(project.icon).toBe('\u{1F680}')
  })

  it('keeps the description out of the properties and reads it back from the note', () => {
    const p = makeProject('P', 'Projects/P.md')
    p.description = 'Line one.\n\nLine two.'
    p.tasks = [makeTask({ id: 't1', title: 'T', filePath: 'Projects/P/_tasks/t.md' })]

    const { project, frontmatter } = roundTripProject(p)
    expect(frontmatter.description).toBeUndefined()
    expect(project.description).toBe('Line one.\n\nLine two.')
  })

  it('falls back to the default color when a project note holds an invalid one', () => {
    for (const color of [123, 'blue', ['#fff']]) {
      const project = hydrateProjectFromFrontmatter({ color }, '# P', 'Projects/P.md', 'P')
      expect(project.color).toBe(DEFAULT_PROJECT_COLOR)
    }
  })

  it('reads the description from a note that carries it only as a property', () => {
    const project = hydrateProjectFromFrontmatter({ description: 'From properties' }, '# P', 'Projects/P.md', 'P')
    expect(project.description).toBe('From properties')
  })

  it('prefers the note over a description property an older version left behind', () => {
    const body = '# P\n\nFrom the note\n\n## Tasks\n- [ ] [[t|T]]'
    const project = hydrateProjectFromFrontmatter({ description: 'From properties' }, body, 'Projects/P.md', 'P')
    expect(project.description).toBe('From the note')
  })

  it('keeps supported sort rules and reads older single-sort settings', () => {
    expect(hydrateSort({ sortKey: 'estimate', sortDir: 'sideways' })).toEqual([{ key: 'status', dir: 'asc' }])
    expect(hydrateSort({ sortKey: 'due', sortDir: 'desc' })).toEqual([{ key: 'due', dir: 'desc' }])
    expect(
      hydrateSort({
        sort: [
          { key: 'due', dir: 'desc' },
          { key: 'due', dir: 'asc' },
          { key: 'removed', dir: 'asc' },
          { key: 'title', dir: 'sideways' },
          { key: 'status' },
          { key: 'progress', dir: 'desc' }
        ]
      })
    ).toEqual([
      { key: 'due', dir: 'desc' },
      { key: 'title', dir: 'asc' },
      { key: 'status', dir: 'asc' }
    ])
    expect(hydrateSort({ sort: [] })).toEqual([])
  })

  it('reads legacy filters and drops malformed conditions', () => {
    expect(hydrateFilter({ text: ' api ', statuses: ['todo'], dueDateFilter: 'no-date', showArchived: true })).toEqual({
      conditions: [
        { field: 'status', op: 'any', value: ['todo'] },
        { field: 'due', op: 'empty' },
        { field: 'title', op: 'contains', value: 'api' }
      ],
      showArchived: true
    })
    expect(
      hydrateFilter({
        conditions: [{ field: 'status', op: 'sometimes' }, { op: 'any' }, 'x', { field: 'tag', op: 'empty' }]
      }).conditions
    ).toEqual([{ field: 'tag', op: 'empty' }])
  })

  it('keeps field visibility and order while ignoring old column widths', () => {
    expect(
      hydrateFields({ table: { visible: ['due', 3, 'title'], widths: { due: 88 } }, kanban: { visible: 'tags' } })
    ).toEqual({ table: { visible: ['due', 'title'] } })
  })

  it('preserves old named views without exposing them to the project model', () => {
    const fm = {
      id: 'p1',
      savedViews: [
        {
          id: 'old',
          name: 'Old',
          group: { field: 'priority' },
          fields: { table: { visible: ['title'], widths: { due: 88 } } }
        }
      ]
    }
    const project = hydrateProjectFromFrontmatter(fm, '', 'Projects/P.md', 'P')
    expect(project).not.toHaveProperty('savedViews')
    const foreign = foreignFrontmatter(fm, PROJECT_FRONTMATTER_KEYS)
    const parsed = parseFrontmatter(serializeProject(project, [], refs, foreign))
    if (parsed.kind !== 'frontmatter') throw new Error('frontmatter missing')
    expect(parsed.frontmatter.savedViews).toEqual(fm.savedViews)
  })

  it('records taskIds in the frontmatter', () => {
    const p = makeProject('P', 'Projects/P.md')
    p.tasks = [makeTask({ id: 't-1' }), makeTask({ id: 't-2' })]
    const { frontmatter } = roundTripProject(p)
    expect(frontmatter.taskIds).toEqual(['t-1', 't-2'])
  })

  it('dedups taskIds and body links when project.tasks has the same task twice', () => {
    const p = makeProject('P', 'Projects/P.md')
    const task = makeTask({ id: 't-dup', title: 'Dup', filePath: 'Projects/P_tasks/dup-tdup.md' })
    p.tasks = [task, task]
    const md = serializeProject(p, [], refs)
    const parsed = parseFrontmatter(md)
    if (parsed.kind !== 'frontmatter') throw new Error('frontmatter missing')
    expect(parsed.frontmatter.taskIds).toEqual(['[[dup-tdup|Dup]]'])
    const bulletCount = md.split('\n').filter((l) => l.startsWith('- [ ] [[dup-tdup|')).length
    expect(bulletCount).toBe(1)
  })

  it('taskFilePath returns a bare-slug path without an id suffix', () => {
    expect(taskFilePath('Bug Fix', 'Projects/P_tasks')).toBe('Projects/P_tasks/bug-fix.md')
    expect(taskFilePath('A/B:C', 'Projects/P_tasks')).toBe('Projects/P_tasks/a-b-c.md')
  })

  it('falls back to the file basename when title is missing', () => {
    const project = hydrateProjectFromFrontmatter({}, '', 'Projects/Fallback.md', 'Fallback')
    expect(project.title).toBe('Fallback')
    expect(project.id).toBe('Fallback')
  })
})

// The store passes Obsidian's live frontmatter object straight into these hydrators, so
// sharing a container reference with the input would let an edit corrupt the cache.

describe('foreign frontmatter', () => {
  it('preserves removed recurrence and time tracking as foreign frontmatter', () => {
    const legacy = {
      recurrence: { interval: 'weekly', every: 2 },
      timeEstimate: 8,
      timeLogs: [{ date: '2026-04-01', hours: 2, note: 'setup' }]
    }
    const fm = { id: 'legacy-task', title: 'Legacy', ...legacy }
    const { task } = hydrateTaskFromFile(fm, '', 'Projects/P_tasks/legacy.md')
    for (const key of Object.keys(legacy)) expect(task).not.toHaveProperty(key)
    const foreign = foreignFrontmatter(fm, TASK_FRONTMATTER_KEYS)
    const parsed = parseFrontmatter(serializeTask(task, makeProject('P', 'Projects/P.md'), null, [], refs, foreign))
    if (parsed.kind !== 'frontmatter') throw new Error('frontmatter missing')
    expect(parsed.frontmatter).toMatchObject(legacy)
  })

  it('leaves removed task assignees in frontmatter without hydrating them', () => {
    const fm: Record<string, unknown> = {
      id: 'legacy-task',
      title: 'Legacy task',
      assignees: ['[[People/Ada]]']
    }
    const { task } = hydrateTaskFromFile(fm, '', 'Projects/P_tasks/legacy.md')
    expect(task).not.toHaveProperty('assignees')

    const foreign = foreignFrontmatter(fm, TASK_FRONTMATTER_KEYS)
    const parsed = parseFrontmatter(serializeTask(task, makeProject('P', 'Projects/P.md'), null, [], refs, foreign))
    if (parsed.kind !== 'frontmatter') throw new Error('frontmatter missing')
    expect(parsed.frontmatter.assignees).toEqual(['[[People/Ada]]'])
  })

  it('preserves old project parent metadata without hydrating a relationship', () => {
    const fm = { id: 'flat', title: 'Flat', parent: '[[Projects/Old parent]]' }
    const project = hydrateProjectFromFrontmatter(fm, '', 'Projects/Flat.md', 'Flat')
    expect(project).not.toHaveProperty('parentPath')
    const foreign = foreignFrontmatter(fm, PROJECT_FRONTMATTER_KEYS)
    const parsed = parseFrontmatter(serializeProject(project, [], refs, foreign))
    if (parsed.kind !== 'frontmatter') throw new Error('frontmatter missing')
    expect(parsed.frontmatter.parent).toBe('[[Projects/Old parent]]')
  })

  it('writes foreign keys after its own and reads them back unchanged', () => {
    const project = makeProject('P', 'Projects/P.md')
    const task = makeTask({ id: 't-1', title: 'Task', status: 'todo' })
    const foreign = {
      uuid: 'ext-42',
      timeEntries: [{ startTime: '2026-09-02T07:00:00', endTime: '2026-09-02T07:25:00' }]
    }

    const md = serializeTask(task, project, null, [], refs, foreign)
    const parsed = parseFrontmatter(md)
    if (parsed.kind !== 'frontmatter') throw new Error('frontmatter missing')
    const frontmatter = parsed.frontmatter

    expect(foreignFrontmatter(frontmatter, TASK_FRONTMATTER_KEYS)).toEqual(foreign)
    expect(Object.keys(frontmatter).indexOf('uuid')).toBeGreaterThan(Object.keys(frontmatter).indexOf('updatedAt'))
    expect(hydrateTaskFromFile(frontmatter, '', 'Projects/P_tasks/task.md').task.status).toBe('todo')
  })

  it('keeps only the keys the plugin does not own', () => {
    expect(foreignFrontmatter(null, TASK_FRONTMATTER_KEYS)).toEqual({})
    expect(foreignFrontmatter({ status: 'done', uuid: 'x', tasks: [] }, PROJECT_FRONTMATTER_KEYS)).toEqual({
      status: 'done',
      uuid: 'x'
    })
  })
})

describe('removed custom field metadata', () => {
  it('preserves legacy task values as inert foreign frontmatter', () => {
    const fm = { id: 'legacy', customFields: { client: 'Acme', score: 3 } }
    const { task } = hydrateTaskFromFile(fm, '', 'Projects/P_tasks/task.md')
    expect(task).not.toHaveProperty('customFields')
    const foreign = foreignFrontmatter(fm, TASK_FRONTMATTER_KEYS)
    const parsed = parseFrontmatter(serializeTask(task, makeProject('P', 'Projects/P.md'), null, [], refs, foreign))
    if (parsed.kind !== 'frontmatter') throw new Error('frontmatter missing')
    expect(parsed.frontmatter.customFields).toEqual(fm.customFields)
  })

  it('preserves legacy project definitions as inert foreign frontmatter', () => {
    const fm = { id: 'legacy', customFields: [{ id: 'client', name: 'Client', type: 'text' }] }
    const project = hydrateProjectFromFrontmatter(fm, '', 'Projects/P.md', 'P')
    expect(project).not.toHaveProperty('customFields')
    const foreign = foreignFrontmatter(fm, PROJECT_FRONTMATTER_KEYS)
    const parsed = parseFrontmatter(serializeProject(project, [], refs, foreign))
    if (parsed.kind !== 'frontmatter') throw new Error('frontmatter missing')
    expect(parsed.frontmatter.customFields).toEqual(fm.customFields)
  })
})

describe('legacy custom field view settings', () => {
  it('drops removed filters and columns while keeping built-in settings', () => {
    expect(
      hydrateFilter({
        conditions: [
          { field: 'cf:client', op: 'any', value: ['Acme'] },
          { field: 'status', op: 'any', value: ['next'] }
        ]
      }).conditions
    ).toEqual([{ field: 'status', op: 'any', value: ['next'] }])
    expect(
      hydrateFields({ table: { visible: ['title', 'cf:client', 'due'], widths: { 'cf:client': 180, due: 90 } } })
    ).toEqual({ table: { visible: ['title', 'due'] } })
  })
})

describe('serializer ownership', () => {
  it('owns every active key it writes', () => {
    const project = makeProject('P', 'Projects/P.md')
    const task = makeTask({ id: 'full', title: 'Full', completed: '2026-04-01' })
    expect(
      Object.keys(buildTaskFrontmatter(task, project, null, refs)).filter((key) => !TASK_FRONTMATTER_KEYS.has(key))
    ).toEqual([])
    const parsed = parseFrontmatter(serializeProject(project, [], refs))
    if (parsed.kind !== 'frontmatter') throw new Error('frontmatter missing')
    expect(Object.keys(parsed.frontmatter).filter((key) => !PROJECT_FRONTMATTER_KEYS.has(key))).toEqual([])
  })
})

describe('fixed priority compatibility', () => {
  it('loads and saves the former top priority under its new id', () => {
    const task = hydrateTaskFromFile({ priority: 'critical' }, '', 'Tasks/Old.md').task
    expect(task.priority).toBe('yesterday')
    expect(
      buildTaskFrontmatter(makeTask({ priority: 'critical' }), makeProject('P', 'P.md'), null, refs).priority
    ).toBe('yesterday')
  })

  it('keeps priority filters attached to the renamed value', () => {
    expect(
      hydrateFilter({ conditions: [{ field: 'priority', op: 'any', value: ['critical', 'high'] }] }).conditions
    ).toEqual([{ field: 'priority', op: 'any', value: ['yesterday', 'high'] }])
    expect(hydrateFilter({ priorities: ['critical'] }).conditions).toEqual([
      { field: 'priority', op: 'any', value: ['yesterday'] }
    ])
  })
})
