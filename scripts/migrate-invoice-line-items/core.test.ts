import { describe, it, expect } from 'vitest'
import { planRow, summarizePlan, FALLBACK_DESCRIPTION, type SourceRow, type Plan } from './core'

function makeRow(overrides: Partial<SourceRow>): SourceRow {
  return { id: 'd1', amount: 15000, serviceDescription: 'Видеосъёмка мероприятия', lineItemsCount: 0, ...overrides }
}

describe('planRow', () => {
  it('proposes a single line item from the existing serviceDescription and amount', () => {
    const plan = planRow(makeRow({}))
    expect(plan.action).toBe('create')
    expect(plan.proposedDescription).toBe('Видеосъёмка мероприятия')
    expect(plan.skipReason).toBeNull()
  })

  it('falls back to a generic description when serviceDescription is empty', () => {
    const plan = planRow(makeRow({ serviceDescription: null }))
    expect(plan.proposedDescription).toBe(FALLBACK_DESCRIPTION)
  })

  it('falls back to a generic description when serviceDescription is blank whitespace', () => {
    const plan = planRow(makeRow({ serviceDescription: '   ' }))
    expect(plan.proposedDescription).toBe(FALLBACK_DESCRIPTION)
  })

  it('skips invoices that already have line items (idempotent — no double migration)', () => {
    const plan = planRow(makeRow({ lineItemsCount: 2 }))
    expect(plan.action).toBe('skip')
    expect(plan.skipReason).toBe('has_line_items')
  })

  it('skips invoices with no amount — nothing meaningful to migrate', () => {
    const plan = planRow(makeRow({ amount: null }))
    expect(plan.action).toBe('skip')
    expect(plan.skipReason).toBe('no_amount')
  })

  it('an invoice that already has line items is skipped for that reason even if amount is also missing', () => {
    const plan = planRow(makeRow({ lineItemsCount: 1, amount: null }))
    expect(plan.skipReason).toBe('has_line_items')
  })
})

describe('summarizePlan', () => {
  function makePlan(rows: SourceRow[]): Plan {
    return { totalRows: rows.length, rows: rows.map(planRow) }
  }

  it('counts totals, creations and skip reasons correctly', () => {
    const plan = makePlan([
      makeRow({ id: 'a' }),
      makeRow({ id: 'b', lineItemsCount: 3 }),
      makeRow({ id: 'c', amount: null }),
    ])
    const summary = summarizePlan(plan)
    expect(summary.totalRows).toBe(3)
    expect(summary.toCreate).toBe(1)
    expect(summary.alreadyHasLineItems).toBe(1)
    expect(summary.noAmount).toBe(1)
  })
})
