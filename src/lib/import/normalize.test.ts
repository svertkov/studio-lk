import { describe, it, expect } from 'vitest'
import { parseDurationHours, extractTimeRange, combineDateWithStudioTime } from './normalize'

describe('extractTimeRange — восстановление времени из "часы" колонки', () => {
  it('parses "2 часа (16-18)" as 16:00-18:00', () => {
    const r = extractTimeRange('2 часа (16-18)')
    expect(r).toMatchObject({ startHour: 16, startMinute: 0, endHour: 18, endMinute: 0, rangeDurationHours: 2, confidence: 'high' })
  })

  it('parses "2 ч (16:00-18:00)" with explicit minutes', () => {
    const r = extractTimeRange('2 ч (16:00-18:00)')
    expect(r).toMatchObject({ startHour: 16, startMinute: 0, endHour: 18, endMinute: 0, confidence: 'high' })
  })

  it('parses "1,5 часа (13:30-15:00)"', () => {
    const r = extractTimeRange('1,5 часа (13:30-15:00)')
    expect(r).toMatchObject({ startHour: 13, startMinute: 30, endHour: 15, endMinute: 0, rangeDurationHours: 1.5, confidence: 'high' })
  })

  it('accepts both hyphen and en dash as range separators', () => {
    expect(extractTimeRange('3 часа (10-13)')?.rangeDurationHours).toBe(3)
    expect(extractTimeRange('3 часа (10–13)')?.rangeDurationHours).toBe(3)
  })

  it('accepts a dot as the hour:minute separator ("16.00-18.00")', () => {
    const r = extractTimeRange('2 часа (16.00-18.00)')
    expect(r).toMatchObject({ startHour: 16, startMinute: 0, endHour: 18, endMinute: 0, confidence: 'high' })
  })

  it('ignores a leading camera/mic count — the range itself is what matters ("1 камера (13-16)")', () => {
    const r = extractTimeRange('1 камера (13-16)')
    expect(r).toMatchObject({ startHour: 13, endHour: 16, rangeDurationHours: 3, confidence: 'high' })
  })

  it('parses a bare range with no unit word ("15-20")', () => {
    const r = extractTimeRange('15-20')
    expect(r).toMatchObject({ startHour: 15, endHour: 20, rangeDurationHours: 5, confidence: 'high' })
  })

  it('returns undefined for values with no range at all ("смена", "1 камера")', () => {
    expect(extractTimeRange('смена')).toBeUndefined()
    expect(extractTimeRange('1 камера')).toBeUndefined()
    expect(extractTimeRange('')).toBeUndefined()
  })

  it('marks low confidence when a string contains two separate ranges ("+ гримерка" split booking)', () => {
    const r = extractTimeRange('2 часа (12-14) + 2 часа (16-18)')
    expect(r?.confidence).toBe('low')
  })

  it('marks low confidence for "9-11 гример, 11-15 запись" (ambiguous which range is the shoot)', () => {
    const r = extractTimeRange('9-11 гример, 11-15 запись')
    expect(r?.confidence).toBe('low')
  })

  it('treats an end time at or before the start as crossing midnight', () => {
    const r = extractTimeRange('23:00-01:00')
    expect(r?.crossesMidnight).toBe(true)
    expect(r?.rangeDurationHours).toBe(2)
  })
})

describe('parseDurationHours — regression after adding dot-separator support', () => {
  it('still parses comma-decimal durations without a range ("1,5 часа")', () => {
    expect(parseDurationHours('1,5 часа')).toBe(1.5)
  })

  it('still sums duration from a plain hyphen range ("2 часа (16-18)")', () => {
    expect(parseDurationHours('2 часа (16-18)')).toBe(2)
  })

  it('still parses a dot-separated range the same as a colon-separated one', () => {
    expect(parseDurationHours('2 часа (16.00-18.00)')).toBe(parseDurationHours('2 часа (16:00-18:00)'))
  })
})

describe('combineDateWithStudioTime — Moscow (UTC+3) wall-clock, no DST', () => {
  it('converts 16:00 studio-local time to 13:00 UTC on the same calendar day', () => {
    const day = new Date(Date.UTC(2026, 6, 9)) // 9 июля 2026, полночь UTC — как хранится ClientVisit.date
    const result = combineDateWithStudioTime(day, 16, 0)
    expect(result.toISOString()).toBe('2026-07-09T13:00:00.000Z')
  })

  it('rolls back to the previous UTC day for early-morning studio time (e.g. 01:00)', () => {
    const day = new Date(Date.UTC(2026, 6, 9))
    const result = combineDateWithStudioTime(day, 1, 0)
    expect(result.toISOString()).toBe('2026-07-08T22:00:00.000Z')
  })
})
