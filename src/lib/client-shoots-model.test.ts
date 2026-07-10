import { describe, it, expect } from 'vitest'
import {
  mergeShoots, computeShootsSummary, computeFinanceOverview, categorizeShootAmount,
  type ShootVisitInput, type ShootEventInput, type ShootRow,
} from './client-shoots-model'

const NOW = new Date('2026-07-10T12:00:00Z')

function visit(overrides: Partial<ShootVisitInput> = {}): ShootVisitInput {
  return {
    id: 'v1', date: new Date('2026-06-01T00:00:00Z'), room: 'Светлый зал', format: 'Подкаст',
    durationHours: 2, grossAmount: 10000, netAmount: 9000, comment: null,
    ...overrides,
  }
}

function event(overrides: Partial<ShootEventInput> = {}): ShootEventInput {
  return {
    id: 'e1', calendarEventId: 'cal1',
    startAt: new Date('2026-06-01T10:00:00Z'), endAt: new Date('2026-06-01T12:00:00Z'),
    room: 'Светлый зал', format: 'Подкаст', estimatedPrice: 12000, paymentMethod: 'CASH',
    yandexDiskUrl: null, notes: null, subscriptionUsedHours: null, orderStatus: null,
    ...overrides,
  }
}

describe('categorizeShootAmount', () => {
  it('marks subscription-paid shoots without an amount', () => {
    const r = categorizeShootAmount({
      hasSubscriptionUsage: true, subscriptionUsedHours: 2, paymentMethod: null,
      estimatedPrice: 99999, visitGrossAmount: null,
    })
    expect(r.kind).toBe('subscription')
    expect(r.amount).toBeNull()
    expect(r.subscriptionHours).toBe(2)
  })

  it('marks FREE payment method as 0 ₽, not "unknown"', () => {
    const r = categorizeShootAmount({
      hasSubscriptionUsage: false, subscriptionUsedHours: null, paymentMethod: 'FREE',
      estimatedPrice: null, visitGrossAmount: null,
    })
    expect(r).toEqual({ kind: 'free', amount: 0 })
  })

  it('marks UNPAID as a distinct state from "no data"', () => {
    const r = categorizeShootAmount({
      hasSubscriptionUsage: false, subscriptionUsedHours: null, paymentMethod: 'UNPAID',
      estimatedPrice: null, visitGrossAmount: null,
    })
    expect(r.kind).toBe('unpaid')
  })

  it('falls back to visit gross amount only when no structured event price exists', () => {
    const r = categorizeShootAmount({
      hasSubscriptionUsage: false, subscriptionUsedHours: null, paymentMethod: null,
      estimatedPrice: null, visitGrossAmount: 5000,
    })
    expect(r).toEqual({ kind: 'amount', amount: 5000 })
  })

  it('returns unknown when nothing is known', () => {
    const r = categorizeShootAmount({
      hasSubscriptionUsage: false, subscriptionUsedHours: null, paymentMethod: null,
      estimatedPrice: null, visitGrossAmount: null,
    })
    expect(r.kind).toBe('unknown')
  })
})

describe('mergeShoots — dedup between ClientVisit and ScheduleEvent', () => {
  it('merges a same-day visit and event into ONE row, not two', () => {
    const rows = mergeShoots([visit()], [event()], NOW)
    expect(rows).toHaveLength(1)
    expect(rows[0].source).toBe('schedule')
    expect(rows[0].scheduleEventId).toBe('e1')
    expect(rows[0].visitId).toBe('v1')
  })

  it('prefers the event structured price over the visit gross amount (no double amount)', () => {
    const rows = mergeShoots([visit({ grossAmount: 9999 })], [event({ estimatedPrice: 12000 })], NOW)
    expect(rows[0].amount).toEqual({ kind: 'amount', amount: 12000 })
  })

  it('falls back to the visit gross amount when the event has no structured price', () => {
    const rows = mergeShoots(
      [visit({ grossAmount: 7000 })],
      [event({ estimatedPrice: null, paymentMethod: null })],
      NOW,
    )
    expect(rows[0].amount).toEqual({ kind: 'amount', amount: 7000 })
  })

  it('keeps an unmatched historical visit as its own row without an internal link', () => {
    const rows = mergeShoots([visit({ date: new Date('2020-01-01') })], [], NOW)
    expect(rows).toHaveLength(1)
    expect(rows[0].source).toBe('visit')
    expect(rows[0].scheduleEventId).toBeNull()
    expect(rows[0].calendarEventId).toBeNull()
  })

  it('keeps a standalone future event with no visit as its own row, flagged as future', () => {
    const future = new Date(NOW.getTime() + 86_400_000)
    const rows = mergeShoots([], [event({ id: 'e-future', startAt: future, endAt: new Date(future.getTime() + 7_200_000) })], NOW)
    expect(rows).toHaveLength(1)
    expect(rows[0].isFuture).toBe(true)
  })

  it('does not let two same-day visits both claim the same single event', () => {
    const rows = mergeShoots(
      [visit({ id: 'v1', room: 'Светлый зал' }), visit({ id: 'v2', room: 'Тёмный зал' })],
      [event()],
      NOW,
    )
    expect(rows).toHaveLength(2)
    const matched = rows.filter(r => r.scheduleEventId === 'e1')
    expect(matched).toHaveLength(1)
  })

  it('computes duration from start/end when available, else falls back to the visit field', () => {
    const withTimes = mergeShoots([], [event()], NOW)
    expect(withTimes[0].durationHours).toBe(2)

    const noTimes = mergeShoots(
      [visit({ durationHours: 3 })],
      [event({ startAt: null, endAt: null })],
      NOW,
    )
    expect(noTimes[0].durationHours).toBe(3)
  })
})

describe('computeShootsSummary — no double counting of hours/money', () => {
  it('excludes cancelled shoots (linked order CANCELLED) from hours and count', () => {
    const rows = mergeShoots([], [
      event({ id: 'e1', orderStatus: 'CANCELLED' }),
      event({ id: 'e2', orderStatus: null }),
    ], NOW)
    const summary = computeShootsSummary(rows)
    expect(summary.totalShoots).toBe(1)
    expect(summary.totalHours).toBe(2)
  })

  it('excludes future shoots from "hours actually spent"', () => {
    const future = new Date(NOW.getTime() + 86_400_000)
    const rows = mergeShoots([], [
      event({ id: 'e-past', startAt: new Date('2026-06-01T10:00:00Z'), endAt: new Date('2026-06-01T12:00:00Z') }),
      event({ id: 'e-future', startAt: future, endAt: new Date(future.getTime() + 7_200_000) }),
    ], NOW)
    const summary = computeShootsSummary(rows)
    expect(summary.totalShoots).toBe(1)
    expect(summary.totalHours).toBe(2)
  })

  it('averages only rows with a known real amount, ignoring subscription/free/unknown/unpaid', () => {
    const rows: ShootRow[] = mergeShoots([], [
      event({ id: 'e1', estimatedPrice: 10000, paymentMethod: 'CASH' }),
      event({ id: 'e2', estimatedPrice: null, paymentMethod: null, subscriptionUsedHours: 2 }),
      event({ id: 'e3', estimatedPrice: null, paymentMethod: 'FREE' }),
    ], NOW)
    const summary = computeShootsSummary(rows)
    // только e1 несёт известную сумму 10000 => среднее = 10000, а не (10000+0)/3
    expect(summary.avgCheck).toBe(10000)
  })
})

describe('computeFinanceOverview — subscription purchase counted once, not per shoot', () => {
  it('counts a subscription purchase a single time regardless of how many shoots used it', () => {
    const rows = mergeShoots([], [
      event({ id: 'e1', estimatedPrice: null, paymentMethod: null, subscriptionUsedHours: 2 }),
      event({ id: 'e2', estimatedPrice: null, paymentMethod: null, subscriptionUsedHours: 3 }),
      event({ id: 'e3', estimatedPrice: null, paymentMethod: null, subscriptionUsedHours: 1 }),
    ], NOW)
    const overview = computeFinanceOverview(
      [{ id: 'sub1', paidAmount: 52000, status: 'ACTIVE', refundAmount: null }],
      rows,
    )
    expect(overview.subscriptionPurchasesTotal).toBe(52000)
    expect(overview.oneTimePaymentsTotal).toBe(0)
    expect(overview.totalReceived).toBe(52000)
  })

  it('subtracts refunds from the net total but keeps the gross total intact', () => {
    const overview = computeFinanceOverview(
      [{ id: 'sub1', paidAmount: 52000, status: 'REFUNDED', refundAmount: 20000 }],
      [],
    )
    expect(overview.totalReceived).toBe(52000)
    expect(overview.refundsTotal).toBe(20000)
    expect(overview.netReceived).toBe(32000)
  })

  it('adds one-time payments separately from subscription purchases, no overlap', () => {
    const rows = mergeShoots([], [event({ id: 'e1', estimatedPrice: 15000, paymentMethod: 'CARD' })], NOW)
    const overview = computeFinanceOverview(
      [{ id: 'sub1', paidAmount: 52000, status: 'ACTIVE', refundAmount: null }],
      rows,
    )
    expect(overview.subscriptionPurchasesTotal).toBe(52000)
    expect(overview.oneTimePaymentsTotal).toBe(15000)
    expect(overview.totalReceived).toBe(67000)
  })

  it('excludes a cancelled one-time shoot from the received total, even if it carries an amount', () => {
    const rows = mergeShoots([], [
      event({ id: 'e1', estimatedPrice: 15000, paymentMethod: 'CARD', orderStatus: 'CANCELLED' }),
      event({ id: 'e2', estimatedPrice: 5000, paymentMethod: 'CARD' }),
    ], NOW)
    const overview = computeFinanceOverview([], rows)
    expect(overview.oneTimePaymentsTotal).toBe(5000)
    expect(overview.totalReceived).toBe(5000)
  })

  it('builds a per-shoot segment list when there are few one-time payments', () => {
    const rows = mergeShoots([], [event({ id: 'e1', estimatedPrice: 1000, paymentMethod: 'CASH' })], NOW)
    const overview = computeFinanceOverview([], rows)
    expect(overview.segments).toHaveLength(1)
    expect(overview.segments[0].value).toBe(1000)
  })

  it('collapses many one-time payments into a single grouped segment', () => {
    const events = Array.from({ length: 10 }, (_, i) => event({ id: `e${i}`, estimatedPrice: 1000, paymentMethod: 'CASH' }))
    const rows = mergeShoots([], events, NOW)
    const overview = computeFinanceOverview([], rows)
    expect(overview.segments).toHaveLength(1)
    expect(overview.segments[0].label).toBe('Разовые оплаты')
    expect(overview.segments[0].value).toBe(10000)
  })
})
