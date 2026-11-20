import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PRIORITIES,
  DEFAULT_SETTINGS,
  DEFAULT_STATUSES,
  makeProject,
  makeTask,
  type CustomFieldDef,
  type PMSettings,
  type PriorityConfig,
  type ProjectConfig
} from '../types'
import { resolveProjectConfig } from './ProjectConfig'

const CUSTOM_PRIORITIES: PriorityConfig[] = [
  { id: 'urgent', label: 'Urgent', color: '#f00', icon: '' },
  { id: 'later', label: 'Later', color: '#888', icon: '' }
]

function makeOverrideProject(config?: ProjectConfig) {
  const project = makeProject('P', 'Projects/P.md')
  project.config = config
  return project
}

describe('resolveProjectConfig', () => {
  it('inherits everything from the global settings when the project overrides nothing', () => {
    const resolved = resolveProjectConfig(makeOverrideProject(), DEFAULT_SETTINGS)
    expect(resolved.statuses).toEqual(DEFAULT_STATUSES)
    expect(resolved.priorities).toEqual(DEFAULT_PRIORITIES)
    expect(resolved.defaultView).toBe(DEFAULT_SETTINGS.defaultView)
    expect(resolved.priorityIcons).toBe(DEFAULT_SETTINGS.priorityIcons)
    expect(resolved.autoSchedule).toBe(DEFAULT_SETTINGS.autoSchedule)
    expect(resolved.pullForwardOnEarlyFinish).toBe(DEFAULT_SETTINGS.pullForwardOnEarlyFinish)
    expect(resolved.showSubtreeConnections).toBe(DEFAULT_SETTINGS.showSubtreeConnections)
    expect(resolved.lineBorders).toBe(DEFAULT_SETTINGS.lineBorders)
  })

  it('treats empty override lists as inherit', () => {
    const resolved = resolveProjectConfig(makeOverrideProject({ priorities: [] }), DEFAULT_SETTINGS)
    expect(resolved.statuses).toEqual(DEFAULT_STATUSES)
    expect(resolved.priorities).toEqual(DEFAULT_PRIORITIES)
  })

  it('keeps the fixed statuses while allowing project-defined priorities', () => {
    const resolved = resolveProjectConfig(makeOverrideProject({ priorities: CUSTOM_PRIORITIES }), DEFAULT_SETTINGS)
    expect(resolved.statuses).toEqual(DEFAULT_STATUSES)
    expect(resolved.priorities.map((p) => p.id)).toEqual(['urgent', 'later'])
  })

  it('overrides behavior settings independently of the palettes', () => {
    const resolved = resolveProjectConfig(
      makeOverrideProject({
        defaultView: 'kanban',
        priorityIcons: 'signal',
        autoSchedule: false,
        pullForwardOnEarlyFinish: true,
        showSubtreeConnections: false,
        lineBorders: 'both'
      }),
      DEFAULT_SETTINGS
    )
    expect(resolved.defaultView).toBe('kanban')
    expect(resolved.priorityIcons).toBe('signal')
    expect(resolved.autoSchedule).toBe(false)
    expect(resolved.pullForwardOnEarlyFinish).toBe(true)
    expect(resolved.showSubtreeConnections).toBe(false)
    expect(resolved.lineBorders).toBe('both')
    expect(resolved.statuses).toEqual(DEFAULT_STATUSES)
  })

  it('does not add unknown task statuses to the fixed options', () => {
    const project = makeOverrideProject()
    project.tasks.push(makeTask({ status: 'done' }))
    const resolved = resolveProjectConfig(project, DEFAULT_SETTINGS)
    expect(resolved.statuses).toEqual(DEFAULT_STATUSES)
  })

  it('borrows the global config for in-use priorities the project does not define', () => {
    const project = makeOverrideProject({ priorities: CUSTOM_PRIORITIES })
    project.tasks.push(makeTask({ priority: 'high' }))
    const resolved = resolveProjectConfig(project, DEFAULT_SETTINGS)
    expect(resolved.priorities.map((p) => p.id)).toEqual(['urgent', 'later', 'high'])
  })

  it('keeps unknown task statuses out while preserving unknown priorities', () => {
    const project = makeOverrideProject()
    const parent = makeTask({ status: 'todo' })
    parent.subtasks.push(makeTask({ status: 'mystery', priority: 'whenever' }))
    project.tasks.push(parent)
    const resolved = resolveProjectConfig(project, DEFAULT_SETTINGS)
    expect(resolved.statuses.some((s) => s.id === 'mystery')).toBe(false)
    expect(resolved.priorities.find((p) => p.id === 'whenever')).toEqual({
      id: 'whenever',
      label: 'whenever',
      color: '#8a94a0',
      icon: ''
    })
  })
})

const GLOBAL_OWNER_FIELD: CustomFieldDef = { id: 'cf-owner', name: 'Owner', type: 'text' }
const PROJECT_FIELD: CustomFieldDef = { id: 'cf-sprint', name: 'Sprint', type: 'text' }

function withVaultFields(...customFields: CustomFieldDef[]): PMSettings {
  return { ...DEFAULT_SETTINGS, customFields }
}

describe('resolveProjectConfig custom fields', () => {
  it('is only the project own fields when nothing above it defines any', () => {
    const project = makeOverrideProject()
    project.customFields.push(PROJECT_FIELD)
    expect(resolveProjectConfig(project, DEFAULT_SETTINGS).customFields).toEqual([PROJECT_FIELD])
  })

  it('lets the project override a global field without moving it', () => {
    const project = makeOverrideProject()
    const renamed: CustomFieldDef = { ...GLOBAL_OWNER_FIELD, name: 'Accountable' }
    project.customFields.push(PROJECT_FIELD, renamed)
    const resolved = resolveProjectConfig(project, withVaultFields(GLOBAL_OWNER_FIELD))
    expect(resolved.customFields).toEqual([renamed, PROJECT_FIELD])
  })

  it('leaves out a global field the project hides', () => {
    const project = makeOverrideProject({ hiddenCustomFields: [GLOBAL_OWNER_FIELD.id] })
    const resolved = resolveProjectConfig(project, withVaultFields(GLOBAL_OWNER_FIELD, PROJECT_FIELD))
    expect(resolved.customFields).toEqual([PROJECT_FIELD])
  })

  it('keeps a hidden field the project also declares itself', () => {
    const project = makeOverrideProject({ hiddenCustomFields: [GLOBAL_OWNER_FIELD.id] })
    project.customFields.push(GLOBAL_OWNER_FIELD)
    expect(resolveProjectConfig(project, withVaultFields(GLOBAL_OWNER_FIELD)).customFields).toEqual([
      GLOBAL_OWNER_FIELD
    ])
  })
})
