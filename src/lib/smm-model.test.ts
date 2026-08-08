import { describe, it, expect } from 'vitest'
import {
  computeSmmBillingPeriod, isWithinPeriod, computePackageProgress,
  isSmmContentOverdue, getPrimaryResponsibleMember, computeSmmMonthlyRevenue,
  wouldCreateContentParentCycle, getLatestMetricByType, CONTENT_SERVICE_TYPES,
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
    id: 'project-1', clientId: 'client-1', clientName: 'Diamed', status: 'ACTIVE', monthlyFee: 185000,
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
