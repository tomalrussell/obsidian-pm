import { describe, it, expect } from 'vitest'
import { makeTask, Temporal } from '@dotpm/core'
import {
  isWeekend,
  buildTimelineConfig,
  clampZoom,
  dateToX,
  getSnapPoints,
  stepZoom,
  xToDate,
  xToLastDate
} from './TimelineConfig'

const tasks = [makeTask({ start: '2026-03-10', due: '2026-04-20' })]

describe('buildTimelineConfig', () => {
  it('spans at least three years at year granularity', () => {
    const cfg = buildTimelineConfig(tasks, 'year')
    expect(cfg.totalDays).toBeGreaterThanOrEqual(1095)
  })

  it('starts a year timeline on the first of a month', () => {
    const cfg = buildTimelineConfig(tasks, 'year')
    expect(cfg.startDate.day).toBe(1)
  })

  it('runs on past the tasks until the shown days fill the minimum width', () => {
    const minWidth = 20000
    const cfg = buildTimelineConfig(tasks, 'year', { zoom: 50, isHidden: isWeekend, minWidth })
    expect(cfg.totalWidth).toBeGreaterThanOrEqual(minWidth)
    expect(cfg.totalWidth - cfg.dayWidth).toBeLessThan(minWidth)
    expect(cfg.endDate.since(cfg.startDate, { largestUnit: 'days' }).days).toBe(cfg.totalDays)
  })

  it('gives a year column less width than a quarter column', () => {
    expect(buildTimelineConfig(tasks, 'year').dayWidth).toBeLessThan(buildTimelineConfig(tasks, 'quarter').dayWidth)
  })
})

describe('getSnapPoints', () => {
  it('snaps to month starts at year granularity', () => {
    const cfg = buildTimelineConfig(tasks, 'year')
    const points = getSnapPoints(cfg)
    const march = Temporal.PlainDate.from('2026-03-01')
    expect(points).toContain(dateToX(cfg, march))
    expect(points).not.toContain(dateToX(cfg, march.add({ days: 1 })))
  })
})

describe('zoom', () => {
  it('scales the day width within limits', () => {
    const base = buildTimelineConfig(tasks, 'week').dayWidth
    expect(buildTimelineConfig(tasks, 'week', { zoom: 200 }).dayWidth).toBe(base * 2)
    expect(buildTimelineConfig(tasks, 'week', { zoom: 1000 }).dayWidth).toBe(base * 4)
    expect(buildTimelineConfig(tasks, 'week', { zoom: 10 }).dayWidth).toBe(base / 2)
  })

  it('steps through the stops and stops at either end', () => {
    expect(stepZoom(100, 1)).toBe(110)
    expect(stepZoom(105, -1)).toBe(100)
    expect(stepZoom(400, 1)).toBe(400)
    expect(stepZoom(50, -1)).toBe(50)
    expect(clampZoom(123.6)).toBe(124)
  })
})

describe('hidden weekends', () => {
  const week = [makeTask({ start: '2026-03-02', due: '2026-03-13' })]
  const cfg = buildTimelineConfig(week, 'day', { isHidden: isWeekend })
  const date = (iso: string) => Temporal.PlainDate.from(iso)

  it('gives hidden days no width', () => {
    const friday = dateToX(cfg, date('2026-03-06'))
    expect(dateToX(cfg, date('2026-03-07'))).toBe(friday + cfg.dayWidth)
    expect(dateToX(cfg, date('2026-03-09'))).toBe(friday + cfg.dayWidth)
    expect(cfg.totalWidth).toBeLessThan(cfg.totalDays * cfg.dayWidth)
  })

  it('reads a column edge back as the shown day on either side of it', () => {
    const monday = dateToX(cfg, date('2026-03-09'))
    expect(xToDate(cfg, monday).toString()).toBe('2026-03-09')
    expect(xToLastDate(cfg, monday).toString()).toBe('2026-03-06')
  })
})
