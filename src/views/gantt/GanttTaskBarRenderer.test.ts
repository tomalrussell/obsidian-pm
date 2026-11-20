// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_STATUSES, makeProject, makeTask, type Task } from '@dotpm/core'
import { buildTimelineConfig, svgEl } from '@dotpm/ui'
import { openTaskModal } from '#ui/ModalFactory'
import { makeLinkState } from './GanttLinkHandler'
import { makeDragState } from './GanttDragHandler'
import { renderDependencyArrows, renderTaskBar } from './GanttTaskBarRenderer'
import type { RendererContext } from './GanttRenderer'

vi.mock('#ui/ModalFactory', () => ({ openTaskModal: vi.fn<typeof openTaskModal>() }))

function setup() {
  const predecessor = makeTask({ id: 'work', start: '2026-11-20', due: '2026-11-21' })
  const milestone = makeTask({ id: 'checkpoint', type: 'milestone', start: '', due: '2026-11-22' })
  const tasks = [predecessor, milestone]
  const project = makeProject('Project', 'Project.md')
  const svgElRoot = svgEl('svg', {})
  activeDocument.body.appendChild(svgElRoot)
  const onRefresh = vi.fn<() => Promise<void>>(async () => undefined)
  const updateTask = vi.fn<(_project: unknown, id: string, patch: Partial<Task>) => Promise<void>>(
    async (_project, id, patch) => {
      const task = tasks.find((entry) => entry.id === id)
      if (!task) throw new Error('Missing task')
      Object.assign(task, patch)
    }
  )
  const scheduleAfterChange = vi.fn<() => Promise<number>>(async () => 0)
  const ctx = {
    svgEl: svgElRoot,
    headerSvgEl: svgEl('svg', {}),
    cfg: buildTimelineConfig(tasks, 'day'),
    statuses: DEFAULT_STATUSES,
    scope: {
      projectOf: () => project,
      taskById: (id: string) => tasks.find((task) => task.id === id)
    },
    plugin: { store: { updateTask, scheduleAfterChange }, index: { wouldCreateCycle: () => false } },
    link: makeLinkState(),
    drag: makeDragState(),
    labelFields: [],
    labelSource: {},
    flatTasks: tasks.map((task) => ({ task, depth: 0, visible: true })),
    cleanupFns: [],
    onRefresh
  } as unknown as RendererContext
  const groups = tasks.map((task, row) => {
    const group = svgEl('g', {})
    svgElRoot.appendChild(group)
    renderTaskBar(group, task, row, 0, ctx)
    return group
  })
  return { ctx, groups, milestone, project, updateTask, scheduleAfterChange, onRefresh }
}

for (const milestoneFirst of [false, true]) {
  it(`links a task to a milestone with the ${milestoneFirst ? 'milestone' : 'task'} selected first`, async () => {
    const { ctx, groups, milestone, project, updateTask, scheduleAfterChange, onRefresh } = setup()
    vi.mocked(openTaskModal).mockClear()
    const taskDots = groups[0].querySelectorAll('.pm-gantt-link-dot')
    const milestoneDots = groups[1].querySelectorAll('.pm-gantt-link-dot')
    expect(milestoneDots.length).toBe(1)
    const endpoints = [taskDots[1], milestoneDots[0]]
    if (milestoneFirst) endpoints.reverse()
    endpoints.forEach((dot) => dot.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    await vi.waitFor(() => expect(onRefresh).toHaveBeenCalledOnce())
    expect(updateTask).toHaveBeenCalledWith(project, milestone.id, { dependencies: ['work'] })
    expect(scheduleAfterChange).toHaveBeenCalledWith(project, milestone.id)
    expect(milestone.dependencies).toEqual(['work'])
    renderDependencyArrows(ctx)
    const arrows = ctx.svgEl.querySelectorAll('.pm-gantt-arrow')
    expect(arrows.length).toBe(1)
    const leftTip = groups[1]
      .querySelector('.pm-gantt-milestone')
      ?.getAttribute('points')
      ?.split(' ')
      .at(-1)
      ?.replace(',', ' ')
    expect(leftTip).toBeDefined()
    expect(arrows[0].getAttribute('d')?.endsWith(leftTip ?? '')).toBe(true)
    expect(openTaskModal).not.toHaveBeenCalled()
    ctx.cleanupFns.forEach((cleanup) => cleanup())
  })
}

describe('milestone diamond', () => {
  it('still opens its editor when the diamond itself is clicked', () => {
    const { groups, milestone, ctx } = setup()
    vi.mocked(openTaskModal).mockClear()
    const diamond = groups[1].querySelector('.pm-gantt-milestone')
    if (!diamond) throw new Error('Missing milestone diamond')
    diamond.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(openTaskModal).toHaveBeenCalledWith(
      ctx.plugin,
      expect.anything(),
      expect.objectContaining({ task: milestone })
    )
    ctx.cleanupFns.forEach((cleanup) => cleanup())
  })
})
