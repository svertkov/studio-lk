import { describe, it, expect } from 'vitest'
import {
  computeMontageProfit, computeMontageMargin,
  classifyMontageContentType,
  computeMontageDeadline, isMontageOverdue, montageDeadlineLabel,
  getMontageSourceMaterialsUrl,
  getMontageMaterialsState, getMontageMaterialsMissingFields, MONTAGE_MATERIALS_TRACKING_START_DATE,
  type MontageMaterialsStateInput,
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

describe('classifyMontageContentType — категоризация по названию проекта', () => {
  it('classifies a podcast title', () => {
    expect(classifyMontageContentType('Монтаж подкаста от 07.10.2025')).toEqual({ contentType: 'PODCAST', customContentType: null })
  })

  it('classifies "ГГ" abbreviation as TALKING_HEAD — real historical title, regression for \\b-vs-кириллица', () => {
    // \b не работает вокруг кириллицы в JS без /u (буквы кириллицы — не \w),
    // поэтому \bгг\b раньше тихо никогда не совпадал — нашли на реальных
    // исторических данных ("Монтаж ГГ от 03.11.2025" уходил в OTHER).
    expect(classifyMontageContentType('Монтаж ГГ от 03.11.2025')).toEqual({ contentType: 'TALKING_HEAD', customContentType: null })
  })

  it('classifies full "говорящая голова" wording as TALKING_HEAD', () => {
    expect(classifyMontageContentType('Монтаж говорящей головы по материалам').contentType).toBe('TALKING_HEAD')
  })

  it('classifies "видеовизитка" as TALKING_HEAD', () => {
    expect(classifyMontageContentType('Монтаж видеовизитки').contentType).toBe('TALKING_HEAD')
  })

  it('classifies reels as SHORT_FORM', () => {
    expect(classifyMontageContentType('Монтаж 5 рилсов от 03.11.2025').contentType).toBe('SHORT_FORM')
  })

  it('prefers SHORT_FORM over PODCAST when both keywords are present (ТЗ: "Два рилса по подкасту")', () => {
    expect(classifyMontageContentType('Два рилса по подкасту от 06.12.2025').contentType).toBe('SHORT_FORM')
  })

  it('classifies a musical jingle as MOTION_DESIGN (ТЗ example)', () => {
    expect(classifyMontageContentType('Музыкальный джингл').contentType).toBe('MOTION_DESIGN')
  })

  it('prefers PRESENTATION over MOTION_DESIGN for "моушен-дизайн презентации" (ТЗ example)', () => {
    expect(classifyMontageContentType('Моушен-дизайн презентации').contentType).toBe('PRESENTATION')
  })

  it('classifies "мастер-класс" as PRESENTATION (ТЗ example)', () => {
    expect(classifyMontageContentType('Монтаж мастер-класса по материалам').contentType).toBe('PRESENTATION')
  })

  it('falls back to OTHER with the original text preserved when nothing matches', () => {
    expect(classifyMontageContentType('Монтаж 2 роликов + осьминог')).toEqual({
      contentType: 'OTHER', customContentType: 'Монтаж 2 роликов + осьминог',
    })
  })

  it('OTHER customContentType is null for empty input rather than an empty string', () => {
    expect(classifyMontageContentType('   ')).toEqual({ contentType: 'OTHER', customContentType: null })
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

  it('defaults to calendar days when turnaroundDayType is not given', () => {
    const d = computeMontageDeadline({
      sourceReceivedAt: '2026-07-01', deadlineType: 'DURATION_DAYS', deadlineDate: null, turnaroundDays: 10,
    })
    expect(d?.toISOString().slice(0, 10)).toBe('2026-07-11')
  })

  it('skips Saturday/Sunday for BUSINESS turnaround days', () => {
    // 2026-07-01 — среда. +3 рабочих дня: чт(02), пт(03), пропуск сб/вс(04-05), пн(06).
    const d = computeMontageDeadline({
      sourceReceivedAt: '2026-07-01', deadlineType: 'DURATION_DAYS', deadlineDate: null,
      turnaroundDays: 3, turnaroundDayType: 'BUSINESS',
    })
    expect(d?.toISOString().slice(0, 10)).toBe('2026-07-06')
  })

  it('CALENDAR turnaround days counts weekends normally, unlike BUSINESS', () => {
    const d = computeMontageDeadline({
      sourceReceivedAt: '2026-07-01', deadlineType: 'DURATION_DAYS', deadlineDate: null,
      turnaroundDays: 3, turnaroundDayType: 'CALENDAR',
    })
    expect(d?.toISOString().slice(0, 10)).toBe('2026-07-04')
  })

  it('a business-day span starting on a weekend still only counts weekdays', () => {
    // 2026-07-04 — суббота. +1 рабочий день -> понедельник 06-е (пропускает вс).
    const d = computeMontageDeadline({
      sourceReceivedAt: '2026-07-04', deadlineType: 'DURATION_DAYS', deadlineDate: null,
      turnaroundDays: 1, turnaroundDayType: 'BUSINESS',
    })
    expect(d?.toISOString().slice(0, 10)).toBe('2026-07-06')
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

  it('shows "Сдано вовремя" when delivered exactly on the deadline', () => {
    const project = { deadlineDate: '2026-07-10', status: 'DELIVERED' as const, deliveredAt: '2026-07-10' }
    expect(montageDeadlineLabel(project, now)).toBe('Сдано вовремя')
  })

  it('shows delay in days when delivered after the deadline', () => {
    const project = { deadlineDate: '2026-07-10', status: 'DELIVERED' as const, deliveredAt: '2026-07-13' }
    expect(montageDeadlineLabel(project, now)).toBe('Сдано с опозданием на 3 дня')
  })

  it('shows early delivery separately from on-time', () => {
    const project = { deadlineDate: '2026-07-10', status: 'DELIVERED' as const, deliveredAt: '2026-07-07' }
    expect(montageDeadlineLabel(project, now)).toBe('Сдан на 3 дня раньше')
  })

  it('shows remaining days for an upcoming deadline', () => {
    const project = { deadlineDate: '2026-07-16', status: 'IN_PROGRESS' as const, deliveredAt: null }
    expect(montageDeadlineLabel(project, now)).toBe('Осталось 3 дня')
  })

  it('shows "Дедлайн сегодня" when the deadline is today', () => {
    const project = { deadlineDate: '2026-07-13T18:00:00.000Z', status: 'IN_PROGRESS' as const, deliveredAt: null }
    expect(montageDeadlineLabel(project, now)).toBe('Дедлайн сегодня')
  })

  it('is never overdue for CANCELLED regardless of the date', () => {
    expect(isMontageOverdue({ deadlineDate: '2026-01-01', status: 'CANCELLED', deliveredAt: null }, now)).toBe(false)
  })

  it('is never overdue for an archived project regardless of the date (isArchived overlay, not a status)', () => {
    expect(isMontageOverdue({ deadlineDate: '2026-01-01', status: 'IN_PROGRESS', deliveredAt: null, isArchived: true }, now)).toBe(false)
  })

  it('shows no deadline label at all for an archived project, even overdue', () => {
    expect(montageDeadlineLabel({ deadlineDate: '2026-01-01', status: 'IN_PROGRESS', deliveredAt: null, isArchived: true }, now)).toBeNull()
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

describe('getMontageMaterialsState — контроль материалов на NAS (точечная доработка)', () => {
  function makeMaterials(overrides: Partial<MontageMaterialsStateInput> = {}): MontageMaterialsStateInput {
    return {
      status: 'IN_REVIEW',
      sourceReceivedAt: '2026-07-08',
      sourceMaterialsNasUrl: 'https://nas/source',
      mountedMaterialNasUrl: 'https://nas/final',
      isArchived: false,
      ...overrides,
    }
  }

  describe('дата начала контроля', () => {
    it('does not track a project received before the cutoff date, even with both links missing', () => {
      const state = getMontageMaterialsState(makeMaterials({
        sourceReceivedAt: '2026-07-07', sourceMaterialsNasUrl: null, mountedMaterialNasUrl: null,
      }))
      expect(state).toBe('NOT_TRACKED')
    })

    it('tracks a project received exactly on the cutoff date', () => {
      const state = getMontageMaterialsState(makeMaterials({
        sourceReceivedAt: '2026-07-08', sourceMaterialsNasUrl: null, mountedMaterialNasUrl: null,
      }))
      expect(state).toBe('MISSING')
    })

    it('tracks a project received after the cutoff date', () => {
      const state = getMontageMaterialsState(makeMaterials({
        sourceReceivedAt: '2026-07-13', sourceMaterialsNasUrl: null, mountedMaterialNasUrl: null,
      }))
      expect(state).toBe('MISSING')
    })

    it('does not track a project with no sourceReceivedAt at all', () => {
      expect(getMontageMaterialsState(makeMaterials({ sourceReceivedAt: null }))).toBe('NOT_TRACKED')
    })

    it('the cutoff constant matches the spec date (2026-07-08)', () => {
      expect(MONTAGE_MATERIALS_TRACKING_START_DATE.toISOString().slice(0, 10)).toBe('2026-07-08')
    })
  })

  describe('обе ссылки заполнены', () => {
    it('is COMPLETE when both NAS links are present', () => {
      expect(getMontageMaterialsState(makeMaterials())).toBe('COMPLETE')
    })
  })

  describe('отсутствует ровно одна ссылка — PARTIAL', () => {
    it('is PARTIAL when only the source link is missing', () => {
      expect(getMontageMaterialsState(makeMaterials({ sourceMaterialsNasUrl: null }))).toBe('PARTIAL')
    })

    it('is PARTIAL when only the final link is missing', () => {
      expect(getMontageMaterialsState(makeMaterials({ mountedMaterialNasUrl: null }))).toBe('PARTIAL')
    })

    it('never reports MISSING when only one link is absent', () => {
      expect(getMontageMaterialsState(makeMaterials({ sourceMaterialsNasUrl: null }))).not.toBe('MISSING')
      expect(getMontageMaterialsState(makeMaterials({ mountedMaterialNasUrl: null }))).not.toBe('MISSING')
    })
  })

  describe('отсутствуют обе ссылки — MISSING', () => {
    it('is MISSING when both are absent on a status that requires both', () => {
      expect(getMontageMaterialsState(makeMaterials({ sourceMaterialsNasUrl: null, mountedMaterialNasUrl: null }))).toBe('MISSING')
    })

    it('never reports PARTIAL when both links are absent', () => {
      expect(getMontageMaterialsState(makeMaterials({ sourceMaterialsNasUrl: null, mountedMaterialNasUrl: null }))).not.toBe('PARTIAL')
    })
  })

  describe('учёт производственного статуса', () => {
    it('NEW never warns about missing links, even with nothing attached', () => {
      const state = getMontageMaterialsState(makeMaterials({ status: 'NEW', sourceMaterialsNasUrl: null, mountedMaterialNasUrl: null }))
      expect(state).toBe('COMPLETE')
    })

    it('IN_PROGRESS requires the source link but not the final one', () => {
      expect(getMontageMaterialsState(makeMaterials({ status: 'IN_PROGRESS', mountedMaterialNasUrl: null }))).toBe('COMPLETE')
      expect(getMontageMaterialsState(makeMaterials({ status: 'IN_PROGRESS', sourceMaterialsNasUrl: null }))).toBe('MISSING')
    })

    it('IN_REVIEW/REVISIONS/DELIVERED all require both links', () => {
      for (const status of ['IN_REVIEW', 'REVISIONS', 'DELIVERED'] as const) {
        expect(getMontageMaterialsState(makeMaterials({ status, sourceMaterialsNasUrl: null }))).toBe('PARTIAL')
        expect(getMontageMaterialsState(makeMaterials({ status, mountedMaterialNasUrl: null }))).toBe('PARTIAL')
        expect(getMontageMaterialsState(makeMaterials({ status, sourceMaterialsNasUrl: null, mountedMaterialNasUrl: null }))).toBe('MISSING')
      }
    })

    it('CANCELLED never shows an active problem, regardless of links', () => {
      expect(getMontageMaterialsState(makeMaterials({ status: 'CANCELLED', sourceMaterialsNasUrl: null, mountedMaterialNasUrl: null }))).toBe('NOT_TRACKED')
    })

    it('an archived project never shows an active problem, regardless of links', () => {
      expect(getMontageMaterialsState(makeMaterials({ isArchived: true, sourceMaterialsNasUrl: null, mountedMaterialNasUrl: null }))).toBe('NOT_TRACKED')
    })
  })
})

describe('getMontageMaterialsMissingFields', () => {
  it('reports the source as missing only when required and absent', () => {
    expect(getMontageMaterialsMissingFields({ status: 'IN_PROGRESS', sourceMaterialsNasUrl: null, mountedMaterialNasUrl: null }).missingSource).toBe(true)
    expect(getMontageMaterialsMissingFields({ status: 'NEW', sourceMaterialsNasUrl: null, mountedMaterialNasUrl: null }).missingSource).toBe(false)
  })

  it('reports the final material as missing only when required and absent', () => {
    expect(getMontageMaterialsMissingFields({ status: 'REVISIONS', sourceMaterialsNasUrl: 'x', mountedMaterialNasUrl: null }).missingFinal).toBe(true)
    expect(getMontageMaterialsMissingFields({ status: 'IN_PROGRESS', sourceMaterialsNasUrl: 'x', mountedMaterialNasUrl: null }).missingFinal).toBe(false)
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
      // Отслеживаемый (после даты старта контроля), но с заполненным
      // единственным обязательным на IN_PROGRESS полем (source) — материалы
      // по умолчанию COMPLETE, чтобы не мешать остальным тестам этого блока,
      // которые проверяют ДРУГИЕ причины (см. describe про NO_SOURCE_NAS/
      // NO_FINAL_NAS/MATERIALS_MISSING ниже для самого контроля материалов).
      sourceReceivedAt: '2026-07-10',
      sourceMaterialsNasUrl: 'https://nas/source',
      mountedMaterialNasUrl: null,
      clientAmount: 20000,
      clientPaymentStatus: 'PAID',
      title: 'Монтаж подкаста',
      description: null,
      hasNoClientLink: false,
      isHistoricalImport: false,
      isArchived: false,
      ...overrides,
    }
  }

  it('returns no reasons for a fully filled, on-time, assigned project', () => {
    expect(getMontageAttentionReasons(makeInput(), now)).toEqual([])
  })

  it('flags a project with no editor assigned once past NEW', () => {
    expect(getMontageAttentionReasons(makeInput({ editorId: null, status: 'IN_PROGRESS' }), now)).toContain('NO_EDITOR')
  })

  it('does not flag a brand-new project for missing editor/source/deadline yet', () => {
    const reasons = getMontageAttentionReasons(makeInput({ editorId: null, status: 'NEW', effectiveSourceMaterialsUrl: null, deadlineDate: null }), now)
    expect(reasons).not.toContain('NO_EDITOR')
    expect(reasons).not.toContain('NO_SOURCE')
    expect(reasons).not.toContain('NO_DEADLINE')
  })

  it('flags a non-exempt project with no deadline at all', () => {
    expect(getMontageAttentionReasons(makeInput({ status: 'IN_PROGRESS', deadlineDate: null }), now)).toContain('NO_DEADLINE')
  })

  it('does not flag a historical-import project for missing deadline (same exemption as source/NAS)', () => {
    const reasons = getMontageAttentionReasons(makeInput({ status: 'IN_PROGRESS', deadlineDate: null, isHistoricalImport: true }), now)
    expect(reasons).not.toContain('NO_DEADLINE')
  })

  it('flags an overdue project', () => {
    expect(getMontageAttentionReasons(makeInput({ deadlineDate: '2026-07-01' }), now)).toContain('OVERDUE')
  })

  it('flags a delivered project missing the final NAS material', () => {
    const reasons = getMontageAttentionReasons(makeInput({ status: 'DELIVERED', deliveredAt: '2026-07-12', mountedMaterialNasUrl: null }), now)
    expect(reasons).toContain('NO_FINAL_NAS')
  })

  it('the legacy NO_SOURCE exemption for historical imports does NOT extend to the NAS materials control — that one is gated by date only', () => {
    const reasons = getMontageAttentionReasons(makeInput({
      status: 'DELIVERED', deliveredAt: '2026-07-12', mountedMaterialNasUrl: null,
      effectiveSourceMaterialsUrl: null, isHistoricalImport: true,
    }), now)
    expect(reasons).not.toContain('NO_SOURCE')
    expect(reasons).toContain('NO_FINAL_NAS')
  })

  it('a non-imported project still flags both the legacy NO_SOURCE and the new NAS-materials reason', () => {
    const reasons = getMontageAttentionReasons(makeInput({
      status: 'DELIVERED', deliveredAt: '2026-07-12', mountedMaterialNasUrl: null,
      effectiveSourceMaterialsUrl: null, isHistoricalImport: false,
    }), now)
    expect(reasons).toContain('NO_SOURCE')
    expect(reasons).toContain('NO_FINAL_NAS')
  })

  it('still flags other issues (no client, no editor) on historical-import projects', () => {
    const reasons = getMontageAttentionReasons(makeInput({
      isHistoricalImport: true, hasNoClientLink: true, editorId: null, status: 'IN_PROGRESS',
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

  it('never flags CANCELLED projects, no matter what is missing', () => {
    expect(getMontageAttentionReasons(makeInput({ status: 'CANCELLED', editorId: null, deadlineDate: '2020-01-01' }), now)).toEqual([])
  })

  it('never flags archived projects, no matter what is missing (isArchived overlay, not a status)', () => {
    expect(getMontageAttentionReasons(makeInput({ status: 'IN_PROGRESS', editorId: null, deadlineDate: '2020-01-01', isArchived: true }), now)).toEqual([])
  })

  describe('контроль материалов на NAS', () => {
    it('flags NO_SOURCE_NAS when only the source NAS link is missing (status where both are required)', () => {
      // На IN_PROGRESS обязателен только source — если его одного не хватает,
      // это MISSING (100% обязательных полей отсутствует), а не PARTIAL, см.
      // describe('getMontageMaterialsState') выше. Чтобы проверить именно
      // "не хватает ровно одного из двух", нужен статус, где оба поля
      // обязательны — DELIVERED.
      const reasons = getMontageAttentionReasons(makeInput({
        status: 'DELIVERED', sourceMaterialsNasUrl: null, mountedMaterialNasUrl: 'https://nas/final',
      }), now)
      expect(reasons).toContain('NO_SOURCE_NAS')
      expect(reasons).not.toContain('MATERIALS_MISSING')
      expect(reasons).not.toContain('NO_FINAL_NAS')
    })

    it('missing the only field required at IN_PROGRESS (source) is a critical MISSING, not PARTIAL', () => {
      const reasons = getMontageAttentionReasons(makeInput({ status: 'IN_PROGRESS', sourceMaterialsNasUrl: null }), now)
      expect(reasons).toContain('MATERIALS_MISSING')
      expect(reasons).not.toContain('NO_SOURCE_NAS')
    })

    it('flags NO_FINAL_NAS when only the final NAS link is missing on a status that requires it', () => {
      const reasons = getMontageAttentionReasons(makeInput({ status: 'DELIVERED', mountedMaterialNasUrl: null }), now)
      expect(reasons).toContain('NO_FINAL_NAS')
      expect(reasons).not.toContain('MATERIALS_MISSING')
      expect(reasons).not.toContain('NO_SOURCE_NAS')
    })

    it('flags a single MATERIALS_MISSING reason (not both individual ones) when both links are absent', () => {
      const reasons = getMontageAttentionReasons(makeInput({ status: 'DELIVERED', sourceMaterialsNasUrl: null, mountedMaterialNasUrl: null }), now)
      expect(reasons.filter(r => r === 'MATERIALS_MISSING' || r === 'NO_SOURCE_NAS' || r === 'NO_FINAL_NAS')).toEqual(['MATERIALS_MISSING'])
    })

    it('does not flag materials issues for a project received before the tracking start date', () => {
      const reasons = getMontageAttentionReasons(makeInput({
        status: 'DELIVERED', sourceReceivedAt: '2026-07-07', sourceMaterialsNasUrl: null, mountedMaterialNasUrl: null,
      }), now)
      expect(reasons).not.toContain('MATERIALS_MISSING')
      expect(reasons).not.toContain('NO_SOURCE_NAS')
      expect(reasons).not.toContain('NO_FINAL_NAS')
    })

    it('does not flag a NEW project for missing materials, even past the tracking start date', () => {
      const reasons = getMontageAttentionReasons(makeInput({
        status: 'NEW', sourceMaterialsNasUrl: null, mountedMaterialNasUrl: null,
      }), now)
      expect(reasons).not.toContain('MATERIALS_MISSING')
      expect(reasons).not.toContain('NO_SOURCE_NAS')
      expect(reasons).not.toContain('NO_FINAL_NAS')
    })

    it('materials NAS control is independent of isHistoricalImport (gated by date, not that flag)', () => {
      const reasons = getMontageAttentionReasons(makeInput({
        status: 'DELIVERED', isHistoricalImport: true, sourceMaterialsNasUrl: null, mountedMaterialNasUrl: null,
      }), now)
      expect(reasons).toContain('MATERIALS_MISSING')
    })
  })
})

describe('mapMontageStatusToOrderStatus — однонаправленная связь с CRM', () => {
  it('moves the order to REVISIONS when the montage enters a revisions state', () => {
    expect(mapMontageStatusToOrderStatus('REVISIONS', 'EDITING')).toBe('REVISIONS')
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
      sourceMaterialsNasUrl: 'https://nas/source',
      mountedMaterialNasUrl: 'https://nas',
      title: 'Монтаж подкаста',
      description: null,
      hasNoClientLink: false,
      isHistoricalImport: false,
      isArchived: false,
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
      // deadlineDate задан (в отличие от прочих overrides) — иначе строка сама
      // словила бы ещё и NO_DEADLINE, а тест проверяет именно NAS-кейс изолированно.
      makeStatsInput({ status: 'IN_PROGRESS', clientAmount: null, editorAmount: null, deadlineDate: '2026-08-01' }),
      // sourceReceivedAt сдвинут на дату ПОСЛЕ старта контроля материалов —
      // иначе строка попала бы под NOT_TRACKED и не дала бы ни одной причины
      // (см. дефолт '2025-10-07' в makeStatsInput выше, до даты контроля).
      makeStatsInput({ status: 'DELIVERED', sourceReceivedAt: '2026-07-10', mountedMaterialNasUrl: null, clientAmount: null, editorAmount: null }),
      makeStatsInput({ status: 'CANCELLED', editorId: null, clientAmount: null, editorAmount: null }),
    ], now)
    expect(stats.activeCount).toBe(1)
    expect(stats.attentionCount).toBe(1)
  })

  it('a project missing its deadline also counts toward attentionCount (NO_DEADLINE)', () => {
    const stats = computeMontageDashboardStats([
      makeStatsInput({ status: 'IN_PROGRESS', deadlineDate: null }),
    ], now)
    expect(stats.attentionCount).toBe(1)
  })

  it('excludes CANCELLED projects entirely from revenue/expenses/profit (money never actually earned)', () => {
    const stats = computeMontageDashboardStats([
      makeStatsInput({ clientAmount: 20000, editorAmount: 16000 }),
      makeStatsInput({ status: 'CANCELLED', clientAmount: 50000, editorAmount: 40000, clientPaymentStatus: 'PENDING', editorPaymentStatus: 'PENDING' }),
    ], now)
    expect(stats.revenueTotal).toBe(20000)
    expect(stats.expensesTotal).toBe(16000)
    expect(stats.profit).toBe(4000)
    expect(stats.clientDebt).toBe(0)
    expect(stats.studioDebt).toBe(0)
    expect(stats.deliveredCount).toBe(1)
  })

  it('returns zeroed stats for an empty project list', () => {
    const stats = computeMontageDashboardStats([], now)
    expect(stats).toEqual({
      deliveredCount: 0, reportingSince: null, revenueTotal: 0, revenuePaid: 0,
      expensesTotal: 0, expensesPaid: 0, profit: 0, margin: null, activeCount: 0,
      attentionCount: 0, clientDebt: 0, studioDebt: 0,
    })
  })

  it('a project missing NAS materials (received on/after the tracking date) counts toward attentionCount', () => {
    const stats = computeMontageDashboardStats([
      makeStatsInput({ sourceReceivedAt: '2026-07-08', sourceMaterialsNasUrl: null, mountedMaterialNasUrl: null }),
    ], now)
    expect(stats.attentionCount).toBe(1)
  })

  it('the same missing materials do NOT count toward attentionCount for a project received before the tracking date', () => {
    const stats = computeMontageDashboardStats([
      makeStatsInput({ sourceReceivedAt: '2026-07-07', sourceMaterialsNasUrl: null, mountedMaterialNasUrl: null }),
    ], now)
    expect(stats.attentionCount).toBe(0)
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

  it('lists exactly the 5 production statuses once each, excluding the terminal CANCELLED', () => {
    expect(MONTAGE_STATUS_ORDER).toHaveLength(5)
    expect(new Set(MONTAGE_STATUS_ORDER).size).toBe(5)
    expect(MONTAGE_STATUS_ORDER).not.toContain('CANCELLED')
  })
})
