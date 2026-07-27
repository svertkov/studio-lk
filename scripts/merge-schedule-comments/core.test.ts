import { describe, it, expect } from 'vitest'
import { planRow, summarizePlan, type SourceRow, type Plan } from './core'

function makeRow(overrides: Partial<SourceRow>): SourceRow {
  return { id: 'e1', description: null, notes: null, ...overrides }
}

describe('planRow', () => {
  it('copies description into notes when notes is empty', () => {
    const plan = planRow(makeRow({ description: 'Съёмка интервью, 2 камеры' }))
    expect(plan.action).toBe('set_from_description')
    expect(plan.proposedNotes).toBe('Съёмка интервью, 2 камеры')
    expect(plan.skipReason).toBeNull()
  })

  it('leaves notes untouched when description is empty', () => {
    const plan = planRow(makeRow({ notes: 'Клиент попросил свет потеплее' }))
    expect(plan.action).toBe('skip')
    expect(plan.skipReason).toBe('no_description')
    expect(plan.proposedNotes).toBe('Клиент попросил свет потеплее')
  })

  it('does nothing when both are empty', () => {
    const plan = planRow(makeRow({}))
    expect(plan.action).toBe('skip')
    expect(plan.skipReason).toBe('no_description')
  })

  it('skips when notes and description are identical (nothing to merge)', () => {
    const plan = planRow(makeRow({ description: 'Одно и то же', notes: 'Одно и то же' }))
    expect(plan.action).toBe('skip')
    expect(plan.skipReason).toBe('identical')
  })

  it('skips when description text is already contained in notes — idempotent re-run', () => {
    const plan = planRow(makeRow({ description: 'Съёмка интервью', notes: 'Ранее было сказано\n\nСъёмка интервью' }))
    expect(plan.action).toBe('skip')
    expect(plan.skipReason).toBe('already_merged')
  })

  it('appends description with a blank-line separator when both are filled and differ', () => {
    const plan = planRow(makeRow({ description: 'Съёмка интервью', notes: 'Клиент попросил свет потеплее' }))
    expect(plan.action).toBe('append_description')
    expect(plan.proposedNotes).toBe('Клиент попросил свет потеплее\n\nСъёмка интервью')
  })

  it('trims whitespace-only values as if empty', () => {
    const plan = planRow(makeRow({ description: '   ', notes: 'Реальный комментарий' }))
    expect(plan.action).toBe('skip')
    expect(plan.skipReason).toBe('no_description')
  })

  it('a second run against the already-merged result is a no-op (idempotency)', () => {
    const first = planRow(makeRow({ description: 'Съёмка интервью', notes: 'Клиент попросил свет потеплее' }))
    const second = planRow(makeRow({ description: 'Съёмка интервью', notes: first.proposedNotes }))
    expect(second.action).toBe('skip')
  })
})

describe('summarizePlan', () => {
  function makePlan(rows: SourceRow[]): Plan {
    return { totalRows: rows.length, rows: rows.map(planRow) }
  }

  it('counts totals and each outcome correctly', () => {
    const plan = makePlan([
      makeRow({ id: 'a', description: 'X' }),
      makeRow({ id: 'b', description: 'Y', notes: 'Z' }),
      makeRow({ id: 'c', notes: 'уже есть комментарий' }),
      makeRow({ id: 'd', description: 'W', notes: 'W' }),
    ])
    const summary = summarizePlan(plan)
    expect(summary.totalRows).toBe(4)
    expect(summary.setFromDescription).toBe(1)
    expect(summary.appendDescription).toBe(1)
    expect(summary.skippedNoDescription).toBe(1)
    expect(summary.skippedIdentical).toBe(1)
  })
})
