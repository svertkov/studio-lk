import { describe, it, expect } from 'vitest'
import {
  normalizeMakeupDurationMinutes, computeMakeupInterval, MAKEUP_DURATION_MAX_MINUTES,
  formatDurationMinutes, formatMakeupBadgeLabel,
  computeMaterialsStatus, getMaterialsDisplay, getBookingAttentionInfo,
  type ScheduleEventVM, type ScheduleEventDTO,
} from './schedule-model'

describe('normalizeMakeupDurationMinutes — гримёр, ввод длительности', () => {
  it('accepts 30/60/90/120 minutes as-is', () => {
    expect(normalizeMakeupDurationMinutes('30', 'minutes')).toBe(30)
    expect(normalizeMakeupDurationMinutes('60', 'minutes')).toBe(60)
    expect(normalizeMakeupDurationMinutes('90', 'minutes')).toBe(90)
    expect(normalizeMakeupDurationMinutes('120', 'minutes')).toBe(120)
  })

  it('accepts an arbitrary manually entered value', () => {
    expect(normalizeMakeupDurationMinutes('45', 'minutes')).toBe(45)
  })

  it('converts 1.5 hours to 90 minutes (dot decimal)', () => {
    expect(normalizeMakeupDurationMinutes('1.5', 'hours')).toBe(90)
  })

  it('converts 1,5 hours to 90 minutes (comma decimal)', () => {
    expect(normalizeMakeupDurationMinutes('1,5', 'hours')).toBe(90)
  })

  it('does not save a negative value — treated as "no makeup"', () => {
    expect(normalizeMakeupDurationMinutes('-30', 'minutes')).toBeNull()
  })

  it('allows an empty value — means no pre-booking', () => {
    expect(normalizeMakeupDurationMinutes('', 'minutes')).toBeNull()
    expect(normalizeMakeupDurationMinutes('   ', 'minutes')).toBeNull()
  })

  it('treats 0 as "no makeup"', () => {
    expect(normalizeMakeupDurationMinutes('0', 'minutes')).toBeNull()
  })

  it('never produces NaN for garbage input', () => {
    expect(normalizeMakeupDurationMinutes('abc', 'minutes')).toBeNull()
  })

  it('clamps absurdly large values to the sane maximum', () => {
    expect(normalizeMakeupDurationMinutes('99999', 'minutes')).toBe(MAKEUP_DURATION_MAX_MINUTES)
  })

  it('rounds fractional minutes to the nearest whole minute', () => {
    expect(normalizeMakeupDurationMinutes('45.6', 'minutes')).toBe(46)
  })
})

describe('computeMakeupInterval — расчёт интервала от начала съёмки назад', () => {
  it('computes start = shootStart - duration, end = shootStart', () => {
    const shootStart = new Date('2026-08-01T09:00:00.000Z')
    const interval = computeMakeupInterval(shootStart, 60)
    expect(interval?.start.toISOString()).toBe('2026-08-01T08:00:00.000Z')
    expect(interval?.end.toISOString()).toBe('2026-08-01T09:00:00.000Z')
  })

  it('returns null when there is no shoot start time yet', () => {
    expect(computeMakeupInterval(null, 60)).toBeNull()
  })

  it('returns null when makeup duration is null/zero', () => {
    const shootStart = new Date('2026-08-01T09:00:00Z')
    expect(computeMakeupInterval(shootStart, null)).toBeNull()
    expect(computeMakeupInterval(shootStart, 0)).toBeNull()
  })

  it('correctly rolls back to the previous calendar day when makeup starts before midnight', () => {
    const shootStart = new Date('2026-08-01T00:30:00Z')
    const interval = computeMakeupInterval(shootStart, 60)
    expect(interval?.start.toISOString()).toBe('2026-07-31T23:30:00.000Z')
  })

  it('does not mutate the shoot start date object', () => {
    const shootStart = new Date('2026-08-01T09:00:00Z')
    const before = shootStart.getTime()
    computeMakeupInterval(shootStart, 60)
    expect(shootStart.getTime()).toBe(before)
  })

  it('changing the shoot start recomputes the interval instead of using a stale cached start', () => {
    const first = computeMakeupInterval(new Date('2026-08-01T09:00:00Z'), 60)
    const second = computeMakeupInterval(new Date('2026-08-01T10:00:00Z'), 60)
    expect(first?.start.toISOString()).not.toBe(second?.start.toISOString())
  })
})

describe('formatDurationMinutes / formatMakeupBadgeLabel — единый helper', () => {
  it.each([
    [0, '0 мин'],
    [30, '30 мин'],
    [60, '1 ч'],
    [90, '1 ч 30 мин'],
    [120, '2 ч'],
    [150, '2 ч 30 мин'],
  ])('formats %i minutes as "%s"', (minutes, expected) => {
    expect(formatDurationMinutes(minutes)).toBe(expected)
  })

  it('prefixes with "Гримёр" for the badge label', () => {
    expect(formatMakeupBadgeLabel(60)).toBe('Гримёр 1 ч')
    expect(formatMakeupBadgeLabel(90)).toBe('Гримёр 1 ч 30 мин')
  })
})

// Быстрый шаблон акции "Акция! 20% скидка на первую запись" был вставкой
// текста в комментарий через applyQuickCommentTemplate/hasQuickCommentTemplate
// (и покрывался тестами прямо здесь) — теперь акция хранится структурированно
// (OrderPromotionType) и вся логика её определения/очистки живёт в
// src/lib/promotion-model.ts, см. promotion-model.test.ts.

describe('computeMaterialsStatus — с учётом yandexLinkRequired/nasLinkRequired', () => {
  it('behaves exactly as before when both links stay required (default)', () => {
    expect(computeMaterialsStatus({ yandexDiskUrl: null, yandexDiskUrlAddedAt: null, nasBackupUrl: null })).toBe('NO_LINKS')
    expect(computeMaterialsStatus({ yandexDiskUrl: null, yandexDiskUrlAddedAt: null, nasBackupUrl: 'nas://x' })).toBe('BACKUP_EXISTS')
    expect(computeMaterialsStatus({ yandexDiskUrl: 'https://disk.yandex.ru/x', yandexDiskUrlAddedAt: new Date(), nasBackupUrl: null })).toBe('YANDEX_ACTIVE')
  })

  it('an empty but explicitly not-required link no longer counts as missing', () => {
    expect(computeMaterialsStatus({
      yandexDiskUrl: null, yandexDiskUrlAddedAt: null, nasBackupUrl: null,
      yandexLinkRequired: false, nasLinkRequired: false,
    })).toBe('YANDEX_ACTIVE')
  })

  it('yandex not required, NAS still required and missing — raw status reads YANDEX_ACTIVE, but getMaterialsDisplay still flags the missing NAS (the required flag only matters at display time here, see next describe block)', () => {
    expect(computeMaterialsStatus({
      yandexDiskUrl: null, yandexDiskUrlAddedAt: null, nasBackupUrl: null,
      yandexLinkRequired: false, nasLinkRequired: true,
    })).toBe('YANDEX_ACTIVE')
  })

  it('NAS not required, yandex present — active regardless of NAS', () => {
    expect(computeMaterialsStatus({
      yandexDiskUrl: 'https://disk.yandex.ru/x', yandexDiskUrlAddedAt: new Date(), nasBackupUrl: null,
      nasLinkRequired: false,
    })).toBe('YANDEX_ACTIVE')
  })

  it('yandex required and missing, NAS not required — BACKUP_EXISTS (yandex is the real, still-flagged gap)', () => {
    expect(computeMaterialsStatus({
      yandexDiskUrl: null, yandexDiskUrlAddedAt: null, nasBackupUrl: null,
      nasLinkRequired: false,
    })).toBe('BACKUP_EXISTS')
  })
})

describe('getMaterialsDisplay — не показывает предупреждение для необязательных полей', () => {
  it('YANDEX_ACTIVE with no NAS and NAS required stays a warning (unchanged)', () => {
    expect(getMaterialsDisplay({ materialsStatus: 'YANDEX_ACTIVE', nasBackupUrl: null })).toEqual({ label: 'Нет бэкапа на NAS', severity: 'warning' })
  })

  it('YANDEX_ACTIVE with no NAS but NAS marked not required is a success, not a warning', () => {
    expect(getMaterialsDisplay({ materialsStatus: 'YANDEX_ACTIVE', nasBackupUrl: null, nasLinkRequired: false }))
      .toEqual({ label: 'Материалы сохранены', severity: 'success' })
  })
})

function buildPastBookingVm(overrides: Partial<ScheduleEventDTO> = {}): ScheduleEventVM {
  const annotation: ScheduleEventDTO = {
    id: 'evt1', calendarEventId: 'cal1', title: 'Съёмка', description: '',
    startAt: null, endAt: null, clientId: null, clientName: null, clientNameRaw: null,
    contactRaw: null, companyRaw: null, room: null, format: null, camerasCount: null,
    estimatedPrice: 15000, paymentMethod: 'CARD', notes: null, promotionType: null,
    yandexDiskUrl: null, yandexDiskUrlAddedAt: null, yandexDiskUrlExpiresAt: null,
    nasBackupUrl: null, materialsComment: null, materialsStatus: 'NO_LINKS',
    yandexLinkRequired: true, nasLinkRequired: true,
    editingRequired: null, clientConfirmationStatus: 'NOT_REQUIRED', subscriptionUsage: null,
    eventType: 'STUDIO_BOOKING', makeupDurationMinutes: null, orderId: null, isCancelled: false,
    ...overrides,
  }
  return {
    calendarEvent: {
      id: 'cal1', title: 'Съёмка', start: '2026-07-10T10:00:00Z', end: '2026-07-10T12:00:00Z',
      allDay: false, description: '', location: '', calendar: 'studio', color: '#000',
    },
    annotation,
  }
}

describe('getBookingAttentionInfo — прошедшая студийная запись с необязательными ссылками', () => {
  const now = new Date('2026-07-12T00:00:00Z')

  it('missing yandex + missing NAS + no payment info is still critical by default (unchanged)', () => {
    const info = getBookingAttentionInfo(buildPastBookingVm({ estimatedPrice: null, paymentMethod: null }), now)
    expect(info.isComplete).toBe(false)
    expect(info.severity).toBe('critical')
  })

  it('both links marked not required — no longer flagged for materials, only for payment if that is also missing', () => {
    const info = getBookingAttentionInfo(buildPastBookingVm({ yandexLinkRequired: false, nasLinkRequired: false }), now)
    expect(info.missingFields).not.toContain('yandexDiskUrl')
    expect(info.missingFields).not.toContain('nasBackupUrl')
    expect(info.badges).not.toContain('Нет материалов')
  })

  it('fully complete once materials are marked not required and payment is filled in', () => {
    const info = getBookingAttentionInfo(buildPastBookingVm({
      yandexLinkRequired: false, nasLinkRequired: false, estimatedPrice: 15000, paymentMethod: 'CARD',
    }), now)
    expect(info).toEqual({ isComplete: true, severity: 'complete', missingFields: [], badges: [] })
  })

  it('yandex not required but NAS still required and missing — warning, not critical, with an accurate badge', () => {
    const info = getBookingAttentionInfo(buildPastBookingVm({ yandexLinkRequired: false, nasLinkRequired: true }), now)
    expect(info.severity).toBe('warning')
    expect(info.badges).toContain('Нет бэкапа на NAS')
    expect(info.badges).not.toContain('Нет материалов')
  })

  it('turning the flag back off makes an empty link a problem again', () => {
    const stillOff = getBookingAttentionInfo(buildPastBookingVm({ yandexLinkRequired: false, nasLinkRequired: false }), now)
    const turnedBackOn = getBookingAttentionInfo(buildPastBookingVm({ yandexLinkRequired: true, nasLinkRequired: false }), now)
    expect(stillOff.missingFields).not.toContain('yandexDiskUrl')
    expect(turnedBackOn.missingFields).toContain('yandexDiskUrl')
  })
})
