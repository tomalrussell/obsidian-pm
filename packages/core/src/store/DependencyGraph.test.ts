import { describe, expect, it } from 'vitest'
import { makeTask, type Task } from '../types'
import { wouldCreateCycle } from './DependencyGraph'

function task(overrides: Partial<Task> & { id: string }): Task {
  return makeTask(overrides)
}

describe('wouldCreateCycle', () => {
  it('returns false for disjoint tasks', () => {
    const tasks = [task({ id: 'a' }), task({ id: 'b' })]
    expect(wouldCreateCycle(tasks, 'a', 'b')).toBe(false)
  })

  it('returns true when from can already reach to via dependents', () => {
    // b depends on a, so adding "a depends on b" closes the cycle.
    const tasks = [task({ id: 'a' }), task({ id: 'b', dependencies: ['a'] })]
    expect(wouldCreateCycle(tasks, 'a', 'b')).toBe(true)
  })

  it('detects transitive cycles', () => {
    const tasks = [task({ id: 'a' }), task({ id: 'b', dependencies: ['a'] }), task({ id: 'c', dependencies: ['b'] })]
    expect(wouldCreateCycle(tasks, 'a', 'c')).toBe(true)
  })

  it('returns false for a valid chain extension', () => {
    const tasks = [task({ id: 'a' }), task({ id: 'b', dependencies: ['a'] }), task({ id: 'c' })]
    // Adding "c depends on b" does not cycle.
    expect(wouldCreateCycle(tasks, 'c', 'b')).toBe(false)
  })

  it('traverses into subtasks', () => {
    const child = task({ id: 'child', dependencies: ['root'] })
    const tasks = [task({ id: 'root', subtasks: [child] })]
    expect(wouldCreateCycle(tasks, 'root', 'child')).toBe(true)
  })
})
