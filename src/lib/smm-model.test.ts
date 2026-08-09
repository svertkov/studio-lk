import { describe, it, expect } from 'vitest'
import {
  computeSmmBillingPeriod, isWithinPeriod, computePackageProgress,
  isSmmContentOverdue, getPrimaryResponsibleMember, computeSmmMonthlyRevenue,
  wouldCreateContentParentCycle, getLatestMetricByType, CONTENT_SERVICE_TYPES,
  getContentMontageShortState, getNearestPublicationInfo, computeContentMaterialsIndicator,
  getSmmContentAttentionReasons, isSmmContentOperationallyOverdue, sortSmmProductionRowsDefault,
  computeSmmProductionKpis, matchesSmmProductionDateFilter, filterSmmProductionRows, SMM_PRODUCTION_DEFAULT_FILTERS,
  formatFileCodeBase, formatFileCode, buildContentPlanPlatformCells, buildSmmCalendarEvents, filterSmmCalendarEvents,
  median, computeSmmAnalyticsAggregates, computeRecurringPayoutDueDates,
  type SmmPublicationPlatform,
} from './smm-model'
import type { SmmProjectDTO, SmmPackageItemDTO, SmmContentItemDTO, SmmProjectMemberDTO, SmmPublicationDTO, SmmPublicationMetricDTO } from './actions/smm'

function makePackageItem(overrides: Partial<SmmPackageItemDTO> = {}): SmmPackageItemDTO {
  return {
    id: 'pkg-1', smmProjectId: 'project-1', serviceType: 'SHORT_VIDEO', customName: null,
    quantity: 25, unit: 'PIECE', period: 'BILLING_PERIOD', description: null, included: true, sortOrder: 0,
    ...overrides,
  }
}

function makeContentItem(overrides: Partial<SmmContentItemDTO> = {}): SmmContentItemDTO {
  return {
    id: 'content-1', smmProjectId: 'project-1', serviceType: 'SHORT_VIDEO', customServiceType: null,
    title: 'Ролик', description: null, productionBrief: null, plannedPublishDate: null, deadline: null, status: 'IDEA',
    responsibleUserId: null, responsibleUserName: null, editorId: null, editorName: null,
    editingProjectId: null, editingProjectStatus: null, editingProjectStatusLabel: null, editingProjectDeliveryUrl: null,
    scheduleEventId: null, scheduleEvents: [], sourceUrl: null, resultUrl: null, publishedUrl: null, contentCode: null,
    editingProjectFileCode: null,
    parentContentId: null, parentContentTitle: null, parentContentCode: null, childContent: [], publications: [],
    clientApprovalStatus: 'NOT_REQUIRED', notes: null, createdAt: '2026-08-08T00:00:00.000Z', updatedAt: '2026-08-08T00:00:00.000Z',
    ...overrides,
  }
}

function makeMember(overrides: Partial<SmmProjectMemberDTO> = {}): SmmProjectMemberDTO {
  return {
    id: 'member-1', smmProjectId: 'project-1', userId: 'user-1', userName: 'Владелец',
    role: 'OTHER', activeFrom: '2026-08-08T00:00:00.000Z', activeTo: null, notes: null,
    ...overrides,
  }
}

function makeProject(overrides: Partial<SmmProjectDTO> = {}): SmmProjectDTO {
  return {
    id: 'project-1', clientId: 'client-1', clientName: 'Diamed', projectCode: 'DIA', status: 'ACTIVE', monthlyFee: 185000,
    currency: 'RUB', startDate: '2026-08-08T00:00:00.000Z', endDate: null, billingPeriodType: 'CUSTOM',
    paymentTerms: null, notes: null, createdAt: '2026-08-08T00:00:00.000Z', updatedAt: '2026-08-08T00:00:00.000Z',
    ...overrides,
  }
}

function makeMetric(overrides: Partial<SmmPublicationMetricDTO> = {}): SmmPublicationMetricDTO {
  return {
    id: 'metric-1', publicationId: 'pub-1', metricType: 'VIEWS', value: 100,
    capturedAt: '2026-08-08T00:00:00.000Z', source: 'MANUAL', createdAt: '2026-08-08T00:00:00.000Z',
    ...overrides,
  }
}

function makePublication(overrides: Partial<SmmPublicationDTO> = {}): SmmPublicationDTO {
  return {
    id: 'pub-1', contentItemId: 'content-1', platform: 'INSTAGRAM', customPlatform: null, status: 'PLANNED',
    plannedPublishAt: null, publishedAt: null, url: null, externalId: null, titleOverride: null, caption: null,
    notes: null, createdAt: '2026-08-08T00:00:00.000Z', updatedAt: '2026-08-08T00:00:00.000Z', metrics: [],
    ...overrides,
  }
}

describe('computeSmmBillingPeriod', () => {
  it('calendar month uses the 1st through the last day of the reference month', () => {
    const period = computeSmmBillingPeriod('2026-08-15', 'CALENDAR_MONTH', new Date(2026, 7, 20))
    expect(period.start).toEqual(new Date(2026, 7, 1))
    expect(period.end.getDate()).toBe(31)
    expect(period.end.getMonth()).toBe(7)
  })

  it('custom period anchors to the start date day-of-month — the ТЗ example (08.08–07.09)', () => {
    const period = computeSmmBillingPeriod('2026-08-08', 'CUSTOM', new Date(2026, 7, 20))
    expect(period.start).toEqual(new Date(2026, 7, 8))
    expect(period.end.getFullYear()).toBe(2026)
    expect(period.end.getMonth()).toBe(8)
    expect(period.end.getDate()).toBe(7)
  })

  it('custom period rolls back to the previous month when the anchor day has not yet occurred', () => {
    const period = computeSmmBillingPeriod('2026-08-08', 'CUSTOM', new Date(2026, 7, 3))
    expect(period.start).toEqual(new Date(2026, 6, 8))
    expect(period.end.getMonth()).toBe(7)
    expect(period.end.getDate()).toBe(7)
  })
})

describe('isWithinPeriod', () => {
  const period = { start: new Date(2026, 7, 8), end: new Date(2026, 8, 7, 23, 59, 59, 999) }

  it('returns false for null date', () => {
    expect(isWithinPeriod(null, period)).toBe(false)
  })

  it('returns true for a date inside the period', () => {
    expect(isWithinPeriod('2026-08-20', period)).toBe(true)
  })

  it('returns false for a date outside the period', () => {
    expect(isWithinPeriod('2026-07-20', period)).toBe(false)
  })
})

describe('computePackageProgress', () => {
  const period = { start: new Date(2026, 7, 8), end: new Date(2026, 8, 7, 23, 59, 59, 999) }

  it('counts content of the matching service type within the period, excluding cancelled', () => {
    const packageItems = [makePackageItem({ quantity: 25 })]
    const contentItems = [
      makeContentItem({ id: 'c1', plannedPublishDate: '2026-08-10' }),
      makeContentItem({ id: 'c2', plannedPublishDate: '2026-08-15' }),
      makeContentItem({ id: 'c3', plannedPublishDate: '2026-08-15', status: 'CANCELLED' }),
      makeContentItem({ id: 'c4', serviceType: 'LONG_VIDEO', plannedPublishDate: '2026-08-15' }),
    ]
    const progress = computePackageProgress(packageItems, contentItems, period)
    expect(progress).toHaveLength(1)
    expect(progress[0].done).toBe(2)
    expect(progress[0].target).toBe(25)
  })

  it('falls back to createdAt when plannedPublishDate is not set', () => {
    const packageItems = [makePackageItem({ quantity: 5 })]
    const contentItems = [makeContentItem({ plannedPublishDate: null, createdAt: '2026-08-10T00:00:00.000Z' })]
    const progress = computePackageProgress(packageItems, contentItems, period)
    expect(progress[0].done).toBe(1)
  })

  it('excludes package items not marked as included', () => {
    const packageItems = [makePackageItem({ included: false })]
    const progress = computePackageProgress(packageItems, [], period)
    expect(progress).toHaveLength(0)
  })

  it('keeps a null target for package items without a numeric quantity (discounts/free-text conditions)', () => {
    const packageItems = [makePackageItem({ serviceType: 'OTHER', quantity: null, description: 'Скидка 20%' })]
    const progress = computePackageProgress(packageItems, [], period)
    expect(progress[0].target).toBeNull()
  })
})

describe('isSmmContentOverdue', () => {
  const now = new Date(2026, 7, 20)

  it('is not overdue without a deadline', () => {
    expect(isSmmContentOverdue({ deadline: null, status: 'IN_EDIT' }, now)).toBe(false)
  })

  it('is overdue when the deadline has passed and the item is not published/cancelled', () => {
    expect(isSmmContentOverdue({ deadline: '2026-08-10', status: 'IN_EDIT' }, now)).toBe(true)
  })

  it('is not overdue once published, even past the deadline', () => {
    expect(isSmmContentOverdue({ deadline: '2026-08-10', status: 'PUBLISHED' }, now)).toBe(false)
  })

  it('is not overdue once cancelled, even past the deadline', () => {
    expect(isSmmContentOverdue({ deadline: '2026-08-10', status: 'CANCELLED' }, now)).toBe(false)
  })

  it('is not overdue when the deadline is in the future', () => {
    expect(isSmmContentOverdue({ deadline: '2026-08-25', status: 'IN_EDIT' }, now)).toBe(false)
  })
})

describe('getPrimaryResponsibleMember', () => {
  it('returns null when there are no active members', () => {
    expect(getPrimaryResponsibleMember([])).toBeNull()
  })

  it('ignores members whose membership has ended', () => {
    const members = [makeMember({ role: 'OWNER', activeTo: '2026-08-01T00:00:00.000Z' })]
    expect(getPrimaryResponsibleMember(members)).toBeNull()
  })

  it('prioritizes OWNER over STRATEGIST/SMM_MANAGER/EDITOR', () => {
    const members = [
      makeMember({ id: 'm1', role: 'EDITOR' }),
      makeMember({ id: 'm2', role: 'OWNER' }),
      makeMember({ id: 'm3', role: 'STRATEGIST' }),
    ]
    expect(getPrimaryResponsibleMember(members)?.id).toBe('m2')
  })

  it('falls back to STRATEGIST over SMM_MANAGER when there is no owner on the project', () => {
    const members = [
      makeMember({ id: 'm1', role: 'SMM_MANAGER' }),
      makeMember({ id: 'm2', role: 'STRATEGIST' }),
    ]
    expect(getPrimaryResponsibleMember(members)?.id).toBe('m2')
  })
})

describe('computeSmmMonthlyRevenue', () => {
  it('sums monthlyFee only for ACTIVE projects', () => {
    const projects = [
      makeProject({ id: 'p1', status: 'ACTIVE', monthlyFee: 185000 }),
      makeProject({ id: 'p2', status: 'PAUSED', monthlyFee: 100000 }),
      makeProject({ id: 'p3', status: 'ACTIVE', monthlyFee: 60000 }),
    ]
    expect(computeSmmMonthlyRevenue(projects)).toBe(245000)
  })

  it('treats a null monthlyFee as zero', () => {
    const projects = [makeProject({ status: 'ACTIVE', monthlyFee: null })]
    expect(computeSmmMonthlyRevenue(projects)).toBe(0)
  })

  it('returns 0 for an empty list', () => {
    expect(computeSmmMonthlyRevenue([])).toBe(0)
  })
})

describe('computePackageProgress — 2A regression: Publication count must not inflate progress', () => {
  it('counts one unit of progress per ContentItem regardless of how many Publication rows it conceptually has (SMM.md, «Content vs Publication»)', () => {
    const period = { start: new Date(2026, 7, 8), end: new Date(2026, 8, 7, 23, 59, 59, 999) }
    const packageItems = [makePackageItem({ quantity: 25 })]
    // Один и тот же ролик "опубликован" на 4 площадках — но это не поле
    // computePackageProgress вообще не принимает Publication на вход,
    // значит физически не может задвоить счёт по числу площадок.
    const contentItems = [
      makeContentItem({
        id: 'c1', plannedPublishDate: '2026-08-10',
        publications: [
          makePublication({ id: 'p1', platform: 'INSTAGRAM' }),
          makePublication({ id: 'p2', platform: 'TELEGRAM' }),
          makePublication({ id: 'p3', platform: 'VK' }),
          makePublication({ id: 'p4', platform: 'YOUTUBE' }),
        ],
      }),
    ]
    const progress = computePackageProgress(packageItems, contentItems, period)
    expect(progress[0].done).toBe(1)
  })
})

describe('wouldCreateContentParentCycle', () => {
  it('rejects direct self-reference (A → A)', () => {
    expect(wouldCreateContentParentCycle([{ id: 'a', parentContentId: null }], 'a', 'a')).toBe(true)
  })

  it('allows a legitimate parent assignment with no cycle', () => {
    const items = [{ id: 'a', parentContentId: null }, { id: 'b', parentContentId: null }]
    expect(wouldCreateContentParentCycle(items, 'b', 'a')).toBe(false)
  })

  it('rejects an indirect cycle (A → B → A)', () => {
    // b уже указывает на a как на родителя; попытка сделать a ребёнком b создаёт цикл.
    const items = [{ id: 'a', parentContentId: null }, { id: 'b', parentContentId: 'a' }]
    expect(wouldCreateContentParentCycle(items, 'a', 'b')).toBe(true)
  })

  it('rejects a longer cycle (A → B → C → A)', () => {
    const items = [
      { id: 'a', parentContentId: null },
      { id: 'b', parentContentId: 'a' },
      { id: 'c', parentContentId: 'b' },
    ]
    expect(wouldCreateContentParentCycle(items, 'a', 'c')).toBe(true)
  })

  it('allows clearing the parent (null never creates a cycle)', () => {
    const items = [{ id: 'a', parentContentId: null }]
    expect(wouldCreateContentParentCycle(items, 'a', null)).toBe(false)
  })

  it('allows the same parent to have multiple independent children (not a cycle)', () => {
    const items = [{ id: 'parent', parentContentId: null }, { id: 'child1', parentContentId: 'parent' }, { id: 'child2', parentContentId: null }]
    expect(wouldCreateContentParentCycle(items, 'child2', 'parent')).toBe(false)
  })
})

describe('getLatestMetricByType', () => {
  it('returns an empty object for no metrics', () => {
    expect(getLatestMetricByType([])).toEqual({})
  })

  it('keeps the most recent snapshot per metricType — history is not lost, just not shown in the compact summary', () => {
    const metrics = [
      makeMetric({ id: 'm1', metricType: 'VIEWS', value: 12000, capturedAt: '2026-08-10T00:00:00.000Z' }),
      makeMetric({ id: 'm2', metricType: 'VIEWS', value: 18400, capturedAt: '2026-08-17T00:00:00.000Z' }),
      makeMetric({ id: 'm3', metricType: 'VIEWS', value: 25100, capturedAt: '2026-08-31T00:00:00.000Z' }),
    ]
    const latest = getLatestMetricByType(metrics)
    expect(latest.VIEWS?.id).toBe('m3')
    expect(latest.VIEWS?.value).toBe(25100)
  })

  it('tracks each metricType independently', () => {
    const metrics = [
      makeMetric({ id: 'm1', metricType: 'VIEWS', value: 25516 }),
      makeMetric({ id: 'm2', metricType: 'COMMENTS', value: 45 }),
      makeMetric({ id: 'm3', metricType: 'SHARES', value: 194 }),
      makeMetric({ id: 'm4', metricType: 'FOLLOWERS_GAINED', value: 55 }),
    ]
    const latest = getLatestMetricByType(metrics)
    expect(latest.VIEWS?.value).toBe(25516)
    expect(latest.COMMENTS?.value).toBe(45)
    expect(latest.SHARES?.value).toBe(194)
    expect(latest.FOLLOWERS_GAINED?.value).toBe(55)
  })

  it('is order-independent — an out-of-order snapshot list still resolves the true latest by capturedAt', () => {
    const metrics = [
      makeMetric({ id: 'newer', metricType: 'VIEWS', value: 999, capturedAt: '2026-08-31T00:00:00.000Z' }),
      makeMetric({ id: 'older', metricType: 'VIEWS', value: 1, capturedAt: '2026-08-01T00:00:00.000Z' }),
    ]
    expect(getLatestMetricByType(metrics).VIEWS?.id).toBe('newer')
  })
})

describe('CONTENT_SERVICE_TYPES', () => {
  it('excludes package-only contractual service types (they are not a produced content format)', () => {
    for (const t of ['STUDIO_SHOOT', 'LOCATION_SHOOT', 'SHOOTING_HOURS', 'CONTENT_PLAN', 'PUBLICATION', 'DESIGN']) {
      expect(CONTENT_SERVICE_TYPES).not.toContain(t)
    }
  })

  it('includes the minimum content formats required by ТЗ 2A п.22', () => {
    for (const t of ['SHORT_VIDEO', 'LONG_VIDEO', 'POST', 'CAROUSEL', 'STORY', 'TEASER', 'OTHER']) {
      expect(CONTENT_SERVICE_TYPES).toContain(t)
    }
  })
})

// ============================================================
// PRODUCTION (2B) — pure helpers, ТЗ 2B п.55.
// ============================================================

describe('getContentMontageShortState', () => {
  it('returns "Не создан" when there is no editing project yet', () => {
    expect(getContentMontageShortState(null)).toBe('Не создан')
  })

  it('groups NEW/IN_PROGRESS as "В работе"', () => {
    expect(getContentMontageShortState('NEW')).toBe('В работе')
    expect(getContentMontageShortState('IN_PROGRESS')).toBe('В работе')
  })

  it('groups IN_REVIEW/REVISIONS as "На проверке"', () => {
    expect(getContentMontageShortState('IN_REVIEW')).toBe('На проверке')
    expect(getContentMontageShortState('REVISIONS')).toBe('На проверке')
  })

  it('reports DELIVERED as "Готово"', () => {
    expect(getContentMontageShortState('DELIVERED')).toBe('Готово')
  })

  it('reports CANCELLED as "Отменён"', () => {
    expect(getContentMontageShortState('CANCELLED')).toBe('Отменён')
  })
})

describe('getNearestPublicationInfo', () => {
  it('returns null when there are no publications', () => {
    expect(getNearestPublicationInfo([])).toBeNull()
  })

  it('ignores CANCELLED publications entirely', () => {
    const result = getNearestPublicationInfo([{ plannedPublishAt: '2026-08-20', status: 'CANCELLED' }])
    expect(result).toBeNull()
  })

  it('returns null when active publications have no planned date', () => {
    const result = getNearestPublicationInfo([{ plannedPublishAt: null, status: 'PLANNED' }])
    expect(result).toBeNull()
  })

  it('picks the earliest planned date among active publications', () => {
    const result = getNearestPublicationInfo([
      { plannedPublishAt: '2026-08-25', status: 'PLANNED' },
      { plannedPublishAt: '2026-08-20', status: 'READY' },
    ])
    expect(result?.date).toBe('2026-08-20')
  })

  it('platformCount counts ALL active publications, not just those sharing the nearest date', () => {
    const result = getNearestPublicationInfo([
      { plannedPublishAt: '2026-08-20', status: 'PLANNED' },
      { plannedPublishAt: '2026-08-25', status: 'PLANNED' },
      { plannedPublishAt: null, status: 'CANCELLED' },
    ])
    expect(result?.platformCount).toBe(2)
  })
})

describe('computeContentMaterialsIndicator', () => {
  it('reports no source/master for an empty list', () => {
    expect(computeContentMaterialsIndicator([])).toEqual({ hasSource: false, hasMaster: false })
  })

  it('detects source materials by materialType', () => {
    const r = computeContentMaterialsIndicator([{ materialType: 'SOURCE_VIDEO', category: 'SOURCE' }])
    expect(r.hasSource).toBe(true)
    expect(r.hasMaster).toBe(false)
  })

  it('detects source materials by category when materialType is null', () => {
    const r = computeContentMaterialsIndicator([{ materialType: null, category: 'SOURCE_SORTED' }])
    expect(r.hasSource).toBe(true)
  })

  it('detects master material by materialType MASTER', () => {
    const r = computeContentMaterialsIndicator([{ materialType: 'MASTER', category: 'FINISHED_SHORT' }])
    expect(r.hasMaster).toBe(true)
  })

  it('detects master material by finished categories even without materialType', () => {
    const r = computeContentMaterialsIndicator([{ materialType: null, category: 'FINISHED_LONG' }])
    expect(r.hasMaster).toBe(true)
  })
})

function attentionInput(overrides: Partial<Parameters<typeof getSmmContentAttentionReasons>[0]> = {}) {
  return {
    status: 'IN_EDIT' as const,
    deadline: null,
    editingProjectStatus: null,
    editingProjectDeadlineDate: null,
    editingProjectEditorId: null,
    hasSourceMaterials: true,
    publications: [],
    ...overrides,
  }
}

describe('getSmmContentAttentionReasons', () => {
  const now = new Date(2026, 7, 20)

  it('returns no reasons once PUBLISHED, even with an overdue deadline', () => {
    expect(getSmmContentAttentionReasons(attentionInput({ status: 'PUBLISHED', deadline: '2026-08-01' }), now)).toEqual([])
  })

  it('returns no reasons once CANCELLED', () => {
    expect(getSmmContentAttentionReasons(attentionInput({ status: 'CANCELLED', deadline: '2026-08-01' }), now)).toEqual([])
  })

  it('flags OVERDUE_PRODUCTION when ContentItem.deadline has passed', () => {
    const reasons = getSmmContentAttentionReasons(attentionInput({ status: 'SHOT', deadline: '2026-08-10' }), now)
    expect(reasons).toContain('OVERDUE_PRODUCTION')
  })

  it('uses MontageProject.deadlineDate instead of ContentItem.deadline while IN_EDIT', () => {
    // ContentItem.deadline давно прошёл, но реальный срок держит монтаж — он ещё не наступил.
    const reasons = getSmmContentAttentionReasons(attentionInput({
      status: 'IN_EDIT', deadline: '2026-08-01', editingProjectDeadlineDate: '2026-08-25',
    }), now)
    expect(reasons).not.toContain('OVERDUE_PRODUCTION')
  })

  it('flags OVERDUE_PUBLICATION for a past-due, non-published/non-cancelled publication', () => {
    const reasons = getSmmContentAttentionReasons(attentionInput({
      publications: [{ status: 'PLANNED', plannedPublishAt: '2026-08-10', url: null }],
    }), now)
    expect(reasons).toContain('OVERDUE_PUBLICATION')
  })

  it('does not flag a publication planned for tomorrow as overdue', () => {
    const reasons = getSmmContentAttentionReasons(attentionInput({
      publications: [{ status: 'PLANNED', plannedPublishAt: '2026-08-21', url: null }],
    }), now)
    expect(reasons).not.toContain('OVERDUE_PUBLICATION')
  })

  it('flags NO_EDITOR_IN_EDIT when IN_EDIT without an assigned MontageProject editor', () => {
    const reasons = getSmmContentAttentionReasons(attentionInput({ status: 'IN_EDIT', editingProjectEditorId: null }), now)
    expect(reasons).toContain('NO_EDITOR_IN_EDIT')
  })

  it('does not flag NO_EDITOR_IN_EDIT for statuses outside of IN_EDIT', () => {
    const reasons = getSmmContentAttentionReasons(attentionInput({ status: 'IDEA', editingProjectEditorId: null }), now)
    expect(reasons).not.toContain('NO_EDITOR_IN_EDIT')
  })

  it('flags NO_SOURCE_MATERIALS once a shoot is expected/done but nothing was uploaded', () => {
    const reasons = getSmmContentAttentionReasons(attentionInput({ status: 'SHOT', hasSourceMaterials: false }), now)
    expect(reasons).toContain('NO_SOURCE_MATERIALS')
  })

  it('does not flag NO_SOURCE_MATERIALS while still at IDEA/PLANNED (nothing to upload yet)', () => {
    const reasons = getSmmContentAttentionReasons(attentionInput({ status: 'IDEA', hasSourceMaterials: false }), now)
    expect(reasons).not.toContain('NO_SOURCE_MATERIALS')
  })

  it('flags PUBLICATION_READY_NO_URL when a READY publication is past its planned date without a URL', () => {
    const reasons = getSmmContentAttentionReasons(attentionInput({
      publications: [{ status: 'READY', plannedPublishAt: '2026-08-10', url: null }],
    }), now)
    expect(reasons).toContain('PUBLICATION_READY_NO_URL')
  })

  it('does not flag PUBLICATION_READY_NO_URL once a URL is present', () => {
    const reasons = getSmmContentAttentionReasons(attentionInput({
      publications: [{ status: 'READY', plannedPublishAt: '2026-08-10', url: 'https://instagram.com/p/x' }],
    }), now)
    expect(reasons).not.toContain('PUBLICATION_READY_NO_URL')
  })

  it('can return multiple simultaneous reasons', () => {
    const reasons = getSmmContentAttentionReasons(attentionInput({
      status: 'IN_EDIT', deadline: '2026-08-01', editingProjectEditorId: null, hasSourceMaterials: false,
    }), now)
    expect(reasons).toEqual(expect.arrayContaining(['OVERDUE_PRODUCTION', 'NO_EDITOR_IN_EDIT', 'NO_SOURCE_MATERIALS']))
  })
})

describe('isSmmContentOperationallyOverdue', () => {
  const now = new Date(2026, 7, 20)

  it('is derived from the SAME reasons as getSmmContentAttentionReasons, not a second formula', () => {
    const input = attentionInput({ status: 'SHOT', deadline: '2026-08-10' })
    expect(isSmmContentOperationallyOverdue(input, now)).toBe(
      getSmmContentAttentionReasons(input, now).includes('OVERDUE_PRODUCTION'),
    )
  })

  it('is false when nothing is overdue', () => {
    expect(isSmmContentOperationallyOverdue(attentionInput({ status: 'IDEA' }), now)).toBe(false)
  })

  it('is true for an overdue publication even without an overdue production deadline', () => {
    const input = attentionInput({
      status: 'SCHEDULED', publications: [{ status: 'PLANNED', plannedPublishAt: '2026-08-10', url: null }],
    })
    expect(isSmmContentOperationallyOverdue(input, now)).toBe(true)
  })
})

function sortableRow(overrides: Partial<ReturnType<typeof baseSortableRow>> = {}) {
  return { ...baseSortableRow(), ...overrides }
}
function baseSortableRow() {
  return { id: 'x', isOverdue: false, sortDeadline: null as string | null, nearestPublicationDate: null as string | null, createdAt: '2026-08-01T00:00:00.000Z' }
}

describe('sortSmmProductionRowsDefault', () => {
  it('puts overdue rows before everything else, regardless of deadline proximity', () => {
    const rows = [
      sortableRow({ id: 'soon', isOverdue: false, sortDeadline: '2026-08-21T00:00:00.000Z' }),
      sortableRow({ id: 'overdue', isOverdue: true, sortDeadline: '2026-09-01T00:00:00.000Z' }),
    ]
    expect(sortSmmProductionRowsDefault(rows).map(r => r.id)).toEqual(['overdue', 'soon'])
  })

  it('orders by nearest sortDeadline when overdue status is equal', () => {
    const rows = [
      sortableRow({ id: 'later', sortDeadline: '2026-09-01T00:00:00.000Z' }),
      sortableRow({ id: 'sooner', sortDeadline: '2026-08-21T00:00:00.000Z' }),
    ]
    expect(sortSmmProductionRowsDefault(rows).map(r => r.id)).toEqual(['sooner', 'later'])
  })

  it('falls back to nearest publication date when there is no deadline', () => {
    const rows = [
      sortableRow({ id: 'later-pub', nearestPublicationDate: '2026-09-01T00:00:00.000Z' }),
      sortableRow({ id: 'sooner-pub', nearestPublicationDate: '2026-08-21T00:00:00.000Z' }),
    ]
    expect(sortSmmProductionRowsDefault(rows).map(r => r.id)).toEqual(['sooner-pub', 'later-pub'])
  })

  it('finally falls back to createdAt (oldest first) for rows with no date at all', () => {
    const rows = [
      sortableRow({ id: 'newer', createdAt: '2026-08-15T00:00:00.000Z' }),
      sortableRow({ id: 'older', createdAt: '2026-08-01T00:00:00.000Z' }),
    ]
    expect(sortSmmProductionRowsDefault(rows).map(r => r.id)).toEqual(['older', 'newer'])
  })
})

describe('computeSmmProductionKpis', () => {
  function kpiRow(status: string, isOverdue = false) {
    return { status: status as never, isOverdue }
  }

  it('groups IDEA/PLANNED/WAITING_FOR_SHOOT/SHOT under inProgress', () => {
    const rows = [kpiRow('IDEA'), kpiRow('PLANNED'), kpiRow('WAITING_FOR_SHOOT'), kpiRow('SHOT')]
    expect(computeSmmProductionKpis(rows).inProgress).toBe(4)
  })

  it('counts IN_EDIT/REVIEW separately', () => {
    const rows = [kpiRow('IN_EDIT'), kpiRow('IN_EDIT'), kpiRow('REVIEW')]
    const kpis = computeSmmProductionKpis(rows)
    expect(kpis.inEdit).toBe(2)
    expect(kpis.inReview).toBe(1)
  })

  it('groups APPROVED/SCHEDULED under readyToPublish', () => {
    const rows = [kpiRow('APPROVED'), kpiRow('SCHEDULED')]
    expect(computeSmmProductionKpis(rows).readyToPublish).toBe(2)
  })

  it('counts overdue independently of status', () => {
    const rows = [kpiRow('IN_EDIT', true), kpiRow('REVIEW', true), kpiRow('PUBLISHED', false)]
    expect(computeSmmProductionKpis(rows).overdue).toBe(2)
  })
})

describe('matchesSmmProductionDateFilter', () => {
  const now = new Date(2026, 7, 20) // четверг, 20.08.2026

  it('ALL matches everything', () => {
    expect(matchesSmmProductionDateFilter({ sortDeadline: null, nearestPublicationDate: null, isOverdue: false }, 'ALL', now)).toBe(true)
  })

  it('OVERDUE reads the derived isOverdue flag, not a recomputed date check', () => {
    expect(matchesSmmProductionDateFilter({ sortDeadline: '2026-09-01', nearestPublicationDate: null, isOverdue: true }, 'OVERDUE', now)).toBe(true)
    expect(matchesSmmProductionDateFilter({ sortDeadline: '2026-08-01', nearestPublicationDate: null, isOverdue: false }, 'OVERDUE', now)).toBe(false)
  })

  it('NONE matches rows with neither deadline nor publication date', () => {
    expect(matchesSmmProductionDateFilter({ sortDeadline: null, nearestPublicationDate: null, isOverdue: false }, 'NONE', now)).toBe(true)
    expect(matchesSmmProductionDateFilter({ sortDeadline: '2026-08-20', nearestPublicationDate: null, isOverdue: false }, 'NONE', now)).toBe(false)
  })

  it('TODAY matches the same calendar day as now', () => {
    expect(matchesSmmProductionDateFilter({ sortDeadline: '2026-08-20T15:00:00.000Z', nearestPublicationDate: null, isOverdue: false }, 'TODAY', now)).toBe(true)
    expect(matchesSmmProductionDateFilter({ sortDeadline: '2026-08-21', nearestPublicationDate: null, isOverdue: false }, 'TODAY', now)).toBe(false)
  })

  it('WEEK matches the current Monday-Sunday week', () => {
    expect(matchesSmmProductionDateFilter({ sortDeadline: '2026-08-23', nearestPublicationDate: null, isOverdue: false }, 'WEEK', now)).toBe(true)
    expect(matchesSmmProductionDateFilter({ sortDeadline: '2026-08-25', nearestPublicationDate: null, isOverdue: false }, 'WEEK', now)).toBe(false)
  })

  it('MONTH matches the current calendar month', () => {
    expect(matchesSmmProductionDateFilter({ sortDeadline: '2026-08-31', nearestPublicationDate: null, isOverdue: false }, 'MONTH', now)).toBe(true)
    expect(matchesSmmProductionDateFilter({ sortDeadline: '2026-09-01', nearestPublicationDate: null, isOverdue: false }, 'MONTH', now)).toBe(false)
  })

  it('falls back to nearestPublicationDate when there is no sortDeadline', () => {
    expect(matchesSmmProductionDateFilter({ sortDeadline: null, nearestPublicationDate: '2026-08-20', isOverdue: false }, 'TODAY', now)).toBe(true)
  })
})

function productionRow(overrides: Partial<Parameters<typeof filterSmmProductionRows>[0][number]> = {}) {
  return {
    smmProjectId: 'project-1', clientName: 'Diamed', fileCode: '2026.08.09-DIA-AH-001-V01', title: 'Ролик про УЗИ',
    status: 'IN_EDIT' as const, serviceType: 'SHORT_VIDEO' as const, editorId: null as string | null, publicationPlatforms: [] as SmmPublicationPlatform[],
    sortDeadline: null, nearestPublicationDate: null, isOverdue: false,
    ...overrides,
  }
}

describe('filterSmmProductionRows', () => {
  it('with default filters keeps every row unchanged', () => {
    const rows = [productionRow({ smmProjectId: 'a' }), productionRow({ smmProjectId: 'b' })]
    expect(filterSmmProductionRows(rows, SMM_PRODUCTION_DEFAULT_FILTERS)).toHaveLength(2)
  })

  it('search matches fileCode, title, or client name (case-insensitive)', () => {
    const rows = [productionRow({ fileCode: '2026.08.09-DIA-AH-001-V01', title: 'Ролик про УЗИ', clientName: 'Diamed' })]
    expect(filterSmmProductionRows(rows, { ...SMM_PRODUCTION_DEFAULT_FILTERS, search: 'узи' })).toHaveLength(1)
    expect(filterSmmProductionRows(rows, { ...SMM_PRODUCTION_DEFAULT_FILTERS, search: 'diamed' })).toHaveLength(1)
    expect(filterSmmProductionRows(rows, { ...SMM_PRODUCTION_DEFAULT_FILTERS, search: 'нет такого' })).toHaveLength(0)
  })

  it('filters by smmProjectId (client)', () => {
    const rows = [productionRow({ smmProjectId: 'a' }), productionRow({ smmProjectId: 'b' })]
    expect(filterSmmProductionRows(rows, { ...SMM_PRODUCTION_DEFAULT_FILTERS, smmProjectId: 'a' })).toHaveLength(1)
  })

  it('filters by status', () => {
    const rows = [productionRow({ status: 'IN_EDIT' }), productionRow({ status: 'REVIEW' })]
    expect(filterSmmProductionRows(rows, { ...SMM_PRODUCTION_DEFAULT_FILTERS, status: 'REVIEW' })).toHaveLength(1)
  })

  it('filters by editorId', () => {
    const rows = [productionRow({ editorId: 'ed-1' }), productionRow({ editorId: 'ed-2' })]
    expect(filterSmmProductionRows(rows, { ...SMM_PRODUCTION_DEFAULT_FILTERS, editorId: 'ed-1' })).toHaveLength(1)
  })

  it('filters by platform — matches rows that have a publication on that platform', () => {
    const rows = [
      productionRow({ publicationPlatforms: ['INSTAGRAM'] }),
      productionRow({ publicationPlatforms: ['TELEGRAM'] }),
    ]
    expect(filterSmmProductionRows(rows, { ...SMM_PRODUCTION_DEFAULT_FILTERS, platform: 'INSTAGRAM' })).toHaveLength(1)
  })

  it('readyToPublishOnly keeps only APPROVED/SCHEDULED (matches the KPI grouping)', () => {
    const rows = [productionRow({ status: 'APPROVED' }), productionRow({ status: 'SCHEDULED' }), productionRow({ status: 'IN_EDIT' })]
    expect(filterSmmProductionRows(rows, { ...SMM_PRODUCTION_DEFAULT_FILTERS, readyToPublishOnly: true })).toHaveLength(2)
  })

  it('combines multiple filters with AND semantics', () => {
    const rows = [
      productionRow({ smmProjectId: 'a', status: 'IN_EDIT' }),
      productionRow({ smmProjectId: 'a', status: 'REVIEW' }),
      productionRow({ smmProjectId: 'b', status: 'IN_EDIT' }),
    ]
    const result = filterSmmProductionRows(rows, { ...SMM_PRODUCTION_DEFAULT_FILTERS, smmProjectId: 'a', status: 'IN_EDIT' })
    expect(result).toHaveLength(1)
  })
})

describe('formatFileCodeBase / formatFileCode', () => {
  it('builds the base as date-projectCode-editorCode-sequence(3 digits)', () => {
    expect(formatFileCodeBase(new Date(2026, 7, 9), 'DIA', 'AH', 17)).toBe('2026.08.09-DIA-AH-017')
  })

  it('pads a single-digit sequence to 3 digits', () => {
    expect(formatFileCodeBase(new Date(2026, 7, 9), 'DIA', 'AH', 1)).toBe('2026.08.09-DIA-AH-001')
  })

  it('pads day/month to 2 digits', () => {
    expect(formatFileCodeBase(new Date(2026, 0, 5), 'DIA', 'AH', 1)).toBe('2026.01.05-DIA-AH-001')
  })

  it('appends the version suffix, padded to 2 digits', () => {
    expect(formatFileCode('2026.08.09-DIA-AH-001', 1)).toBe('2026.08.09-DIA-AH-001-V01')
    expect(formatFileCode('2026.08.09-DIA-AH-001', 12)).toBe('2026.08.09-DIA-AH-001-V12')
  })
})

describe('buildContentPlanPlatformCells', () => {
  function pub(overrides: Partial<Parameters<typeof buildContentPlanPlatformCells>[0][number]> = {}) {
    return {
      id: 'pub-1', platform: 'INSTAGRAM' as SmmPublicationPlatform, status: 'PLANNED' as const,
      plannedPublishAt: '2026-08-10T00:00:00.000Z', publishedAt: null, url: null,
      ...overrides,
    }
  }

  it('puts each platform into its own cell', () => {
    const cells = buildContentPlanPlatformCells([pub({ platform: 'INSTAGRAM' }), pub({ id: 'pub-2', platform: 'TELEGRAM' })])
    expect(cells.INSTAGRAM?.publicationId).toBe('pub-1')
    expect(cells.TELEGRAM?.publicationId).toBe('pub-2')
    expect(cells.VK).toBeUndefined()
  })

  it('when a platform has several publications, keeps the one with the nearest plannedPublishAt', () => {
    const cells = buildContentPlanPlatformCells([
      pub({ id: 'far', plannedPublishAt: '2026-08-20T00:00:00.000Z' }),
      pub({ id: 'near', plannedPublishAt: '2026-08-10T00:00:00.000Z' }),
    ])
    expect(cells.INSTAGRAM?.publicationId).toBe('near')
  })

  it('prefers a publication with a known date over one with none', () => {
    const cells = buildContentPlanPlatformCells([
      pub({ id: 'no-date', plannedPublishAt: null }),
      pub({ id: 'has-date', plannedPublishAt: '2026-08-10T00:00:00.000Z' }),
    ])
    expect(cells.INSTAGRAM?.publicationId).toBe('has-date')
  })
})

describe('buildSmmCalendarEvents', () => {
  it('merges publications/shoots/deadlines into one list sorted by date', () => {
    const events = buildSmmCalendarEvents({
      publications: [{ id: 'p1', date: '2026-08-15', title: 'Публикация', smmProjectId: 'a', clientName: 'Diamed', contentItemId: 'c1', platform: 'INSTAGRAM' }],
      shoots: [{ id: 's1', date: '2026-08-10', title: 'Съёмка', smmProjectId: 'a', clientName: 'Diamed', scheduleEventId: 'ev1', orderId: 'ord1' }],
      deadlines: [{ id: 'd1', date: '2026-08-12', title: 'Дедлайн монтажа', smmProjectId: 'a', clientName: 'Diamed', contentItemId: 'c1' }],
    })
    expect(events.map(e => e.kind)).toEqual(['SHOOT', 'DEADLINE', 'PUBLICATION'])
    expect(events[0].id).toBe('shoot-s1')
    expect(events[0].orderId).toBe('ord1')
    expect(events[2].platform).toBe('INSTAGRAM')
  })

  it('returns an empty list when nothing is passed', () => {
    expect(buildSmmCalendarEvents({ publications: [], shoots: [], deadlines: [] })).toEqual([])
  })
})

describe('filterSmmCalendarEvents', () => {
  const events = buildSmmCalendarEvents({
    publications: [{ id: 'p1', date: '2026-08-15', title: 'Публикация', smmProjectId: 'a', clientName: 'Diamed', contentItemId: 'c1', platform: 'INSTAGRAM' }],
    shoots: [{ id: 's1', date: '2026-08-10', title: 'Съёмка', smmProjectId: 'b', clientName: 'ТОК', scheduleEventId: 'ev1', orderId: null }],
    deadlines: [],
  })

  it('ALL/ALL/ALL keeps everything', () => {
    expect(filterSmmCalendarEvents(events, { smmProjectId: 'ALL', kind: 'ALL', platform: 'ALL' })).toHaveLength(2)
  })

  it('filters by smmProjectId', () => {
    expect(filterSmmCalendarEvents(events, { smmProjectId: 'a', kind: 'ALL', platform: 'ALL' })).toHaveLength(1)
  })

  it('filters by kind', () => {
    expect(filterSmmCalendarEvents(events, { smmProjectId: 'ALL', kind: 'SHOOT', platform: 'ALL' })).toHaveLength(1)
  })

  it('filters by platform (only matches events that carry that platform)', () => {
    expect(filterSmmCalendarEvents(events, { smmProjectId: 'ALL', kind: 'ALL', platform: 'INSTAGRAM' })).toHaveLength(1)
  })
})

describe('median', () => {
  it('returns 0 for an empty array', () => {
    expect(median([])).toBe(0)
  })

  it('returns the single value for one element', () => {
    expect(median([42])).toBe(42)
  })

  it('returns the middle value for an odd-length array (order-independent)', () => {
    expect(median([5, 1, 3])).toBe(3)
  })

  it('averages the two middle values for an even-length array', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5)
  })
})

describe('computeSmmAnalyticsAggregates', () => {
  function row(overrides: Partial<Parameters<typeof computeSmmAnalyticsAggregates>[0][number]> = {}) {
    return { status: 'PUBLISHED' as const, title: 'Ролик', latestViews: 100, latestFollowersGained: 5, ...overrides }
  }

  it('counts only PUBLISHED rows', () => {
    const result = computeSmmAnalyticsAggregates([row({ status: 'PUBLISHED' }), row({ status: 'PLANNED' })])
    expect(result.publishedCount).toBe(1)
  })

  it('sums totalViews and computes averageViews/medianViews from published rows with known views', () => {
    const result = computeSmmAnalyticsAggregates([row({ latestViews: 100 }), row({ latestViews: 300 }), row({ latestViews: null })])
    expect(result.totalViews).toBe(400)
    expect(result.averageViews).toBe(200)
    expect(result.medianViews).toBe(200)
  })

  it('picks the best content by highest latestViews', () => {
    const result = computeSmmAnalyticsAggregates([
      row({ title: 'Слабый', latestViews: 50 }),
      row({ title: 'Хит', latestViews: 900 }),
    ])
    expect(result.bestContentTitle).toBe('Хит')
    expect(result.bestContentViews).toBe(900)
  })

  it('sums followersGained across published rows only', () => {
    const result = computeSmmAnalyticsAggregates([row({ latestFollowersGained: 5 }), row({ latestFollowersGained: 3, status: 'PLANNED' })])
    expect(result.followersGained).toBe(5)
  })

  it('handles an empty list without dividing by zero', () => {
    const result = computeSmmAnalyticsAggregates([])
    expect(result).toEqual({
      publishedCount: 0, totalViews: 0, averageViews: 0, medianViews: 0,
      bestContentTitle: null, bestContentViews: null, followersGained: 0,
    })
  })
})

describe('computeRecurringPayoutDueDates', () => {
  it('produces one date per configured day of month, within the period', () => {
    const dates = computeRecurringPayoutDueDates(
      { daysOfMonth: [2, 17], startDate: '2026-01-01T00:00:00.000Z', endDate: null },
      new Date(2026, 7, 1), new Date(2026, 7, 31, 23, 59, 59),
    )
    expect(dates.map(d => d.getDate())).toEqual([2, 17])
  })

  it('clamps a day beyond the month length to the last day of that month', () => {
    const dates = computeRecurringPayoutDueDates(
      { daysOfMonth: [31], startDate: '2026-01-01T00:00:00.000Z', endDate: null },
      new Date(2026, 1, 1), new Date(2026, 1, 28, 23, 59, 59),
    )
    expect(dates).toHaveLength(1)
    expect(dates[0].getDate()).toBe(28)
  })

  it('excludes occurrences before startDate', () => {
    const dates = computeRecurringPayoutDueDates(
      { daysOfMonth: [2, 17], startDate: '2026-08-10T00:00:00.000Z', endDate: null },
      new Date(2026, 7, 1), new Date(2026, 7, 31, 23, 59, 59),
    )
    expect(dates.map(d => d.getDate())).toEqual([17])
  })

  it('excludes occurrences after endDate', () => {
    const dates = computeRecurringPayoutDueDates(
      { daysOfMonth: [2, 17], startDate: '2026-01-01T00:00:00.000Z', endDate: '2026-08-05T00:00:00.000Z' },
      new Date(2026, 7, 1), new Date(2026, 7, 31, 23, 59, 59),
    )
    expect(dates.map(d => d.getDate())).toEqual([2])
  })

  it('returns an empty array when daysOfMonth is empty', () => {
    const dates = computeRecurringPayoutDueDates(
      { daysOfMonth: [], startDate: '2026-01-01T00:00:00.000Z', endDate: null },
      new Date(2026, 7, 1), new Date(2026, 7, 31),
    )
    expect(dates).toEqual([])
  })

  it('spans multiple months within the requested period', () => {
    const dates = computeRecurringPayoutDueDates(
      { daysOfMonth: [15], startDate: '2026-01-01T00:00:00.000Z', endDate: null },
      new Date(2026, 6, 1), new Date(2026, 8, 30, 23, 59, 59),
    )
    expect(dates).toHaveLength(3)
  })
})
