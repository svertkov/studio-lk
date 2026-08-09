import { describe, it, expect } from 'vitest'
import { dedupContentRows, summarizeConfidence } from './dedup'
import type { SourceContentRow } from './types'

function row(overrides: Partial<SourceContentRow>): SourceContentRow {
  return {
    trace: { file: 'f.xlsx', sheet: 's', row: 1 },
    date: null, legacyCode: null, title: 'Ролик', description: null, productionBrief: null,
    sourceUrl: null, masterUrl: null, platforms: [], shootNote: null, clientHint: 'Диамед',
    ...overrides,
  }
}

describe('dedupContentRows', () => {
  it('merges the real Д186 example across three sources by legacy code (HIGH)', () => {
    const rows = [
      row({ trace: { file: 'Финансы SMM 2470.xlsx', sheet: 'Август', row: 24 }, legacyCode: 'Д186', title: 'Давид / Вадим — Может ли зубной техник быть без диплома', date: '2026-08-05' }),
      row({ trace: { file: 'Контент-план Диамед РАБОЧИЙ.xlsx', sheet: 'август', row: 10 }, legacyCode: 'Д186', title: 'Давид / Вадим — Может ли зубной техник быть без диплома' }),
      row({ trace: { file: 'Контент-план Диамед.xlsx', sheet: 'август', row: 10 }, title: 'Давид / Вадим — Может ли зубной техник быть без диплома', date: '2026-08-05' }),
    ]
    const groups = dedupContentRows(rows)
    expect(groups).toHaveLength(1)
    expect(groups[0].confidence).toBe('HIGH')
    expect(groups[0].rows).toHaveLength(3)
  })

  it('does not merge the same legacy code across different clients', () => {
    const rows = [
      row({ legacyCode: 'А1', clientHint: 'АльгизВет', title: 'Клип 1' }),
      row({ legacyCode: 'А1', clientHint: 'Пастернак', title: 'Другой ролик' }),
    ]
    const groups = dedupContentRows(rows)
    expect(groups).toHaveLength(2)
  })

  it('merges title-only rows without a code when date also matches (HIGH)', () => {
    const rows = [
      row({ title: 'Путь заказа в лаборатории - цифра', date: '2026-07-05' }),
      row({ title: 'Путь заказа в лаборатории - цифра', date: '2026-07-05' }),
    ]
    const groups = dedupContentRows(rows)
    expect(groups).toHaveLength(1)
    expect(groups[0].confidence).toBe('HIGH')
  })

  it('keeps title-only matches without any date at MEDIUM confidence (needs review)', () => {
    const rows = [
      row({ title: 'Пост про акцию' }),
      row({ title: 'Пост про акцию' }),
    ]
    const groups = dedupContentRows(rows)
    expect(groups).toHaveLength(1)
    expect(groups[0].confidence).toBe('MEDIUM')
  })

  it('downgrades to LOW when rows in a title-matched group disagree on date (possible false merge)', () => {
    const rows = [
      row({ title: 'Пост-опрос: ПЦР отрицательная', date: '2026-07-27' }),
      row({ title: 'Пост-опрос: ПЦР отрицательная', date: '2026-08-27' }),
    ]
    const groups = dedupContentRows(rows)
    expect(groups).toHaveLength(1)
    expect(groups[0].confidence).toBe('LOW')
  })

  it('keeps genuinely distinct content as separate groups', () => {
    const rows = [
      row({ legacyCode: 'Д1', title: 'Ролик A' }),
      row({ legacyCode: 'Д2', title: 'Ролик B' }),
    ]
    const groups = dedupContentRows(rows)
    expect(groups).toHaveLength(2)
  })

  it('summarizeConfidence counts groups by bucket', () => {
    const rows = [
      row({ legacyCode: 'Д1' }),
      row({ title: 'Без кода и даты' }),
    ]
    const summary = summarizeConfidence(dedupContentRows(rows))
    expect(summary.HIGH).toBe(1)
    expect(summary.MEDIUM).toBe(1)
    expect(summary.LOW).toBe(0)
  })
})
