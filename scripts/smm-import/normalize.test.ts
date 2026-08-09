import { describe, it, expect } from 'vitest'
import { isWeekendMarker, normalizeDate, normalizeAmount, extractUrls, normalizeUrl, parseTimeToSeconds, fingerprint } from './normalize'

describe('isWeekendMarker', () => {
  it('recognizes "выходной" in various casings', () => {
    expect(isWeekendMarker('выходной')).toBe(true)
    expect(isWeekendMarker('ВЫХОДНОЙ')).toBe(true)
    expect(isWeekendMarker(' выходной ')).toBe(true)
  })
  it('rejects real titles and non-strings', () => {
    expect(isWeekendMarker('Съемка в ЗубовЛаб')).toBe(false)
    expect(isWeekendMarker(null)).toBe(false)
    expect(isWeekendMarker(42)).toBe(false)
  })
})

describe('normalizeDate', () => {
  it('formats a Date object as calendar-day ISO', () => {
    expect(normalizeDate(new Date(Date.UTC(2026, 7, 9)))).toBe('2026-08-09')
  })
  it('parses an ISO-like string', () => {
    expect(normalizeDate('2026-08-09 00:00:00')).toBe('2026-08-09')
  })
  it('parses a ru-style dd.mm.yyyy string', () => {
    expect(normalizeDate('09.08.2026')).toBe('2026-08-09')
  })
  it('returns null for a weekend marker string', () => {
    expect(normalizeDate('выходной')).toBeNull()
  })
  it('returns null for an out-of-range serial date (schema drift protection)', () => {
    // соответствует реальному предупреждению openpyxl на "Финансы SMM 2470_____.xlsx"
    const bogus = new Date(0)
    bogus.setUTCFullYear(1)
    expect(normalizeDate(bogus)).toBeNull()
  })
  it('returns null for unrecognized text', () => {
    expect(normalizeDate('когда-нибудь потом')).toBeNull()
  })
})

describe('normalizeAmount', () => {
  it('accepts a plain number', () => {
    expect(normalizeAmount(1000).value).toBe(1000)
  })
  it('accepts a numeric string like "20000.0"', () => {
    expect(normalizeAmount('20000.0').value).toBe(20000)
  })
  it('accepts a space-separated thousands string like "3 864"', () => {
    expect(normalizeAmount('3 864').value).toBe(3864)
  })
  it('does not guess a value for a compound text note (real Оплата.xlsx case)', () => {
    const r = normalizeAmount('25000 + 10000 (выездная)\n+ 5000 (на обложки видео доп)')
    expect(r.value).toBeNull()
    expect(r.isComplexText).toBe(true)
  })
  it('returns null (not complex) for an empty cell', () => {
    const r = normalizeAmount(null)
    expect(r.value).toBeNull()
    expect(r.isComplexText).toBe(false)
  })
})

describe('extractUrls / normalizeUrl', () => {
  it('extracts a single URL', () => {
    expect(extractUrls('https://disk.yandex.ru/i/B8RUPHGehNoRpw')).toEqual(['https://disk.yandex.ru/i/B8RUPHGehNoRpw'])
  })
  it('extracts multiple URLs from a multi-line cell (real ЗубовЛаб case)', () => {
    const raw = 'https://disk.yandex.ru/i/B8RUPHGehNoRpw \n\nзвук  - https://disk.yandex.ru/d/lfh_9tA0wvDkkg'
    expect(extractUrls(raw)).toEqual(['https://disk.yandex.ru/i/B8RUPHGehNoRpw', 'https://disk.yandex.ru/d/lfh_9tA0wvDkkg'])
  })
  it('returns empty array for a cell with no URL', () => {
    expect(extractUrls('9836, 9841-9862')).toEqual([])
  })
  it('drops a trailing slash on a non-root path', () => {
    expect(normalizeUrl('https://disk.yandex.ru/d/abc/')).toBe('https://disk.yandex.ru/d/abc')
  })
})

describe('parseTimeToSeconds', () => {
  it('parses hh:mm:ss', () => {
    expect(parseTimeToSeconds('00:13:00')).toBe(780)
  })
  it('returns null for a retention fraction, not a time (real Диамед case)', () => {
    expect(parseTimeToSeconds('18/43')).toBeNull()
  })
})

describe('fingerprint', () => {
  it('is deterministic for the same input', () => {
    expect(fingerprint(['a', 1, null])).toBe(fingerprint(['a', 1, null]))
  })
  it('differs when a value changes', () => {
    expect(fingerprint(['a', 1])).not.toBe(fingerprint(['a', 2]))
  })
  it('differs when values shift position', () => {
    expect(fingerprint(['ab', 'c'])).not.toBe(fingerprint(['a', 'bc']))
  })
})
