import { describe, it, expect } from 'vitest'
import { planRow, summarizePlan, type SourceRow, type Plan } from './core'

function makeRow(overrides: Partial<SourceRow>): SourceRow {
  return {
    id: 'p1', title: 'Монтаж подкаста от 07.10.2025', description: null, status: 'DELIVERED',
    contentType: null, customContentType: null,
    deadlineType: null, deadlineDate: null, turnaroundDayType: null,
    completedAt: null, deliveredAt: null,
    ...overrides,
  }
}

describe('planRow — типа контента', () => {
  it('classifies a row with contentType IS NULL from its title', () => {
    const plan = planRow(makeRow({ contentType: null }))
    expect(plan.needsContentType).toBe(true)
    expect(plan.proposedContentType).toBe('PODCAST')
    expect(plan.proposedCustomContentType).toBeNull()
    expect(plan.action).toBe('update')
  })

  it('leaves an already-classified row untouched (idempotent)', () => {
    const plan = planRow(makeRow({ contentType: 'PODCAST', title: 'что угодно теперь' }))
    expect(plan.needsContentType).toBe(false)
    expect(plan.proposedContentType).toBe('PODCAST')
    expect(plan.action).toBe('skip')
  })

  it('falls back to description when title is empty', () => {
    const plan = planRow(makeRow({ title: null, description: 'Монтаж рилса' }))
    expect(plan.proposedContentType).toBe('SHORT_FORM')
  })

  it('unclassifiable titles go to OTHER with the original text preserved, not lost', () => {
    const plan = planRow(makeRow({ title: 'Монтаж 2 роликов + осьминог' }))
    expect(plan.proposedContentType).toBe('OTHER')
    expect(plan.proposedCustomContentType).toBe('Монтаж 2 роликов + осьминог')
  })

  it('preserves existing customContentType for rows that do not need reclassification', () => {
    const plan = planRow(makeRow({ contentType: 'OTHER', customContentType: 'Ручное уточнение' }))
    expect(plan.needsContentType).toBe(false)
    expect(plan.proposedCustomContentType).toBe('Ручное уточнение')
  })
})

describe('planRow — тип дней срока', () => {
  it('flags DURATION_DAYS rows with no turnaroundDayType for CALENDAR backfill', () => {
    const plan = planRow(makeRow({ contentType: 'PODCAST', deadlineType: 'DURATION_DAYS', turnaroundDayType: null }))
    expect(plan.needsTurnaroundDayType).toBe(true)
    expect(plan.action).toBe('update')
  })

  it('does not touch rows that already have a turnaroundDayType', () => {
    const plan = planRow(makeRow({ contentType: 'PODCAST', deadlineType: 'DURATION_DAYS', turnaroundDayType: 'BUSINESS' }))
    expect(plan.needsTurnaroundDayType).toBe(false)
  })

  it('does not touch FIXED_DATE rows even without a turnaroundDayType (field is meaningless for them)', () => {
    const plan = planRow(makeRow({ contentType: 'PODCAST', deadlineType: 'FIXED_DATE', turnaroundDayType: null }))
    expect(plan.needsTurnaroundDayType).toBe(false)
  })

  it('a row can need both updates at once', () => {
    const plan = planRow(makeRow({ contentType: null, deadlineType: 'DURATION_DAYS', turnaroundDayType: null }))
    expect(plan.needsContentType).toBe(true)
    expect(plan.needsTurnaroundDayType).toBe(true)
    expect(plan.action).toBe('update')
  })
})

describe('planRow — информационные флаги отчёта', () => {
  it('flags rows with no deadline at all', () => {
    expect(planRow(makeRow({ contentType: 'PODCAST', deadlineDate: null })).hasDeadline).toBe(false)
    expect(planRow(makeRow({ contentType: 'PODCAST', deadlineDate: new Date('2026-01-01') })).hasDeadline).toBe(true)
  })

  it('flags rows where both completedAt and deliveredAt are set (informational only)', () => {
    const plan = planRow(makeRow({
      contentType: 'PODCAST', completedAt: new Date('2026-01-01'), deliveredAt: new Date('2026-01-02'),
    }))
    expect(plan.hasBothCompletionDates).toBe(true)
    // Информационный флаг НЕ влияет на action — это не то, что apply.ts меняет.
    expect(plan.action).toBe('skip')
  })
})

describe('summarizePlan', () => {
  function makePlan(rows: SourceRow[]): Plan {
    const statusCounts: Record<string, number> = {}
    for (const r of rows) statusCounts[r.status] = (statusCounts[r.status] ?? 0) + 1
    return { totalRows: rows.length, rows: rows.map(planRow), statusCounts }
  }

  it('counts totals, updates and skips correctly', () => {
    const plan = makePlan([
      makeRow({ id: 'a', contentType: null, title: 'Монтаж подкаста' }),
      makeRow({ id: 'b', contentType: 'PODCAST' }),
      makeRow({ id: 'c', contentType: null, title: 'Монтаж рилса' }),
    ])
    const summary = summarizePlan(plan)
    expect(summary.totalRows).toBe(3)
    expect(summary.toUpdate).toBe(2)
    expect(summary.alreadyDone).toBe(1)
    expect(summary.toUpdateContentType).toBe(2)
    expect(summary.contentTypeCounts.PODCAST).toBe(1)
    expect(summary.contentTypeCounts.SHORT_FORM).toBe(1)
  })

  it('reports status distribution verbatim (no remapping — enum already shrunk safely)', () => {
    const plan = makePlan([
      makeRow({ id: 'a', status: 'DELIVERED' }),
      makeRow({ id: 'b', status: 'DELIVERED' }),
      makeRow({ id: 'c', status: 'IN_PROGRESS' }),
    ])
    expect(summarizePlan(plan).statusCounts).toEqual({ DELIVERED: 2, IN_PROGRESS: 1 })
  })

  it('reports missing-deadline and both-completion-dates counts', () => {
    const plan = makePlan([
      makeRow({ id: 'a', contentType: 'PODCAST', deadlineDate: null }),
      makeRow({ id: 'b', contentType: 'PODCAST', deadlineDate: new Date(), completedAt: new Date(), deliveredAt: new Date() }),
    ])
    const summary = summarizePlan(plan)
    expect(summary.missingDeadlineCount).toBe(1)
    expect(summary.bothCompletionDatesCount).toBe(1)
  })
})
