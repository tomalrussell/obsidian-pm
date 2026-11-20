import { describe, expect, it } from 'vitest'
import { DEFAULT_PRIORITIES, DEFAULT_SETTINGS, DEFAULT_STATUSES, makeProject, makeTask } from '../types'
import { resolveProjectConfig } from './ProjectConfig'

describe('resolveProjectConfig', () => {
  it('uses fixed options even when saved settings and tasks contain other priorities', () => {
    const project = makeProject('P', 'Projects/P.md')
    project.tasks.push(makeTask({ priority: 'urgent', status: 'mystery' }))
    const resolved = resolveProjectConfig(project, {
      ...DEFAULT_SETTINGS,
      priorities: [{ id: 'urgent', label: 'Urgent', color: '#f00', icon: 'alert' }],
      priorityIcons: 'signal'
    })
    expect(resolved.statuses).toEqual(DEFAULT_STATUSES)
    expect(resolved.priorities).toEqual(DEFAULT_PRIORITIES)
    expect(resolved.priorityIcons).toBe('chevrons')
  })

  it('uses global behavior settings when the project has no overrides', () => {
    const resolved = resolveProjectConfig(makeProject('P', 'Projects/P.md'), DEFAULT_SETTINGS)
    expect(resolved.defaultView).toBe(DEFAULT_SETTINGS.defaultView)
    expect(resolved.showSubtreeConnections).toBe(DEFAULT_SETTINGS.showSubtreeConnections)
    expect(resolved.lineBorders).toBe(DEFAULT_SETTINGS.lineBorders)
  })

  it('overrides behavior settings independently of the fixed options', () => {
    const project = makeProject('P', 'Projects/P.md')
    project.config = {
      defaultView: 'kanban',
      showSubtreeConnections: false,
      lineBorders: 'both'
    }
    const resolved = resolveProjectConfig(project, DEFAULT_SETTINGS)
    expect(resolved.defaultView).toBe('kanban')
    expect(resolved.showSubtreeConnections).toBe(false)
    expect(resolved.lineBorders).toBe('both')
    expect(resolved.priorities).toEqual(DEFAULT_PRIORITIES)
  })
})
