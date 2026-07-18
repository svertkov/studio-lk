import { describe, it, expect } from 'vitest'
import {
  orderTableDate, compareOrdersForTable, orderTableSearchHaystack, type OrderTableRow,
  orderShootDisplay, orderDurationSecondaryLabel,
  getOrdersTableTier, ORDERS_TABLE_MOBILE_MAX_WIDTH, ORDERS_TABLE_COMPACT_MAX_WIDTH,
  isOrdersTableDense, ORDERS_TABLE_DENSE_MAX_WIDTH,
  groupOrdersByMonth, getHiddenMonthsCount, pluralizeOrdersCount, monthGroupDurationLabel,
  computeOrderNetProfit,
} from './order-model'

function makeRow(overrides: Partial<OrderTableRow> = {}): OrderTableRow {
  return {
    id: 'order-1',
    status: 'LEAD',
    clientName: 'Иван Иванов',
    clientPhone: '+79991234567',
    clientTelegram: null,
    clientEmail: null,
    companyName: null,
    serviceType: 'Подкаст',
    room: 'Светлый зал',
    comment: null,
    preliminaryAmount: 10000,
    paymentStatus: 'NOT_SPECIFIED',
    plannedStartTime: '2026-07-10T10:00:00.000Z',
    durationMinutes: 90,
    createdAt: '2026-07-01T09:00:00.000Z',
    hasMaterials: false,
    nasBackupUrl: null,
    editingRequired: null,
    makeupDurationMinutes: null,
    ...overrides,
  }
}

describe('orderTableDate — дата заказа для хронологического списка', () => {
  it('uses plannedStartTime when the order already has a scheduled booking', () => {
    const row = makeRow({ plannedStartTime: '2026-07-10T10:00:00.000Z', createdAt: '2026-07-01T09:00:00.000Z' })
    expect(orderTableDate(row)).toBe('2026-07-10T10:00:00.000Z')
  })

  it('falls back to createdAt for a lead without a scheduled booking', () => {
    const row = makeRow({ plannedStartTime: null, createdAt: '2026-07-01T09:00:00.000Z' })
    expect(orderTableDate(row)).toBe('2026-07-01T09:00:00.000Z')
  })
})

describe('compareOrdersForTable — сортировка списка заказов', () => {
  it('sorts by date descending (newest first) — the default sort', () => {
    const older = makeRow({ id: 'a', plannedStartTime: '2026-07-01T10:00:00.000Z' })
    const newer = makeRow({ id: 'b', plannedStartTime: '2026-07-10T10:00:00.000Z' })
    const sorted = [older, newer].sort((x, y) => compareOrdersForTable(x, y, 'date', 'desc'))
    expect(sorted.map(o => o.id)).toEqual(['b', 'a'])
  })

  it('sorts by date ascending when toggled', () => {
    const older = makeRow({ id: 'a', plannedStartTime: '2026-07-01T10:00:00.000Z' })
    const newer = makeRow({ id: 'b', plannedStartTime: '2026-07-10T10:00:00.000Z' })
    const sorted = [newer, older].sort((x, y) => compareOrdersForTable(x, y, 'date', 'asc'))
    expect(sorted.map(o => o.id)).toEqual(['a', 'b'])
  })

  it('sorts by client name using Russian locale order', () => {
    const anna = makeRow({ id: 'anna', clientName: 'Анна' })
    const boris = makeRow({ id: 'boris', clientName: 'Борис' })
    const sorted = [boris, anna].sort((x, y) => compareOrdersForTable(x, y, 'client', 'asc'))
    expect(sorted.map(o => o.id)).toEqual(['anna', 'boris'])
  })

  it('sorts by duration, treating missing duration as shortest', () => {
    const short = makeRow({ id: 'short', durationMinutes: 30 })
    const long = makeRow({ id: 'long', durationMinutes: 120 })
    const unknown = makeRow({ id: 'unknown', durationMinutes: null })
    const sorted = [long, short, unknown].sort((x, y) => compareOrdersForTable(x, y, 'duration', 'asc'))
    expect(sorted.map(o => o.id)).toEqual(['unknown', 'short', 'long'])
  })

  it('sorts by amount', () => {
    const cheap = makeRow({ id: 'cheap', preliminaryAmount: 5000 })
    const expensive = makeRow({ id: 'expensive', preliminaryAmount: 20000 })
    const sorted = [expensive, cheap].sort((x, y) => compareOrdersForTable(x, y, 'amount', 'asc'))
    expect(sorted.map(o => o.id)).toEqual(['cheap', 'expensive'])
  })

  it('sorts by status in the same order as the CRM board columns, not alphabetically', () => {
    const editing = makeRow({ id: 'editing', status: 'EDITING' })
    const lead = makeRow({ id: 'lead', status: 'LEAD' })
    const completed = makeRow({ id: 'completed', status: 'COMPLETED' })
    const sorted = [completed, editing, lead].sort((x, y) => compareOrdersForTable(x, y, 'status', 'asc'))
    expect(sorted.map(o => o.id)).toEqual(['lead', 'editing', 'completed'])
  })
})

describe('orderTableSearchHaystack — поиск по списку заказов', () => {
  it('matches on client name, phone, telegram, email, company, format, room and comment', () => {
    const row = makeRow({
      clientName: 'Сергей Соломатин',
      clientPhone: '+79991234567',
      clientTelegram: '@solomatin',
      clientEmail: 'solomatin@example.com',
      companyName: 'ООО Ромашка',
      serviceType: 'Интервью',
      room: 'Тёмный зал',
      comment: 'Акция! 20% скидка на первую запись',
    })
    const haystack = orderTableSearchHaystack(row)
    for (const needle of ['сергей', 'солома', '+7999', 'solomatin', 'ромашка', 'интервью', 'тёмный', 'скидка']) {
      expect(haystack).toContain(needle)
    }
  })

  it('does not throw and produces an empty-ish string when every optional field is missing', () => {
    const row = makeRow({
      clientName: null, clientPhone: null, clientTelegram: null, clientEmail: null,
      companyName: null, serviceType: null, room: null, comment: null, preliminaryAmount: null,
    })
    expect(orderTableSearchHaystack(row)).toBe('')
  })
})

describe('orderShootDisplay — объединённая колонка "Съёмка" (зал + формат)', () => {
  it('returns the format as-is and the room when both are set', () => {
    expect(orderShootDisplay({ serviceType: 'Подкаст', room: 'Светлый зал' }))
      .toEqual({ format: 'Подкаст', room: 'Светлый зал' })
  })

  it('falls back to an explicit "Не указан" label when format is missing, keeping the room', () => {
    expect(orderShootDisplay({ serviceType: null, room: 'Светлый зал' }))
      .toEqual({ format: 'Не указан', room: 'Светлый зал' })
  })

  it('returns a null room when the room is not set, without inventing one', () => {
    expect(orderShootDisplay({ serviceType: 'Подкаст', room: null }))
      .toEqual({ format: 'Подкаст', room: null })
  })
})

describe('orderDurationSecondaryLabel — гримёр под длительностью', () => {
  it('returns null when there is no makeup time', () => {
    expect(orderDurationSecondaryLabel({ makeupDurationMinutes: null })).toBeNull()
  })

  it('returns null when makeup time is zero (not just missing)', () => {
    expect(orderDurationSecondaryLabel({ makeupDurationMinutes: 0 })).toBeNull()
  })

  it('formats 30 minutes as "Гримёр 30 мин"', () => {
    expect(orderDurationSecondaryLabel({ makeupDurationMinutes: 30 })).toBe('Гримёр 30 мин')
  })

  it('formats 60 minutes as "Гримёр 1 ч"', () => {
    expect(orderDurationSecondaryLabel({ makeupDurationMinutes: 60 })).toBe('Гримёр 1 ч')
  })

  it('formats 90 minutes as "Гримёр 1 ч 30 мин"', () => {
    expect(orderDurationSecondaryLabel({ makeupDurationMinutes: 90 })).toBe('Гримёр 1 ч 30 мин')
  })
})

// Тесты бывшей orderPaymentCellDisplay перенесены в payment-model.test.ts —
// логика теперь живёт в getOrderPaymentSummary (src/lib/payment-model.ts),
// единой для всех экранов с оплатой заказа, не только для этой таблицы.

describe('getOrdersTableTier — адаптивные уровни таблицы по измеренной ширине', () => {
  it('is "mobile" at and below the mobile breakpoint', () => {
    expect(getOrdersTableTier(320)).toBe('mobile')
    expect(getOrdersTableTier(ORDERS_TABLE_MOBILE_MAX_WIDTH)).toBe('mobile')
  })

  it('is "compact" just above the mobile breakpoint and at the compact breakpoint', () => {
    expect(getOrdersTableTier(ORDERS_TABLE_MOBILE_MAX_WIDTH + 1)).toBe('compact')
    expect(getOrdersTableTier(ORDERS_TABLE_COMPACT_MAX_WIDTH)).toBe('compact')
  })

  it('is "full" above the compact breakpoint, including the 1280px viewport content width', () => {
    expect(getOrdersTableTier(ORDERS_TABLE_COMPACT_MAX_WIDTH + 1)).toBe('full')
    // 1280px viewport minus the 240px sidebar and 64px page padding.
    expect(getOrdersTableTier(1280 - 240 - 64)).toBe('full')
  })
})

describe('groupOrdersByMonth — группировка списка заказов по календарному месяцу', () => {
  it('groups orders into their calendar month using the same date orderTableDate uses', () => {
    const groups = groupOrdersByMonth([
      makeRow({ id: 'a', plannedStartTime: '2026-07-10T10:00:00.000Z' }),
      makeRow({ id: 'b', plannedStartTime: '2026-07-01T10:00:00.000Z' }),
      makeRow({ id: 'c', plannedStartTime: '2026-06-15T10:00:00.000Z' }),
    ])
    expect(groups.map(g => g.key)).toEqual(['2026-07', '2026-06'])
    expect(groups[0].orders.map(o => o.id)).toEqual(['a', 'b'])
    expect(groups[1].orders.map(o => o.id)).toEqual(['c'])
  })

  it('produces a capitalized Russian month + year label', () => {
    const groups = groupOrdersByMonth([makeRow({ plannedStartTime: '2026-07-10T10:00:00.000Z' })])
    expect(groups[0].label).toBe('Июль 2026')
  })

  it('sorts months from newest to oldest regardless of input order', () => {
    const groups = groupOrdersByMonth([
      makeRow({ id: 'old', plannedStartTime: '2025-03-05T10:00:00.000Z' }),
      makeRow({ id: 'new', plannedStartTime: '2026-07-10T10:00:00.000Z' }),
      makeRow({ id: 'mid', plannedStartTime: '2025-12-01T10:00:00.000Z' }),
    ])
    expect(groups.map(g => g.key)).toEqual(['2026-07', '2025-12', '2025-03'])
  })

  it('falls back to createdAt month for leads without a scheduled booking', () => {
    const groups = groupOrdersByMonth([
      makeRow({ plannedStartTime: null, createdAt: '2026-05-20T09:00:00.000Z' }),
    ])
    expect(groups[0].key).toBe('2026-05')
  })

  it('does not produce empty month groups for an empty order list', () => {
    expect(groupOrdersByMonth([])).toEqual([])
  })
})

describe('getHiddenMonthsCount — сколько месячных блоков скрыто под кнопкой "Показать более ранние"', () => {
  it('returns the difference when there are more groups than visible', () => {
    expect(getHiddenMonthsCount(10, 3)).toBe(7)
  })

  it('never returns a negative number when everything is already visible', () => {
    expect(getHiddenMonthsCount(2, 3)).toBe(0)
  })
})

describe('pluralizeOrdersCount — русское склонение числа заказов', () => {
  it('handles 1/21/31 as "заказ"', () => {
    expect(pluralizeOrdersCount(1)).toBe('1 заказ')
    expect(pluralizeOrdersCount(21)).toBe('21 заказ')
  })

  it('handles 2-4/22-24 as "заказа"', () => {
    expect(pluralizeOrdersCount(2)).toBe('2 заказа')
    expect(pluralizeOrdersCount(3)).toBe('3 заказа')
    expect(pluralizeOrdersCount(22)).toBe('22 заказа')
  })

  it('handles 5-20 and 11-14 as "заказов"', () => {
    expect(pluralizeOrdersCount(5)).toBe('5 заказов')
    expect(pluralizeOrdersCount(11)).toBe('11 заказов')
    expect(pluralizeOrdersCount(12)).toBe('12 заказов')
    expect(pluralizeOrdersCount(0)).toBe('0 заказов')
  })
})

describe('monthGroupDurationLabel — суммарная длительность месячного блока', () => {
  it('sums known durations and formats them like a single duration', () => {
    const orders = [makeRow({ durationMinutes: 90 }), makeRow({ durationMinutes: 30 })]
    expect(monthGroupDurationLabel(orders)).toBe('2 ч')
  })

  it('ignores orders with unknown duration rather than treating them as zero', () => {
    const orders = [makeRow({ durationMinutes: 60 }), makeRow({ durationMinutes: null })]
    expect(monthGroupDurationLabel(orders)).toBe('1 ч')
  })

  it('returns null (not "0 ч") when no order in the group has a known duration', () => {
    expect(monthGroupDurationLabel([makeRow({ durationMinutes: null })])).toBeNull()
  })

  it('returns null for an empty group', () => {
    expect(monthGroupDurationLabel([])).toBeNull()
  })
})

describe('isOrdersTableDense — плотный режим для узких десктопных ширин (1366/1280px)', () => {
  it('is dense at and below the threshold (matches measured 1366px container width)', () => {
    expect(isOrdersTableDense(ORDERS_TABLE_DENSE_MAX_WIDTH)).toBe(true)
    expect(isOrdersTableDense(1060)).toBe(true) // измеренная ширина контейнера на 1366px viewport
    expect(isOrdersTableDense(974)).toBe(true)  // измеренная ширина контейнера на 1280px viewport
  })

  it('is not dense above the threshold (matches measured 1440px+ container width)', () => {
    expect(isOrdersTableDense(ORDERS_TABLE_DENSE_MAX_WIDTH + 1)).toBe(false)
    expect(isOrdersTableDense(1134)).toBe(false) // измеренная ширина контейнера на 1440px viewport
  })
})

describe('computeOrderNetProfit — прибыль заказа (AUTO/MANUAL_OVERRIDE)', () => {
  it('AUTO: revenue minus montage payout', () => {
    const r = computeOrderNetProfit({ revenue: 35800, montageEditorAmountTotal: 17600, mode: 'AUTO', manualAmount: null })
    expect(r).toEqual({ mode: 'AUTO', amount: 18200, autoAmount: 18200 })
  })

  it('AUTO: no montage payout — profit equals revenue', () => {
    const r = computeOrderNetProfit({ revenue: 12000, montageEditorAmountTotal: null, mode: 'AUTO', manualAmount: null })
    expect(r.amount).toBe(12000)
    expect(r.autoAmount).toBe(12000)
  })

  it('AUTO: unknown revenue — null, not 0', () => {
    const r = computeOrderNetProfit({ revenue: null, montageEditorAmountTotal: 5000, mode: 'AUTO', manualAmount: null })
    expect(r.amount).toBeNull()
    expect(r.autoAmount).toBeNull()
  })

  it('MANUAL_OVERRIDE: displays the manual amount regardless of autoAmount', () => {
    const r = computeOrderNetProfit({ revenue: 35800, montageEditorAmountTotal: 17600, mode: 'MANUAL_OVERRIDE', manualAmount: 10000 })
    expect(r.amount).toBe(10000)
    expect(r.autoAmount).toBe(18200) // всё равно посчитан, для сравнения "автоматически было бы"
  })
})
