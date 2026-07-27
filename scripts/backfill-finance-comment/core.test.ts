import { describe, it, expect } from 'vitest'
import { planRow, summarizePlan, type SourceRow, type Plan } from './core'

function makeRow(overrides: Partial<SourceRow>): SourceRow {
  return { id: 'o1', netProfitOverrideReason: null, financeComment: null, ...overrides }
}

describe('planRow', () => {
  it('copies reason into financeComment when comment is empty', () => {
    const plan = planRow(makeRow({ netProfitOverrideReason: 'Налог 9%, затраты на монтаж' }))
    expect(plan.action).toBe('copy_reason')
    expect(plan.proposedFinanceComment).toBe('Налог 9%, затраты на монтаж')
  })

  it('skips when reason is empty', () => {
    const plan = planRow(makeRow({}))
    expect(plan.action).toBe('skip')
    expect(plan.skipReason).toBe('no_reason')
  })

  it('skips when financeComment is already filled — no overwrite', () => {
    const plan = planRow(makeRow({ netProfitOverrideReason: 'Старая причина', financeComment: 'Уже заполнено вручную' }))
    expect(plan.action).toBe('skip')
    expect(plan.skipReason).toBe('comment_already_filled')
  })

  it('a second run against the already-migrated result is a no-op (idempotency)', () => {
    const first = planRow(makeRow({ netProfitOverrideReason: 'Причина' }))
    const second = planRow(makeRow({ netProfitOverrideReason: 'Причина', financeComment: first.proposedFinanceComment }))
    expect(second.action).toBe('skip')
  })
})

describe('summarizePlan', () => {
  it('counts totals and outcomes', () => {
    const plan: Plan = {
      totalRows: 3,
      rows: [
        planRow(makeRow({ id: 'a', netProfitOverrideReason: 'X' })),
        planRow(makeRow({ id: 'b' })),
        planRow(makeRow({ id: 'c', netProfitOverrideReason: 'Y', financeComment: 'Z' })),
      ],
    }
    const summary = summarizePlan(plan)
    expect(summary.toCopy).toBe(1)
    expect(summary.skippedNoReason).toBe(1)
    expect(summary.skippedAlreadyFilled).toBe(1)
  })
})
