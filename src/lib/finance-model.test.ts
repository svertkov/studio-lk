import { describe, it, expect } from 'vitest'
import { computeCombinedFinanceSummary } from '@/lib/finance-model'
import type { MontageDashboardStats } from '@/lib/montage-model'

function makeMontageStats(overrides: Partial<MontageDashboardStats> = {}): MontageDashboardStats {
  return {
    deliveredCount: 0, reportingSince: null, revenueTotal: 0, revenuePaid: 0,
    expensesTotal: 0, expensesPaid: 0, profit: 0, margin: null,
    activeCount: 0, attentionCount: 0, clientDebt: 0, studioDebt: 0,
    ...overrides,
  }
}

const EMPTY_MONTAGE = makeMontageStats()

describe('computeCombinedFinanceSummary — единая сборка "Финансов" из визитов/расходов/монтажа', () => {
  it('with zero montage projects, matches the pre-existing visits-only calculation exactly (regression safety)', () => {
    const combined = computeCombinedFinanceSummary(
      { grossTotal: 100000 },
      { actualTotal: 30000, plannedTotal: 40000, remainingTotal: 10000 },
      EMPTY_MONTAGE,
    )
    expect(combined.totalRevenue).toBe(100000)
    expect(combined.actualExpensesTotal).toBe(30000)
    expect(combined.plannedExpensesTotal).toBe(40000)
    expect(combined.outstandingTotal).toBe(10000)
    expect(combined.netProfit).toBe(70000)
    expect(combined.projectedProfit).toBe(60000)
  })

  it('a separate montage project increases total revenue by its clientAmount (accrual)', () => {
    const combined = computeCombinedFinanceSummary(
      { grossTotal: 100000 },
      { actualTotal: 0, plannedTotal: 0, remainingTotal: 0 },
      makeMontageStats({ revenueTotal: 19000 }),
    )
    expect(combined.totalRevenue).toBe(119000)
    expect(combined.shootsRevenue).toBe(100000)
    expect(combined.montageRevenue).toBe(19000)
  })

  it('a PAID editor payout counts in actualExpensesTotal, not in outstandingTotal', () => {
    const combined = computeCombinedFinanceSummary(
      { grossTotal: 0 },
      { actualTotal: 0, plannedTotal: 0, remainingTotal: 0 },
      makeMontageStats({ expensesTotal: 16000, expensesPaid: 16000, studioDebt: 0 }),
    )
    expect(combined.actualExpensesTotal).toBe(16000)
    expect(combined.outstandingTotal).toBe(0)
    expect(combined.plannedExpensesTotal).toBe(16000)
  })

  it('a PENDING/PARTIALLY_PAID editor payout counts in outstandingTotal, not in actualExpensesTotal', () => {
    const combined = computeCombinedFinanceSummary(
      { grossTotal: 0 },
      { actualTotal: 0, plannedTotal: 0, remainingTotal: 0 },
      makeMontageStats({ expensesTotal: 12000, expensesPaid: 0, studioDebt: 12000 }),
    )
    expect(combined.actualExpensesTotal).toBe(0)
    expect(combined.outstandingTotal).toBe(12000)
    expect(combined.plannedExpensesTotal).toBe(12000)
  })

  it('net profit uses accrued revenue minus actually-paid expenses (same hybrid convention as before montage)', () => {
    const combined = computeCombinedFinanceSummary(
      { grossTotal: 100000 },
      { actualTotal: 30000, plannedTotal: 30000, remainingTotal: 0 },
      makeMontageStats({ revenueTotal: 20000, expensesTotal: 16000, expensesPaid: 10000, studioDebt: 6000 }),
    )
    // totalRevenue = 120000 (accrued), actualExpensesTotal = 30000 + 10000 (paid only) = 40000
    expect(combined.netProfit).toBe(80000)
    // projectedProfit = 120000 - (30000 + 16000 accrued) = 74000
    expect(combined.projectedProfit).toBe(74000)
  })

  it('margin is null when total revenue is zero, otherwise netProfit / totalRevenue', () => {
    const zero = computeCombinedFinanceSummary({ grossTotal: 0 }, { actualTotal: 0, plannedTotal: 0, remainingTotal: 0 }, EMPTY_MONTAGE)
    expect(zero.margin).toBeNull()

    const withRevenue = computeCombinedFinanceSummary(
      { grossTotal: 0 },
      { actualTotal: 0, plannedTotal: 0, remainingTotal: 0 },
      makeMontageStats({ revenueTotal: 10000, expensesTotal: 4000, expensesPaid: 4000 }),
    )
    expect(withRevenue.margin).toBeCloseTo(6000 / 10000)
  })

  it('passes through montageReportingSince unchanged (single source, not recomputed)', () => {
    const combined = computeCombinedFinanceSummary(
      { grossTotal: 0 },
      { actualTotal: 0, plannedTotal: 0, remainingTotal: 0 },
      makeMontageStats({ reportingSince: '2025-09-23T00:00:00.000Z' }),
    )
    expect(combined.montageReportingSince).toBe('2025-09-23T00:00:00.000Z')
  })
})
