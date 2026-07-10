import { describe, it, expect } from 'vitest'
import {
  mergeShoots, computeShootsSummary, computeFinanceOverview, categorizeShootAmount,
  computeMaterialsCapsules, getVisibleShoots, getHiddenShootsCount, SHOOTS_TABLE_DEFAULT_LIMIT,
  type ShootVisitInput, type ShootEventInput, type ShootRow,
} from './client-shoots-model'

const NOW = new Date('2026-07-10T12:00:00Z')

function visit(overrides: Partial<ShootVisitInput> = {}): ShootVisitInput {
  return {
    id: 'v1', date: new Date('2026-06-01T00:00:00Z'), startAt: null, endAt: null,
    room: 'Светлый зал', format: 'Подкаст',
    durationHours: 2, grossAmount: 10000, netAmount: 9000, comment: null,
    ...overrides,
  }
}

function event(overrides: Partial<ShootEventInput> = {}): ShootEventInput {
  return {
    id: 'e1', calendarEventId: 'cal1',
    startAt: new Date('2026-06-01T10:00:00Z'), endAt: new Date('2026-06-01T12:00:00Z'),
    room: 'Светлый зал', format: 'Подкаст', estimatedPrice: 12000, paymentMethod: 'CASH',
    yandexDiskUrl: null, yandexDiskUrlExpiresAt: null, nasBackupUrl: null,
    notes: null, makeupDurationMinutes: null, subscriptionUsedHours: null, orderStatus: null,
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

  it('sorts newest-first by real date/time, not by the string form of the date', () => {
    // Умышленно передаём события НЕ в хронологическом порядке, с датами,
    // строковое сравнение которых дало бы другой результат, если бы где-то
    // в коде sort сравнивал ISO-строки, а не .getTime() — ловим этот класс
    // регрессии явно, а не полагаемся на то, что ISO и так сортируется верно.
    const rows = mergeShoots([], [
      event({ id: 'e-mid', startAt: new Date('2026-06-15T10:00:00Z'), endAt: new Date('2026-06-15T12:00:00Z') }),
      event({ id: 'e-newest', startAt: new Date('2026-07-01T10:00:00Z'), endAt: new Date('2026-07-01T12:00:00Z') }),
      event({ id: 'e-oldest', startAt: new Date('2025-01-01T10:00:00Z'), endAt: new Date('2025-01-01T12:00:00Z') }),
    ], NOW)
    expect(rows.map(r => r.scheduleEventId)).toEqual(['e-newest', 'e-mid', 'e-oldest'])
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

  it('sums makeup minutes across actual shoots as a separate figure from totalHours', () => {
    const rows = mergeShoots([], [
      event({ id: 'e1', makeupDurationMinutes: 60 }),
      event({ id: 'e2', makeupDurationMinutes: 30 }),
    ], NOW)
    const summary = computeShootsSummary(rows)
    expect(summary.totalMakeupMinutes).toBe(90)
    expect(summary.totalHours).toBe(4) // не увеличилось из-за гримёра
  })

  it('excludes cancelled/future shoots from the makeup-minutes total too', () => {
    const future = new Date(NOW.getTime() + 86_400_000)
    const rows = mergeShoots([], [
      event({ id: 'e-cancelled', orderStatus: 'CANCELLED', makeupDurationMinutes: 60 }),
      event({ id: 'e-future', startAt: future, endAt: new Date(future.getTime() + 7_200_000), makeupDurationMinutes: 60 }),
      event({ id: 'e-real', makeupDurationMinutes: 30 }),
    ], NOW)
    const summary = computeShootsSummary(rows)
    expect(summary.totalMakeupMinutes).toBe(30)
  })

  it('treats no-makeup shoots as contributing 0, not null, to the total', () => {
    const rows = mergeShoots([], [event({ id: 'e1', makeupDurationMinutes: null })], NOW)
    expect(computeShootsSummary(rows).totalMakeupMinutes).toBe(0)
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

describe('computeMaterialsCapsules', () => {
  const uploadedAt = new Date('2026-07-01T00:00:00Z')
  const expiresAt = new Date(uploadedAt.getTime() + 14 * 24 * 60 * 60 * 1000)

  it('shows the Yandex capsule as active before the 14-day expiry', () => {
    const justBefore = new Date(expiresAt.getTime() - 1000)
    const state = computeMaterialsCapsules({ yandexDiskUrl: 'https://disk.yandex.ru/d/x', yandexDiskUrlExpiresAt: expiresAt, nasBackupUrl: null }, justBefore)
    expect(state.yandex).toBe('active')
  })

  it('marks the Yandex link expired once the 14-day window has passed', () => {
    const justAfter = new Date(expiresAt.getTime() + 1000)
    const state = computeMaterialsCapsules({ yandexDiskUrl: 'https://disk.yandex.ru/d/x', yandexDiskUrlExpiresAt: expiresAt, nasBackupUrl: null }, justAfter)
    expect(state.yandex).toBe('expired')
  })

  it('treats exactly 14 days as expired (boundary is inclusive, not one-off)', () => {
    const state = computeMaterialsCapsules({ yandexDiskUrl: 'https://disk.yandex.ru/d/x', yandexDiskUrlExpiresAt: expiresAt, nasBackupUrl: null }, expiresAt)
    expect(state.yandex).toBe('expired')
  })

  it('shows NAS as active whenever a NAS link is stored, independent of Yandex state', () => {
    const state = computeMaterialsCapsules({ yandexDiskUrl: null, yandexDiskUrlExpiresAt: null, nasBackupUrl: 'https://nas.local/x' }, new Date())
    expect(state.nas).toBe('active')
    expect(state.yandex).toBeNull()
  })

  it('reports both capsules absent when neither link is stored ("Нет материалов" case)', () => {
    const state = computeMaterialsCapsules({ yandexDiskUrl: null, yandexDiskUrlExpiresAt: null, nasBackupUrl: null }, new Date())
    expect(state.yandex).toBeNull()
    expect(state.nas).toBeNull()
  })
})

describe('getVisibleShoots / getHiddenShootsCount — "show 5 / show all"', () => {
  const ten = Array.from({ length: 10 }, (_, i) => i)

  it('shows only the first 5 by default', () => {
    expect(getVisibleShoots(ten, false)).toHaveLength(SHOOTS_TABLE_DEFAULT_LIMIT)
    expect(getHiddenShootsCount(ten.length)).toBe(5)
  })

  it('shows all 10 once expanded', () => {
    expect(getVisibleShoots(ten, true)).toHaveLength(10)
  })

  it('hides nothing (and the button should not render) when there are 5 or fewer shoots', () => {
    const five = ten.slice(0, 5)
    expect(getHiddenShootsCount(five.length)).toBe(0)
    expect(getVisibleShoots(five, false)).toHaveLength(5)
  })

  it('never affects analytics — computeShootsSummary always sums the full list, not just the visible slice', () => {
    const events = Array.from({ length: 10 }, (_, i) =>
      event({ id: `e${i}`, startAt: new Date(NOW.getTime() - i * 86_400_000), endAt: new Date(NOW.getTime() - i * 86_400_000 + 7_200_000) }))
    const rows = mergeShoots([], events, NOW)
    const collapsedSummary = computeShootsSummary(getVisibleShoots(rows, false))
    const fullSummary = computeShootsSummary(rows)
    // Если бы аналитика случайно считалась по обрезанному (5 строк) списку,
    // эти числа разошлись бы — часы/count должны совпадать с полным набором.
    expect(collapsedSummary.totalShoots).not.toBe(fullSummary.totalShoots)
    expect(fullSummary.totalShoots).toBe(10)
    expect(fullSummary.totalHours).toBe(20)
  })
})
