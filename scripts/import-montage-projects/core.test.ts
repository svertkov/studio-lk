import { describe, it, expect } from 'vitest'
import {
  parseRuDate, parseRuMoney, normalizeEditorKey, splitExecutors, resolveClientMatch, buildFingerprint,
  collectDistinctEditors, type MontageImportRow,
} from './core'

describe('parseRuDate — разбор дат формата ДД.ММ.ГГГГ', () => {
  it('parses a valid date', () => {
    const d = parseRuDate('07.10.2025')
    expect(d?.toISOString().slice(0, 10)).toBe('2025-10-07')
  })

  it('handles single-digit day/month', () => {
    const d = parseRuDate('7.1.2026')
    expect(d?.toISOString().slice(0, 10)).toBe('2026-01-07')
  })

  it('returns null for empty or malformed input', () => {
    expect(parseRuDate('')).toBeNull()
    expect(parseRuDate('не дата')).toBeNull()
    expect(parseRuDate('2025-10-07')).toBeNull()
  })
})

describe('parseRuMoney — разбор рублёвых сумм с разными разделителями', () => {
  it('parses "р.16 000,00" style amounts', () => {
    expect(parseRuMoney('р.16 000,00')).toBe(16000)
  })

  it('parses zero', () => {
    expect(parseRuMoney('р.0,00')).toBe(0)
  })

  it('parses plain numbers without currency prefix', () => {
    expect(parseRuMoney('12000')).toBe(12000)
  })

  it('returns null for empty input', () => {
    expect(parseRuMoney('')).toBeNull()
    expect(parseRuMoney('   ')).toBeNull()
  })

  it('handles negative amounts', () => {
    expect(parseRuMoney('-р.500,00')).toBe(-500)
  })
})

describe('normalizeEditorKey — дедупликация написаний "ё"/"е"', () => {
  it('treats "Иван Тесёлкин" and "Иван Теселкин" as the same key', () => {
    expect(normalizeEditorKey('Иван Тесёлкин')).toBe(normalizeEditorKey('Иван Теселкин'))
  })

  it('collapses whitespace and case', () => {
    expect(normalizeEditorKey('  Сергей   Зубарев ')).toBe(normalizeEditorKey('сергей зубарев'))
  })
})

describe('splitExecutors — несколько исполнителей в одной ячейке', () => {
  it('splits on "/" and returns primary + extras', () => {
    expect(splitExecutors('Сергей Зубарев / Леха Теселкин')).toEqual({ primary: 'Сергей Зубарев', extra: ['Леха Теселкин'] })
  })

  it('splits on ","', () => {
    expect(splitExecutors('Иван Иванов, Пётр Петров')).toEqual({ primary: 'Иван Иванов', extra: ['Пётр Петров'] })
  })

  it('returns a single primary with no extras for a plain name', () => {
    expect(splitExecutors('Сергей Зубарев')).toEqual({ primary: 'Сергей Зубарев', extra: [] })
  })

  it('splits on "+" — real sheet example: name + work-type annotation', () => {
    // Реальная строка 76 исходной таблицы: "+" здесь не второй исполнитель,
    // а пометка доп. вида работ, но splitExecutors всё равно обязана отделить
    // её от имени, иначе normalizeEditorKey не сольёт этого монтажёра с его
    // же профилем из других строк ("Иван Тесёлкин"/"Иван Теселкин").
    expect(splitExecutors('Иван Теселкин + моушен')).toEqual({ primary: 'Иван Теселкин', extra: ['моушен'] })
  })

  it('handles three executors split by "/"', () => {
    expect(splitExecutors('Никита Никитин / Никита Звук / Андрей Жилин'))
      .toEqual({ primary: 'Никита Никитин', extra: ['Никита Звук', 'Андрей Жилин'] })
  })
})

describe('resolveClientMatch — сопоставление заказчика из таблицы с базой клиентов', () => {
  const clients = [
    { id: 'c1', name: 'Наталия Богданова и Нина' },
    { id: 'c2', name: 'ОБИТ' },
    { id: 'c3', name: 'Ребелгруп' },
  ]

  it('matches exact (case-insensitive) name automatically', () => {
    expect(resolveClientMatch('обит', clients)).toEqual({ clientId: 'c2', clientName: 'ОБИТ', kind: 'exact' })
  })

  it('matches an unambiguous substring automatically', () => {
    const result = resolveClientMatch('Ребелгруп', clients)
    expect(result.kind).toBe('exact')
    expect(result.clientId).toBe('c3')
  })

  it('does NOT auto-match on word overlap alone — only suggests', () => {
    const result = resolveClientMatch('Наталия и Нина', clients)
    expect(result.clientId).toBeNull()
    expect(result.kind).toBe('suggested')
    expect(result.suggestion?.id).toBe('c1')
  })

  it('returns none when nothing overlaps', () => {
    const result = resolveClientMatch('Совершенно другое имя', clients)
    expect(result.kind).toBe('none')
    expect(result.clientId).toBeNull()
  })

  it('returns none for empty input', () => {
    expect(resolveClientMatch('', clients).kind).toBe('none')
  })
})

describe('buildFingerprint — идемпотентность импорта', () => {
  const base = { dateStr: '07.10.2025', clientRaw: 'ОБИТ', title: 'Монтаж подкаста', executorRaw: 'Сергей Зубарев', clientAmountStr: 'р.16 000,00', deadlineStr: '18.10.2025' }

  it('is stable for the same input', () => {
    expect(buildFingerprint(base)).toBe(buildFingerprint({ ...base }))
  })

  it('is case/whitespace-insensitive', () => {
    expect(buildFingerprint(base)).toBe(buildFingerprint({ ...base, clientRaw: '  обит  ' }))
  })

  it('changes when a meaningful field changes', () => {
    expect(buildFingerprint(base)).not.toBe(buildFingerprint({ ...base, clientAmountStr: 'р.20 000,00' }))
  })

  it('does not depend on client name alone — different clients with the same date/title/executor/amount/deadline still differ if any field differs', () => {
    const other = { ...base, clientRaw: 'Другой клиент' }
    expect(buildFingerprint(base)).not.toBe(buildFingerprint(other))
  })
})

describe('collectDistinctEditors — нормализация + выбор отображаемого варианта', () => {
  function makeRow(overrides: Partial<MontageImportRow>): MontageImportRow {
    return {
      sheetRow: 1, dateStr: '', clientRaw: '', statusRaw: '', title: '', sourceUrl: '', deadlineStr: '',
      clientAmountStr: '', editorAmountStr: '', profitStr: '', terms: '', revisions: '', executorRaw: '',
      sourceReceivedAt: null, deadlineDate: null, clientAmount: null, editorAmount: null,
      sheetStatedProfit: null, computedProfit: null, profitMismatch: false, status: 'DELIVERED',
      clientPaymentStatus: 'PAID', editorPaymentStatus: 'PAID',
      clientMatch: { clientId: 'c1', clientName: 'Клиент', kind: 'exact' },
      executorPrimaryRaw: 'Иван Теселкин', executorExtraRaw: [], executorKey: normalizeEditorKey('Иван Теселкин'),
      fingerprint: 'fp', action: 'create',
      ...overrides,
    }
  }

  it('merges different spellings of the same editor into one entry', () => {
    const rows = [
      makeRow({ executorPrimaryRaw: 'Иван Теселкин', executorKey: normalizeEditorKey('Иван Теселкин') }),
      makeRow({ executorPrimaryRaw: 'Иван Тесёлкин', executorKey: normalizeEditorKey('Иван Тесёлкин') }),
    ]
    const editors = collectDistinctEditors(rows)
    expect(editors).toHaveLength(1)
    expect(editors[0].displayName).toBe('Иван Тесёлкин') // предпочитается вариант с "ё"
  })

  it('ignores rows that are not going to be created', () => {
    const rows = [makeRow({ action: 'skip_client_unmatched' })]
    expect(collectDistinctEditors(rows)).toHaveLength(0)
  })

  it('ignores rows without an executor', () => {
    const rows = [makeRow({ executorPrimaryRaw: '', executorKey: null })]
    expect(collectDistinctEditors(rows)).toHaveLength(0)
  })
})
