import { describe, it, expect } from 'vitest'
import {
  computeMontageProfit, computeMontageMargin,
  computeMontageDeadline, isMontageOverdue, montageDeadlineLabel,
  getMontageSourceMaterialsUrl, isMontageMissingNas,
  getMontageAttentionReasons, type MontageAttentionInput,
  mapMontageStatusToOrderStatus, pluralizeProjectsCount,
  MONTAGE_STATUS_LABELS, MONTAGE_STATUS_ORDER,
  computeMontageDashboardStats, type MontageStatsInput,
  computeEditorAllTimeSummary, computeEditorMonthlyStats, type EditorProjectStatsInput,
} from './montage-model'

describe('computeMontageProfit — единая формула прибыли', () => {
  it('computes clientAmount minus editorAmount when both are known', () => {
    expect(computeMontageProfit(20000, 16000)).toBe(4000)
  })

  it('supports negative profit', () => {
    expect(computeMontageProfit(10000, 17500)).toBe(-7500)
  })

  it('returns null (not 0) when clientAmount is unknown', () => {
    expect(computeMontageProfit(null, 16000)).toBeNull()
  })

  it('returns null (not 0) when editorAmount is unknown', () => {
    expect(computeMontageProfit(20000, null)).toBeNull()
  })
})

describe('computeMontageMargin', () => {
  it('computes margin as profit / clientAmount', () => {
    expect(computeMontageMargin(20000, 16000)).toBeCloseTo(0.2)
  })

  it('returns null when clientAmount is 0 (avoid division by zero)', () => {
    expect(computeMontageMargin(0, 0)).toBeNull()
  })

  it('returns null when profit cannot be computed', () => {
    expect(computeMontageMargin(null, 16000)).toBeNull()
  })
})

describe('computeMontageDeadline', () => {
  it('uses deadlineDate as-is for FIXED_DATE', () => {
    const d = computeMontageDeadline({
      sourceReceivedAt: '2026-07-01', deadlineType: 'FIXED_DATE',
      deadlineDate: '2026-07-15', turnaroundDays: null,
    })
    expect(d?.toISOString().slice(0, 10)).toBe('2026-07-15')
  })

  it('adds turnaroundDays calendar days to sourceReceivedAt for DURATION_DAYS', () => {
    const d = computeMontageDeadline({
      sourceReceivedAt: '2026-07-01', deadlineType: 'DURATION_DAYS',
      deadlineDate: null, turnaroundDays: 10,
    })
    expect(d?.toISOString().slice(0, 10)).toBe('2026-07-11')
  })

  it('returns null for DURATION_DAYS without sourceReceivedAt', () => {
    const d = computeMontageDeadline({
      sourceReceivedAt: null, deadlineType: 'DURATION_DAYS', deadlineDate: null, turnaroundDays: 10,
    })
    expect(d).toBeNull()
  })

  it('returns null when deadlineType is null', () => {
    const d = computeMontageDeadline({
      sourceReceivedAt: '2026-07-01', deadlineType: null, deadlineDate: '2026-07-15', turnaroundDays: null,
    })
    expect(d).toBeNull()
  })
})

describe('isMontageOverdue / montageDeadlineLabel', () => {
  const now = new Date('2026-07-13T12:00:00.000Z')

  it('is overdue when deadline is in the past and status is active', () => {
    const project = { deadlineDate: '2026-07-10', status: 'IN_PROGRESS' as const, deliveredAt: null }
    expect(isMontageOverdue(project, now)).toBe(true)
    expect(montageDeadlineLabel(project, now)).toMatch(/Просрочено на 3/)
  })

  it('is not overdue once delivered, even if the deadline has passed', () => {
    const project = { deadlineDate: '2026-07-10', status: 'DELIVERED' as const, deliveredAt: '2026-07-09' }
    expect(isMontageOverdue(project, now)).toBe(false)
  })

  it('shows "Сдано вовремя" when delivered on or before the deadline', () => {
    const project = { deadlineDate: '2026-07-10', status: 'DELIVERED' as const, deliveredAt: '2026-07-09' }
    expect(montageDeadlineLabel(project, now)).toBe('Сдано вовремя')
  })

  it('shows delay in days when delivered after the deadline', () => {
    const project = { deadlineDate: '2026-07-10', status: 'DELIVERED' as const, deliveredAt: '2026-07-13' }
    expect(montageDeadlineLabel(project, now)).toBe('Сдано с опозданием на 3 дня')
  })

  it('shows remaining days for an upcoming deadline', () => {
    const project = { deadlineDate: '2026-07-16', status: 'IN_PROGRESS' as const, deliveredAt: null }
    expect(montageDeadlineLabel(project, now)).toBe('Осталось 3 дня')
  })

  it('shows "Дедлайн сегодня" when the deadline is today', () => {
    const project = { deadlineDate: '2026-07-13T18:00:00.000Z', status: 'IN_PROGRESS' as const, deliveredAt: null }
    expect(montageDeadlineLabel(project, now)).toBe('Дедлайн сегодня')
  })

  it('is never overdue for CANCELLED/ARCHIVED regardless of the date', () => {
    expect(isMontageOverdue({ deadlineDate: '2026-01-01', status: 'CANCELLED', deliveredAt: null }, now)).toBe(false)
    expect(isMontageOverdue({ deadlineDate: '2026-01-01', status: 'ARCHIVED', deliveredAt: null }, now)).toBe(false)
  })

  it('returns null label when there is no deadline at all', () => {
    expect(montageDeadlineLabel({ deadlineDate: null, status: 'NEW', deliveredAt: null }, now)).toBeNull()
  })
})

describe('getMontageSourceMaterialsUrl — не дублирует ScheduleEvent.yandexDiskUrl', () => {
  it('prefers the project-level override when set', () => {
    expect(getMontageSourceMaterialsUrl({ sourceMaterialsUrl: 'https://own-link' }, 'https://order-link')).toBe('https://own-link')
  })

  it('falls back to the linked order/shoot materials link', () => {
    expect(getMontageSourceMaterialsUrl({ sourceMaterialsUrl: null }, 'https://order-link')).toBe('https://order-link')
  })

  it('returns null when neither is available', () => {
    expect(getMontageSourceMaterialsUrl({ sourceMaterialsUrl: null }, null)).toBeNull()
  })
})

describe('isMontageMissingNas', () => {
  it('flags READY/DELIVERED projects without a NAS link', () => {
    expect(isMontageMissingNas({ status: 'DELIVERED', mountedMaterialNasUrl: null })).toBe(true)
    expect(isMontageMissingNas({ status: 'READY', mountedMaterialNasUrl: null })).toBe(true)
  })

  it('does not flag projects that already have a NAS link', () => {
    expect(isMontageMissingNas({ status: 'DELIVERED', mountedMaterialNasUrl: 'https://nas' })).toBe(false)
  })

  it('does not flag projects that are not yet complete', () => {
    expect(isMontageMissingNas({ status: 'IN_PROGRESS', mountedMaterialNasUrl: null })).toBe(false)
  })
})

describe('getMontageAttentionReasons — единый источник для KPI и списка', () => {
  const now = new Date('2026-07-13T12:00:00.000Z')

  function makeInput(overrides: Partial<MontageAttentionInput> = {}): MontageAttentionInput {
    return {
      status: 'IN_PROGRESS',
      editorId: 'editor-1',
      deadlineDate: '2026-07-20',
      deliveredAt: null,
      effectiveSourceMaterialsUrl: 'https://source',
      mountedMaterialNasUrl: null,
      clientAmount: 20000,
      clientPaymentStatus: 'PAID',
      title: 'Монтаж подкаста',
      description: null,
      hasNoClientLink: false,
      isHistoricalImport: false,
      ...overrides,
    }
  }

  it('returns no reasons for a fully filled, on-time, assigned project', () => {
    expect(getMontageAttentionReasons(makeInput(), now)).toEqual([])
  })

  it('flags a project with no editor assigned once past NEW/NEEDS_INFO', () => {
    expect(getMontageAttentionReasons(makeInput({ editorId: null, status: 'READY_FOR_ASSIGNMENT' }), now)).toContain('NO_EDITOR')
  })

  it('does not flag a brand-new project for missing editor/source yet', () => {
    const reasons = getMontageAttentionReasons(makeInput({ editorId: null, status: 'NEW', effectiveSourceMaterialsUrl: null }), now)
    expect(reasons).not.toContain('NO_EDITOR')
    expect(reasons).not.toContain('NO_SOURCE')
  })

  it('flags an overdue project', () => {
    expect(getMontageAttentionReasons(makeInput({ deadlineDate: '2026-07-01' }), now)).toContain('OVERDUE')
  })

  it('flags a project delivered without a NAS link', () => {
    const reasons = getMontageAttentionReasons(makeInput({ status: 'DELIVERED', deliveredAt: '2026-07-12', mountedMaterialNasUrl: null }), now)
    expect(reasons).toContain('NO_NAS_AFTER_DELIVERY')
  })

  it('does NOT flag missing source/NAS for historical-import projects — old sheet never tracked them', () => {
    const reasons = getMontageAttentionReasons(makeInput({
      status: 'DELIVERED', deliveredAt: '2026-07-12', mountedMaterialNasUrl: null,
      effectiveSourceMaterialsUrl: null, isHistoricalImport: true,
    }), now)
    expect(reasons).not.toContain('NO_NAS_AFTER_DELIVERY')
    expect(reasons).not.toContain('NO_SOURCE')
  })

  it('still flags missing source/NAS for a NEW (non-imported) project going through the platform', () => {
    const reasons = getMontageAttentionReasons(makeInput({
      status: 'DELIVERED', deliveredAt: '2026-07-12', mountedMaterialNasUrl: null,
      effectiveSourceMaterialsUrl: null, isHistoricalImport: false,
    }), now)
    expect(reasons).toContain('NO_NAS_AFTER_DELIVERY')
    expect(reasons).toContain('NO_SOURCE')
  })

  it('still flags other issues (no client, no editor) on historical-import projects', () => {
    const reasons = getMontageAttentionReasons(makeInput({
      isHistoricalImport: true, hasNoClientLink: true, editorId: null, status: 'ASSIGNED',
    }), now)
    expect(reasons).toContain('NO_CLIENT_LINK')
    expect(reasons).toContain('NO_EDITOR')
  })

  it('flags undefined client payment status only when an amount is known', () => {
    expect(getMontageAttentionReasons(makeInput({ clientPaymentStatus: 'NOT_SPECIFIED', clientAmount: 20000 }), now)).toContain('PAYMENT_UNDEFINED')
    expect(getMontageAttentionReasons(makeInput({ clientPaymentStatus: 'NOT_SPECIFIED', clientAmount: null }), now)).not.toContain('PAYMENT_UNDEFINED')
  })

  it('flags an incomplete card with neither title nor description', () => {
    expect(getMontageAttentionReasons(makeInput({ title: null, description: null }), now)).toContain('INCOMPLETE_CARD')
  })

  it('flags a project with no client link at all (unmatched import row)', () => {
    expect(getMontageAttentionReasons(makeInput({ hasNoClientLink: true }), now)).toContain('NO_CLIENT_LINK')
  })

  it('does not flag a normally-linked project', () => {
    expect(getMontageAttentionReasons(makeInput({ hasNoClientLink: false }), now)).not.toContain('NO_CLIENT_LINK')
  })

  it('never flags CANCELLED or ARCHIVED projects, no matter what is missing', () => {
    expect(getMontageAttentionReasons(makeInput({ status: 'CANCELLED', editorId: null, deadlineDate: '2020-01-01' }), now)).toEqual([])
    expect(getMontageAttentionReasons(makeInput({ status: 'ARCHIVED', editorId: null, deadlineDate: '2020-01-01' }), now)).toEqual([])
  })
})

describe('mapMontageStatusToOrderStatus — однонаправленная связь с CRM', () => {
  it('moves the order to REVISIONS when the montage enters a revisions state', () => {
    expect(mapMontageStatusToOrderStatus('REVISIONS', 'EDITING')).toBe('REVISIONS')
    expect(mapMontageStatusToOrderStatus('AWAITING_REVISIONS', 'EDITING')).toBe('REVISIONS')
  })

  it('does not re-trigger REVISIONS when the order is already there', () => {
    expect(mapMontageStatusToOrderStatus('REVISIONS', 'REVISIONS')).toBeNull()
  })

  it('moves the order to COMPLETED when the montage is delivered', () => {
    expect(mapMontageStatusToOrderStatus('DELIVERED', 'EDITING')).toBe('COMPLETED')
    expect(mapMontageStatusToOrderStatus('DELIVERED', 'REVISIONS')).toBe('COMPLETED')
  })

  it('never touches an order that was manually moved elsewhere (no cycles)', () => {
    expect(mapMontageStatusToOrderStatus('IN_PROGRESS', 'CANCELLED')).toBeNull()
    expect(mapMontageStatusToOrderStatus('DELIVERED', 'COMPLETED')).toBeNull()
    expect(mapMontageStatusToOrderStatus('DELIVERED', 'BOOKED')).toBeNull()
  })

  it('returns null for intermediate montage statuses that have no order-status equivalent', () => {
    expect(mapMontageStatusToOrderStatus('IN_PROGRESS', 'EDITING')).toBeNull()
  })
})

describe('pluralizeProjectsCount', () => {
  it('handles singular/few/many Russian plural forms', () => {
    expect(pluralizeProjectsCount(1)).toBe('1 проект')
    expect(pluralizeProjectsCount(2)).toBe('2 проекта')
    expect(pluralizeProjectsCount(5)).toBe('5 проектов')
    expect(pluralizeProjectsCount(11)).toBe('11 проектов')
    expect(pluralizeProjectsCount(21)).toBe('21 проект')
  })
})

describe('computeMontageDashboardStats — единый источник KPI дашборда', () => {
  const now = new Date('2026-07-13T12:00:00.000Z')

  function makeStatsInput(overrides: Partial<MontageStatsInput> = {}): MontageStatsInput {
    return {
      status: 'DELIVERED',
      sourceReceivedAt: '2025-10-07',
      clientAmount: 20000,
      editorAmount: 16000,
      clientPaymentStatus: 'PAID',
      editorPaymentStatus: 'PAID',
      editorId: 'editor-1',
      deadlineDate: '2025-10-17',
      deliveredAt: '2025-10-16',
      effectiveSourceMaterialsUrl: 'https://source',
      mountedMaterialNasUrl: 'https://nas',
      title: 'Монтаж подкаста',
      description: null,
      hasNoClientLink: false,
      isHistoricalImport: false,
      ...overrides,
    }
  }

  it('counts delivered projects and computes revenue/expenses/profit/margin', () => {
    const stats = computeMontageDashboardStats([
      makeStatsInput({ clientAmount: 20000, editorAmount: 16000 }),
      makeStatsInput({ clientAmount: 10000, editorAmount: 7000 }),
    ], now)
    expect(stats.deliveredCount).toBe(2)
    expect(stats.revenueTotal).toBe(30000)
    expect(stats.expensesTotal).toBe(23000)
    expect(stats.profit).toBe(7000)
    expect(stats.margin).toBeCloseTo(7000 / 30000)
  })

  it('picks the earliest sourceReceivedAt as reportingSince, ignoring nulls', () => {
    const stats = computeMontageDashboardStats([
      makeStatsInput({ sourceReceivedAt: '2025-11-01' }),
      makeStatsInput({ sourceReceivedAt: '2025-10-07' }),
      makeStatsInput({ sourceReceivedAt: null }),
    ], now)
    expect(stats.reportingSince?.slice(0, 10)).toBe('2025-10-07')
  })

  it('returns null reportingSince when no project has a known date', () => {
    const stats = computeMontageDashboardStats([makeStatsInput({ sourceReceivedAt: null })], now)
    expect(stats.reportingSince).toBeNull()
  })

  it('separates paid revenue/expenses from accrued totals', () => {
    const stats = computeMontageDashboardStats([
      makeStatsInput({ clientAmount: 20000, clientPaymentStatus: 'PENDING', editorAmount: 16000, editorPaymentStatus: 'PAID' }),
    ], now)
    expect(stats.revenueTotal).toBe(20000)
    expect(stats.revenuePaid).toBe(0)
    expect(stats.expensesTotal).toBe(16000)
    expect(stats.expensesPaid).toBe(16000)
  })

  it('sums client/studio debt only for PENDING/PARTIALLY_PAID statuses', () => {
    const stats = computeMontageDashboardStats([
      makeStatsInput({ clientAmount: 20000, clientPaymentStatus: 'PENDING' }),
      makeStatsInput({ clientAmount: 5000, clientPaymentStatus: 'PARTIALLY_PAID' }),
      makeStatsInput({ clientAmount: 8000, clientPaymentStatus: 'PAID' }),
      makeStatsInput({ editorAmount: 12000, editorPaymentStatus: 'PENDING' }),
    ], now)
    expect(stats.clientDebt).toBe(25000)
    expect(stats.studioDebt).toBe(12000)
  })

  it('counts active and attention-needing projects using the shared predicates', () => {
    const stats = computeMontageDashboardStats([
      makeStatsInput({ status: 'IN_PROGRESS', clientAmount: null, editorAmount: null, deadlineDate: null }),
      makeStatsInput({ status: 'DELIVERED', mountedMaterialNasUrl: null, clientAmount: null, editorAmount: null }),
      makeStatsInput({ status: 'CANCELLED', editorId: null, clientAmount: null, editorAmount: null }),
    ], now)
    expect(stats.activeCount).toBe(1)
    expect(stats.attentionCount).toBe(1)
  })

  it('returns zeroed stats for an empty project list', () => {
    const stats = computeMontageDashboardStats([], now)
    expect(stats).toEqual({
      deliveredCount: 0, reportingSince: null, revenueTotal: 0, revenuePaid: 0,
      expensesTotal: 0, expensesPaid: 0, profit: 0, margin: null, activeCount: 0,
      attentionCount: 0, clientDebt: 0, studioDebt: 0,
    })
  })
})

describe('computeEditorAllTimeSummary — карточка монтажёра, показатели за всё время', () => {
  function makeEditorProject(overrides: Partial<EditorProjectStatsInput> = {}): EditorProjectStatsInput {
    return {
      status: 'DELIVERED',
      clientAmount: 20000,
      editorAmount: 16000,
      editorPaymentStatus: 'PAID',
      sourceReceivedAt: '2025-10-07',
      deliveredAt: '2025-10-17',
      deadlineDate: '2025-10-18',
      ...overrides,
    }
  }

  it('counts delivered/active projects and totals earned/profit', () => {
    const summary = computeEditorAllTimeSummary([
      makeEditorProject({ clientAmount: 20000, editorAmount: 16000 }),
      makeEditorProject({ status: 'IN_PROGRESS', clientAmount: 10000, editorAmount: 7000 }),
    ])
    expect(summary.totalProjects).toBe(2)
    expect(summary.deliveredProjects).toBe(1)
    expect(summary.activeProjects).toBe(1)
    expect(summary.totalEarned).toBe(23000)
    expect(summary.studioProfit).toBe(4000 + 3000)
  })

  it('separates paid earnings from accrued earnings', () => {
    const summary = computeEditorAllTimeSummary([
      makeEditorProject({ editorAmount: 16000, editorPaymentStatus: 'PENDING' }),
    ])
    expect(summary.totalEarned).toBe(16000)
    expect(summary.paidEarned).toBe(0)
  })

  it('computes average turnaround only from projects with both dates known', () => {
    const summary = computeEditorAllTimeSummary([
      makeEditorProject({ sourceReceivedAt: '2025-10-01', deliveredAt: '2025-10-11' }), // 10 days
      makeEditorProject({ sourceReceivedAt: '2025-10-01', deliveredAt: '2025-10-21' }), // 20 days
      makeEditorProject({ sourceReceivedAt: null, deliveredAt: null }),
    ])
    expect(summary.avgTurnaroundDays).toBe(15)
  })

  it('returns zeroed/null summary for an editor with no projects', () => {
    const summary = computeEditorAllTimeSummary([])
    expect(summary).toEqual({
      totalProjects: 0, deliveredProjects: 0, activeProjects: 0, totalEarned: 0, paidEarned: 0,
      studioProfit: 0, avgProjectAmount: null, avgTurnaroundDays: null,
    })
  })
})

describe('computeEditorMonthlyStats — помесячная аналитика монтажёра', () => {
  function makeEditorProject(overrides: Partial<EditorProjectStatsInput> = {}): EditorProjectStatsInput {
    return {
      status: 'DELIVERED',
      clientAmount: 20000,
      editorAmount: 16000,
      editorPaymentStatus: 'PAID',
      sourceReceivedAt: '2025-10-07',
      deliveredAt: '2025-10-17',
      deadlineDate: '2025-10-18',
      ...overrides,
    }
  }

  const now = new Date('2026-07-13T12:00:00.000Z')

  it('only includes projects whose sourceReceivedAt falls in the selected month', () => {
    const stats = computeEditorMonthlyStats([
      makeEditorProject({ sourceReceivedAt: '2025-10-07', clientAmount: 20000, editorAmount: 16000 }),
      makeEditorProject({ sourceReceivedAt: '2025-11-01', clientAmount: 5000, editorAmount: 4000 }),
    ], '2025-10', now)
    expect(stats.projectsCount).toBe(1)
    expect(stats.editorEarned).toBe(16000)
    expect(stats.clientRevenue).toBe(20000)
  })

  it('counts overdue projects within the month using the shared overdue predicate', () => {
    const stats = computeEditorMonthlyStats([
      makeEditorProject({ sourceReceivedAt: '2025-10-01', status: 'IN_PROGRESS', deadlineDate: '2020-01-01', deliveredAt: null }),
    ], '2025-10', now)
    expect(stats.overdueCount).toBe(1)
  })

  it('returns zeroed stats for a month with no projects', () => {
    const stats = computeEditorMonthlyStats([makeEditorProject({ sourceReceivedAt: '2025-10-07' })], '2026-01', now)
    expect(stats.projectsCount).toBe(0)
    expect(stats.editorEarned).toBe(0)
    expect(stats.avgTurnaroundDays).toBeNull()
  })
})

describe('MONTAGE_STATUS_LABELS / MONTAGE_STATUS_ORDER — consistency', () => {
  it('has a label for every status in the enum order list', () => {
    for (const status of MONTAGE_STATUS_ORDER) {
      expect(MONTAGE_STATUS_LABELS[status]).toBeTruthy()
    }
  })

  it('lists all 14 statuses from the spec exactly once', () => {
    expect(MONTAGE_STATUS_ORDER).toHaveLength(14)
    expect(new Set(MONTAGE_STATUS_ORDER).size).toBe(14)
  })
})
