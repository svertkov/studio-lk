import { describe, it, expect } from 'vitest'
import {
  orderTableDate, compareOrdersForTable, orderTableSearchHaystack, type OrderTableRow,
  orderShootDisplay, orderDurationSecondaryLabel, orderPaymentCellDisplay,
  getOrdersTableTier, ORDERS_TABLE_MOBILE_MAX_WIDTH, ORDERS_TABLE_COMPACT_MAX_WIDTH,
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

const RUB = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 })

describe('orderPaymentCellDisplay — объединённая колонка "Оплата" (стоимость + статус)', () => {
  it('shows the amount as primary and the payment status label as secondary', () => {
    // Built via the same Intl.NumberFormat as the implementation, not a hardcoded
    // literal — ru-RU currency formatting uses a non-breaking space as the
    // thousands separator, which is easy to mistype as a plain space in a test.
    expect(orderPaymentCellDisplay({ paymentStatus: 'UNPAID', preliminaryAmount: 9000, durationMinutes: 120 }))
      .toEqual({ primary: RUB.format(9000), secondary: 'Не оплачено' })
  })

  it('shows "Нет данных" as primary when no amount is set', () => {
    expect(orderPaymentCellDisplay({ paymentStatus: 'NOT_SPECIFIED', preliminaryAmount: null, durationMinutes: 60 }))
      .toEqual({ primary: 'Нет данных', secondary: 'Не указана' })
  })

  it('shows "Абонемент" with consumed duration for subscription orders, not the generic payment label', () => {
    expect(orderPaymentCellDisplay({ paymentStatus: 'SUBSCRIPTION', preliminaryAmount: null, durationMinutes: 120 }))
      .toEqual({ primary: 'Абонемент', secondary: 'Списано 2 ч' })
  })

  it('falls back to the generic subscription label when duration is unknown', () => {
    expect(orderPaymentCellDisplay({ paymentStatus: 'SUBSCRIPTION', preliminaryAmount: null, durationMinutes: null }))
      .toEqual({ primary: 'Абонемент', secondary: 'По абонементу' })
  })
})

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
