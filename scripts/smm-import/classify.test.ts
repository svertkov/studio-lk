import { describe, it, expect } from 'vitest'
import { classifySheet, detectSheetDrift, detectWorkbookDrift } from './classify'
import type { RawGrid } from './xlsx-read'

function grid(rows: unknown[][], overrides: Partial<RawGrid> = {}): RawGrid {
  return {
    file: 'f.xlsx', sheet: 's', dimensions: 'A1', maxRow: rows.length, maxCol: rows[0]?.length ?? 0,
    declaredMaxRow: rows.length, declaredMaxCol: rows[0]?.length ?? 0,
    rows, mergedRanges: [], hiddenRows: [], hiddenCols: [],
    ...overrides,
  }
}

describe('classifySheet', () => {
  it('classifies a production-style sheet (title/materials columns) as PRODUCTION', () => {
    const g = grid([
      ['Дата', 'Индекс', 'название единицы / ролика', 'формат / описание', 'готовность исходников (ссылка)', 'готовность материала (ссылка)', 'опубликовано (ссылка)'],
    ])
    expect(classifySheet(g).type).toBe('PRODUCTION')
  })

  it('classifies a script/storyboard sheet as SCRIPT_LIBRARY', () => {
    const g = grid([['ТОК — СЦЕНАРИИ ДЛЯ ВИДЕО'], ['Локация и кадр', 'Сценарий / озвучка', 'Раскадровка']])
    expect(classifySheet(g).type).toBe('SCRIPT_LIBRARY')
  })

  it('classifies a per-content financial table as WORK_PAYMENTS', () => {
    const g = grid([['Дата', 'единицы контента', 'стоимость']])
    expect(classifySheet(g).type).toBe('WORK_PAYMENTS')
  })

  it('classifies a performer×client payout cross-tab as TEAM_PAYOUTS', () => {
    const g = grid([['Месяц', 'Сотрудник', 'Диамед'], ['Дата'], ['Июль', 'Лиза', '20000', 'Выплачено']])
    expect(classifySheet(g).type).toBe('TEAM_PAYOUTS')
  })

  it('marks a content-plan sheet with real metric columns as ANALYTICS+CONTENT_PLAN', () => {
    const g = grid([
      ['Дата', 'Площадка'], [null, 'Инстаграм'],
      ['Дата', 'пост / рилс / карусель', 'просмотры', 'комменты'],
    ])
    const c = classifySheet(g)
    expect(c.type === 'ANALYTICS' || c.secondaryTypes.includes('ANALYTICS')).toBe(true)
  })

  it('returns UNKNOWN for a sheet with no recognizable header keywords', () => {
    const g = grid([['Бюджет:', 'Итого:'], [null, '35000']])
    expect(classifySheet(g).type).toBe('UNKNOWN')
  })
})

describe('detectSheetDrift', () => {
  it('flags a weekend marker sitting in the date column', () => {
    const g = grid([['Дата'], ['выходной']])
    const issues = detectSheetDrift(g, 'PRODUCTION')
    expect(issues.some(i => i.kind === 'WEEKEND_MARKER_IN_DATE')).toBe(true)
  })

  it('flags a weekend marker sitting outside the date column (real Диамед РАБОЧИЙ case)', () => {
    const g = grid([['Дата', 'название'], ['2026-09-06', 'ВЫХОДНОЙ']])
    const issues = detectSheetDrift(g, 'PRODUCTION')
    expect(issues.some(i => i.kind === 'WEEKEND_MARKER_IN_TITLE')).toBe(true)
  })

  it('skips AMOUNT_AS_TEXT noise for non-financial sheet types (real SCRIPT_LIBRARY case)', () => {
    const g = grid([['1. Я шлифую древесину более 15 лет']])
    const issues = detectSheetDrift(g, 'SCRIPT_LIBRARY')
    expect(issues.some(i => i.kind === 'AMOUNT_AS_TEXT')).toBe(false)
  })

  it('flags AMOUNT_AS_TEXT for a compound text note in a financial sheet', () => {
    const g = grid([['Дата', 'единицы контента', 'стоимость'], ['2026-07-18', 'X', '25000 + 10000 (доп)']])
    const issues = detectSheetDrift(g, 'WORK_PAYMENTS')
    expect(issues.some(i => i.kind === 'AMOUNT_AS_TEXT')).toBe(true)
  })

  it('does not double-report the same merged-cell value replicated across columns by ExcelJS', () => {
    const g = grid([
      ['Дата', 'единицы контента', 'стоимость'],
      [new Date(Date.UTC(2026, 6, 18)), 'X', '25000 + 10000 (доп)', '25000 + 10000 (доп)'], // ExcelJS-стиль репликации merge
    ])
    const issues = detectSheetDrift(g, 'WORK_PAYMENTS')
    expect(issues.filter(i => i.kind === 'AMOUNT_AS_TEXT')).toHaveLength(1)
  })

  it('flags an out-of-range date serial (real Финансы SMM 2470 warning)', () => {
    const bogus = new Date(Date.UTC(1, 0, 1)) // валидный Date-объект, но год далеко за пределами разумного
    const g = grid([['Дата'], [bogus]])
    const issues = detectSheetDrift(g, 'PRODUCTION')
    expect(issues.some(i => i.kind === 'INVALID_DATE_SERIAL')).toBe(true)
  })
})

describe('detectWorkbookDrift', () => {
  it('flags column order changed between sheets of the same workbook (real ЗубовЛаб case)', () => {
    const g1 = grid([['Дата', 'Индекс']], { sheet: 'июль' })
    const g2 = grid([['Индекс', 'Дата']], { sheet: 'август' })
    const issues = detectWorkbookDrift([g1, g2])
    expect(issues.some(i => i.kind === 'COLUMN_ORDER_CHANGED')).toBe(true)
  })
})
