import { describe, it, expect } from 'vitest'
import {
  orderTableDate, compareOrdersForTable, orderTableSearchHaystack, type OrderTableRow,
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
