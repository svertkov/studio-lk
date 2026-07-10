import { describe, it, expect } from 'vitest'
import {
  normalizeMakeupDurationMinutes, computeMakeupInterval, MAKEUP_DURATION_MAX_MINUTES,
  formatDurationMinutes, formatMakeupBadgeLabel,
  applyQuickCommentTemplate, hasQuickCommentTemplate, QUICK_COMMENT_TEMPLATES,
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

describe('quick comment templates — «Акция! 20% скидка на первую запись»', () => {
  const promo = QUICK_COMMENT_TEMPLATES[0]

  it('inserts the template text into an empty comment', () => {
    expect(applyQuickCommentTemplate('', promo.text)).toBe(promo.text)
  })

  it('appends the template on a new line when a comment already exists', () => {
    expect(applyQuickCommentTemplate('Клиент просил перенос', promo.text)).toBe(`Клиент просил перенос\n${promo.text}`)
  })

  it('does not duplicate the template on repeated clicks', () => {
    const once = applyQuickCommentTemplate('', promo.text)
    const twice = applyQuickCommentTemplate(once, promo.text)
    expect(twice).toBe(once)
  })

  it('detects the template is already present via hasQuickCommentTemplate', () => {
    expect(hasQuickCommentTemplate(`Заметка\n${promo.text}`, promo.text)).toBe(true)
    expect(hasQuickCommentTemplate('Заметка без шаблона', promo.text)).toBe(false)
  })

  it('handles null/undefined comment safely', () => {
    expect(hasQuickCommentTemplate(null, promo.text)).toBe(false)
    expect(hasQuickCommentTemplate(undefined, promo.text)).toBe(false)
  })
})
