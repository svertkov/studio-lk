import { describe, it, expect } from 'vitest'
import {
  getCalendarMonthRange, getCurrentStudioYearMonth, isCompletedByEndTime, isCompletedStudioBooking,
  filterCompletedStudioBookings, calculateCompletedHours, formatMonthLabel, formatCompletedRangeLabel,
} from './booking-analytics'

describe('getCalendarMonthRange — календарный месяц в часовом поясе студии (МСК, UTC+3)', () => {
  it('10 июля — период начинается 1 июля 00:00 МСК', () => {
    const { start } = getCalendarMonthRange(2026, 7)
    expect(start.toISOString()).toBe('2026-06-30T21:00:00.000Z') // 1 июля 00:00 МСК = 30 июня 21:00 UTC
  })

  it('период заканчивается 31 июля 23:59:59.999 МСК, а не 10 июня — 10 июля', () => {
    const { end } = getCalendarMonthRange(2026, 7)
    expect(end.toISOString()).toBe('2026-07-31T20:59:59.999Z') // 31 июля 23:59:59.999 МСК = 31 июля 20:59:59.999 UTC
  })

  it('обрабатывает январь (декабрь предыдущего года не затрагивается)', () => {
    const { start, end } = getCalendarMonthRange(2026, 1)
    expect(start.toISOString()).toBe('2025-12-31T21:00:00.000Z')
    expect(end.toISOString()).toBe('2026-01-31T20:59:59.999Z')
  })

  it('обрабатывает декабрь (переход на следующий год)', () => {
    const { start, end } = getCalendarMonthRange(2026, 12)
    expect(start.toISOString()).toBe('2026-11-30T21:00:00.000Z')
    expect(end.toISOString()).toBe('2026-12-31T20:59:59.999Z') // 31 дек 23:59:59.999 МСК
  })

  it('февраль високосного года — 29 дней', () => {
    const { end } = getCalendarMonthRange(2028, 2) // 2028 — високосный
    const msk = new Date(end.getTime() + 3 * 3_600_000)
    expect(msk.getUTCDate()).toBe(29)
  })

  it('февраль невисокосного года — 28 дней', () => {
    const { end } = getCalendarMonthRange(2026, 2)
    const msk = new Date(end.getTime() + 3 * 3_600_000)
    expect(msk.getUTCDate()).toBe(28)
  })
})

describe('getCurrentStudioYearMonth', () => {
  it('возвращает год/месяц по часовому поясу студии, а не UTC-дате момента', () => {
    // 31 июля 23:00 МСК = 20:00 UTC того же дня — не должно "перепрыгнуть" на август по UTC
    const now = new Date('2026-07-31T20:30:00.000Z')
    expect(getCurrentStudioYearMonth(now)).toEqual({ year: 2026, month: 7 })
  })

  it('01:00 МСК 1 августа корректно определяется как август, хотя это ещё 31 июля по UTC', () => {
    const now = new Date('2026-07-31T22:30:00.000Z') // 01:30 МСК 1 августа
    expect(getCurrentStudioYearMonth(now)).toEqual({ year: 2026, month: 8 })
  })
})

describe('isCompletedByEndTime — строго "endDateTime <= now", без грейс-периода', () => {
  it('прошедшая запись считается завершённой', () => {
    expect(isCompletedByEndTime('2026-07-10T10:00:00Z', new Date('2026-07-10T11:00:00Z'))).toBe(true)
  })

  it('запись, заканчивающаяся ровно сейчас, считается завершённой (<=)', () => {
    const t = '2026-07-10T10:00:00.000Z'
    expect(isCompletedByEndTime(t, new Date(t))).toBe(true)
  })

  it('будущая запись не считается завершённой', () => {
    expect(isCompletedByEndTime('2026-07-10T12:00:00Z', new Date('2026-07-10T11:00:00Z'))).toBe(false)
  })
})

describe('isCompletedStudioBooking / filterCompletedStudioBookings', () => {
  const month = getCalendarMonthRange(2026, 7)
  const now = new Date('2026-07-10T12:00:00Z') // 10 июля, 15:00 МСК

  it('учитывает прошедшую запись месяца', () => {
    const booking = { start: '2026-07-05T10:00:00Z', end: '2026-07-05T12:00:00Z' }
    expect(isCompletedStudioBooking(booking, month, now)).toBe(true)
  })

  it('не учитывает будущую запись', () => {
    const booking = { start: '2026-07-20T10:00:00Z', end: '2026-07-20T12:00:00Z' }
    expect(isCompletedStudioBooking(booking, month, now)).toBe(false)
  })

  it('не учитывает текущую незавершённую запись (началась, но ещё не закончилась)', () => {
    const booking = { start: '2026-07-10T11:00:00Z', end: '2026-07-10T14:00:00Z' } // now = 12:00Z, идёт сейчас
    expect(isCompletedStudioBooking(booking, month, now)).toBe(false)
  })

  it('запись засчитывается сразу после наступления времени окончания', () => {
    const booking = { start: '2026-07-10T09:00:00Z', end: '2026-07-10T12:00:00Z' } // end === now
    expect(isCompletedStudioBooking(booking, month, now)).toBe(true)
  })

  it('не учитывает отменённую запись', () => {
    const booking = { start: '2026-07-05T10:00:00Z', end: '2026-07-05T12:00:00Z', isCancelled: true }
    expect(isCompletedStudioBooking(booking, month, now)).toBe(false)
  })

  it('будущий месяц целиком даёт пустой результат, даже если там запланированы записи', () => {
    const futureMonth = getCalendarMonthRange(2026, 9)
    const booking = { start: '2026-09-05T10:00:00Z', end: '2026-09-05T12:00:00Z' }
    expect(isCompletedStudioBooking(booking, futureMonth, now)).toBe(false)
  })

  it('прошлый месяц учитывает все завершённые записи целиком', () => {
    const pastMonth = getCalendarMonthRange(2026, 6)
    const booking = { start: '2026-06-30T20:00:00Z', end: '2026-06-30T22:00:00Z' }
    expect(isCompletedStudioBooking(booking, pastMonth, now)).toBe(true)
  })

  it('filterCompletedStudioBookings отфильтровывает смешанный список корректно', () => {
    const bookings = [
      { id: 'past', start: '2026-07-05T10:00:00Z', end: '2026-07-05T12:00:00Z' },
      { id: 'future', start: '2026-07-20T10:00:00Z', end: '2026-07-20T12:00:00Z' },
      { id: 'cancelled', start: '2026-07-06T10:00:00Z', end: '2026-07-06T12:00:00Z', isCancelled: true },
    ]
    const result = filterCompletedStudioBookings(bookings, month, now)
    expect(result.map(b => (b as { id: string }).id)).toEqual(['past'])
  })
})

describe('calculateCompletedHours', () => {
  it('суммирует продолжительность только переданных (уже отфильтрованных) записей', () => {
    const bookings = [
      { start: '2026-07-05T10:00:00Z', end: '2026-07-05T12:00:00Z' }, // 2ч
      { start: '2026-07-06T10:00:00Z', end: '2026-07-06T13:30:00Z' }, // 3.5ч
    ]
    expect(calculateCompletedHours(bookings)).toBeCloseTo(5.5)
  })

  it('возвращает 0 для пустого списка', () => {
    expect(calculateCompletedHours([])).toBe(0)
  })
})

describe('formatMonthLabel / formatCompletedRangeLabel', () => {
  it('формирует заголовок месяца', () => {
    expect(formatMonthLabel(2026, 7)).toBe('Июль 2026')
  })

  it('для текущего месяца ограничивает диапазон фактическим моментом', () => {
    const month = getCalendarMonthRange(2026, 7)
    const now = new Date('2026-07-10T12:00:00Z') // 15:00 МСК 10 июля
    expect(formatCompletedRangeLabel(month, now)).toBe('1–10 июля 2026')
  })

  it('для полностью прошедшего месяца показывает весь месяц целиком', () => {
    const month = getCalendarMonthRange(2026, 6)
    const now = new Date('2026-07-10T12:00:00Z')
    expect(formatCompletedRangeLabel(month, now)).toBe('1–30 июня 2026')
  })
})
