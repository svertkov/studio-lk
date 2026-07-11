import { describe, it, expect } from 'vitest'
import { getOrderPaymentSummary, type OrderPaymentSummaryInput } from './payment-model'

const RUB = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 })

function makeInput(overrides: Partial<OrderPaymentSummaryInput> = {}): OrderPaymentSummaryInput {
  return {
    preliminaryAmount: null,
    paymentStatus: 'NOT_SPECIFIED',
    paymentMethod: null,
    subscriptionUsage: null,
    ...overrides,
  }
}

describe('getOrderPaymentSummary — обычная оплата (без абонемента)', () => {
  it('полностью оплаченный заказ: сумма + "Оплачено"', () => {
    const summary = getOrderPaymentSummary(makeInput({ preliminaryAmount: 15000, paymentStatus: 'PAID', paymentMethod: 'CARD' }))
    expect(summary.displayPrimary).toBe(RUB.format(15000))
    expect(summary.displaySecondary).toBe('Оплачено')
    expect(summary.paymentStatus).toBe('PAID')
    expect(summary.paymentType).toBe('AMOUNT')
  })

  it('частично оплаченный заказ показывает остаток статусом (числового остатка в модели нет)', () => {
    const summary = getOrderPaymentSummary(makeInput({ preliminaryAmount: 15000, paymentStatus: 'PARTIALLY_PAID', paymentMethod: 'CASH' }))
    expect(summary.displayPrimary).toBe(RUB.format(15000))
    expect(summary.displaySecondary).toBe('Оплачено частично')
  })

  it('неоплаченный заказ показывает реальную стоимость и "Не оплачено"', () => {
    const summary = getOrderPaymentSummary(makeInput({ preliminaryAmount: 15000, paymentStatus: 'UNPAID', paymentMethod: 'UNPAID' }))
    expect(summary.displayPrimary).toBe(RUB.format(15000))
    expect(summary.displaySecondary).toBe('Не оплачено')
  })

  it('стоимость не указана: "Нет данных" / "Стоимость не указана", а не пустая ячейка', () => {
    const summary = getOrderPaymentSummary(makeInput())
    expect(summary.displayPrimary).toBe('Нет данных')
    expect(summary.displaySecondary).toBe('Стоимость не указана')
    expect(summary.paymentType).toBe('UNKNOWN')
  })
})

describe('getOrderPaymentSummary — вывод статуса из способа оплаты, когда явный статус не выставлен', () => {
  // Карточка записи (EventCardModal, дашборд/расписание/клиент) не имеет
  // отдельного селектора "статус оплаты" — только стоимость и способ. Заказ,
  // отредактированный оттуда, должен всё равно показывать осмысленный статус
  // в разделе "Заказы"/CRM, а не "Не указана", хотя оплата явно заполнена.
  it('paymentMethod=CARD + сумма, но paymentStatus=NOT_SPECIFIED -> считается оплаченным', () => {
    const summary = getOrderPaymentSummary(makeInput({ preliminaryAmount: 15000, paymentMethod: 'CARD' }))
    expect(summary.displaySecondary).toBe('Оплачено')
    expect(summary.paymentStatus).toBe('PAID')
  })

  it('paymentMethod=UNPAID -> "Не оплачено", даже если статус не выставлен явно', () => {
    const summary = getOrderPaymentSummary(makeInput({ preliminaryAmount: 15000, paymentMethod: 'UNPAID' }))
    expect(summary.displaySecondary).toBe('Не оплачено')
  })

  it('явно выставленный статус (например PARTIALLY_PAID) не переопределяется способом оплаты', () => {
    const summary = getOrderPaymentSummary(makeInput({ preliminaryAmount: 15000, paymentStatus: 'PARTIALLY_PAID', paymentMethod: 'CARD' }))
    expect(summary.displaySecondary).toBe('Оплачено частично')
  })
})

describe('getOrderPaymentSummary — оплата абонементом', () => {
  it('показывает "Абонемент" и реально списанные/оставшиеся часы, а не приближение по длительности записи', () => {
    const summary = getOrderPaymentSummary(makeInput({
      subscriptionUsage: { usedHours: 2, remainingHours: 4 },
    }))
    expect(summary.paymentType).toBe('SUBSCRIPTION')
    expect(summary.displayPrimary).toBe('Абонемент')
    expect(summary.displaySecondary).toBe('Списано 2 ч · осталось 4 ч')
    expect(summary.subscriptionUsedHours).toBe(2)
    expect(summary.subscriptionRemainingHours).toBe(4)
  })

  it('дробные часы форматируются с одним знаком после запятой', () => {
    const summary = getOrderPaymentSummary(makeInput({
      subscriptionUsage: { usedHours: 1.5, remainingHours: 0.5 },
    }))
    expect(summary.displaySecondary).toBe('Списано 1.5 ч · осталось 0.5 ч')
  })

  it('смешанная оплата (сумма + абонемент) показывает оба источника в основной строке', () => {
    const summary = getOrderPaymentSummary(makeInput({
      preliminaryAmount: 10000,
      subscriptionUsage: { usedHours: 1, remainingHours: 3 },
    }))
    expect(summary.displayPrimary).toBe(`${RUB.format(10000)} + абонемент`)
    expect(summary.displaySecondary).toBe('Списано 1 ч · осталось 3 ч')
  })

  it('paymentMethod=SUBSCRIPTION вручную (без реальной привязки) даёт статус "Абонемент" без часов', () => {
    const summary = getOrderPaymentSummary(makeInput({ paymentMethod: 'SUBSCRIPTION' }))
    expect(summary.paymentType).toBe('SUBSCRIPTION')
    expect(summary.displayPrimary).toBe('Абонемент')
    expect(summary.displaySecondary).toBe('По абонементу')
    expect(summary.subscriptionUsedHours).toBeNull()
  })

  it('реальная структурная связь subscriptionUsage побеждает, даже если paymentStatus указывает что-то другое', () => {
    const summary = getOrderPaymentSummary(makeInput({
      paymentStatus: 'UNPAID',
      subscriptionUsage: { usedHours: 2, remainingHours: 0 },
    }))
    expect(summary.paymentType).toBe('SUBSCRIPTION')
    expect(summary.paymentStatus).toBe('SUBSCRIPTION')
  })
})

describe('getOrderPaymentSummary — повторный вызов идемпотентен (чистая функция)', () => {
  it('одинаковый вход всегда даёт одинаковый результат — вызов дважды не меняет состояние', () => {
    const input = makeInput({ preliminaryAmount: 5000, paymentStatus: 'PAID', paymentMethod: 'CASH' })
    expect(getOrderPaymentSummary(input)).toEqual(getOrderPaymentSummary(input))
  })
})
