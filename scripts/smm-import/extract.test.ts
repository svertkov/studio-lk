import { describe, it, expect } from 'vitest'
import { extractContentRows, extractWorkPaymentRows, extractTeamPayoutRows } from './extract'
import type { RawGrid } from './xlsx-read'

function grid(rows: unknown[][], overrides: Partial<RawGrid> = {}): RawGrid {
  return {
    file: 'f.xlsx', sheet: 's', dimensions: 'A1', maxRow: rows.length, maxCol: Math.max(...rows.map(r => r.length)),
    declaredMaxRow: rows.length, declaredMaxCol: Math.max(...rows.map(r => r.length)),
    rows, mergedRanges: [], hiddenRows: [], hiddenCols: [],
    ...overrides,
  }
}
const d = (y: number, m: number, day: number) => new Date(Date.UTC(y, m - 1, day))

describe('extractContentRows', () => {
  it('resolves a swapped Дата/Индекс header by validating which column actually parses as dates (real ЗубовЛаб "июль" case)', () => {
    const g = grid([
      ['Дата', 'Индекс', 'название единицы / ролика'],
      ['ЗЛ1', d(2026, 7, 2), 'Видео знакомство'],
    ])
    const { rows } = extractContentRows(g, 'ЗубовЛаб')
    expect(rows).toHaveLength(1)
    expect(rows[0].date).toBe('2026-07-02')
    expect(rows[0].legacyCode).toBe('ЗЛ1')
  })

  it('finds the column-label row even when it sits BELOW the "Дата ..." header cell (real Диамед РАБОЧИЙ "февраль" case)', () => {
    const g = grid([
      [null, 'Дата публикации', 'Instagram'],
      ['номер', null, 'название единицы / ролика'],
      ['Д29', d(2026, 2, 5), 'Знакомство с Пашей'],
    ])
    const { rows } = extractContentRows(g, 'Диамед')
    expect(rows).toHaveLength(1)
    expect(rows[0].legacyCode).toBe('Д29')
    expect(rows[0].date).toBe('2026-02-05')
    expect(rows[0].title).toBe('Знакомство с Пашей')
  })

  it('groups platform title/metric columns into separate PlatformCell entries', () => {
    // Группа-заголовок площадки в реальных файлах — объединённая ячейка на
    // весь свой блок колонок (см. АЛЬГИЗ/ЗубовЛаб контент-планы); grid-utils
    // fillMergedCells разворачивает такой merge до вызова extractContentRows.
    const g = grid([
      [null, 'Инстаграм', null, null, 'Телеграм', null],
      ['Дата', 'пост / рилс / карусель', 'просмотры', 'комменты', 'пост', 'просмотры'],
      [d(2026, 7, 2), 'Видео', '3691', '10', 'Видео', '165'],
    ], { mergedRanges: ['B1:D1', 'E1:F1'] })
    const { rows } = extractContentRows(g, 'ЗубовЛаб')
    expect(rows).toHaveLength(1)
    expect(rows[0].platforms).toHaveLength(2)
    const ig = rows[0].platforms.find(p => p.platform === 'INSTAGRAM')
    expect(ig?.metrics.VIEWS).toBe(3691)
    expect(ig?.metrics.COMMENTS).toBe(10)
  })

  it('skips a weekend-marker row and an empty separator row without creating content candidates', () => {
    const g = grid([
      ['Дата', 'название единицы / ролика'],
      ['выходной', null],
      [d(2026, 7, 3), null],
      [d(2026, 7, 4), 'Реальный ролик'],
    ])
    const { rows, skippedServiceRows } = extractContentRows(g, 'ЗубовЛаб')
    expect(rows).toHaveLength(1)
    expect(skippedServiceRows).toBe(2)
  })
})

describe('extractWorkPaymentRows', () => {
  it('extracts a normal client block with a leading legacy-code column (real Диамед case)', () => {
    const g = grid([
      [null, 'Диамед'],
      [null, 'дата', 'единицы контента', 'стоимость'],
      ['Д171', d(2026, 7, 18), 'Паша: Харизма или качество', 1000],
    ])
    const rows = extractWorkPaymentRows(g)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ clientHint: 'Диамед', legacyCode: 'Д171', amount: 1000 })
  })

  it('recovers a legacy code stuffed into the date column when there is no real date (real Пастернак case)', () => {
    const g = grid([
      [null, 'Пастернак'],
      [null, 'дата', 'единицы контента', 'стоимость'],
      [null, 'П1', null, 1000],
    ])
    const rows = extractWorkPaymentRows(g)
    expect(rows).toHaveLength(1)
    expect(rows[0].legacyCode).toBe('П1')
    expect(rows[0].date).toBeNull()
  })
})

describe('extractTeamPayoutRows', () => {
  it('groups per-performer, per-client occurrences within a month block into one row with all due dates (real Оплата.xlsx case)', () => {
    const g = grid([
      ['Месяц', 'Сотрудник', 'Сотрудник', 'Диамед', 'Диамед'],
      [null, null, null, null, null],
      ['Дата', null, null, d(2026, 7, 2), d(2026, 7, 17)],
      ['Июль', 'Лиза Ваниосова', null, 20000, 20000],
    ])
    const rows = extractTeamPayoutRows(g)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ performerHint: 'Лиза Ваниосова', clientHint: 'Диамед', month: 'Июль' })
    expect(rows[0].dueDates).toEqual(['2026-07-02', '2026-07-17'])
    expect(rows[0].amounts).toEqual([20000, 20000])
  })
})
