// Единый источник истины для отображения оплаты заказа — заменяет собой
// разрозненное чтение Order.preliminaryAmount/paymentStatus/paymentMethod в
// каждом разделе по отдельности. Причина появления файла: карточка заказа,
// открываемая с дашборда/из расписания/из карточки клиента (EventCardModal),
// пишет реальную стоимость и способ оплаты в ScheduleEvent (estimatedPrice/
// paymentMethod) и реальное списание часов — в SubscriptionUsage; при этом
// раздел "Заказы"/CRM читал только собственные поля Order, которые эта
// карточка никогда не трогает — отсюда "Нет данных"/"Не указана" у заказов,
// где оплата на самом деле уже заполнена. Разрешение расхождения — на уровне
// чтения (см. toDTO в actions/orders.ts, тот же принцип двойного источника,
// что уже применяется для comment/notes и promotionType): ScheduleEvent
// побеждает, когда у заказа есть своя запись; здесь, в getOrderPaymentSummary,
// уже готовые (дуал-сорсенные) поля OrderDTO превращаются в единое
// нормализованное представление для всех экранов.
//
// Разграничение с client-shoots-model.ts (categorizeShootAmount): та функция
// считает ВЫРУЧКУ студии (Финансы, средний чек, кольцевая диаграмма) по всем
// съёмкам клиента, включая исторические ClientVisit без Order вообще, и
// сознательно не различает частичную/полную оплату — трогать её поведение
// нельзя, это денежные отчёты. getOrderPaymentSummary — только про то, что
// показать администратору в разделах, завязанных на конкретный Order
// (Заказы, CRM, карточка заказа). Источник сырых данных (ScheduleEvent) один
// и тот же для обеих функций, поэтому расхождений между "Заказы" и
// "Историей съёмок"/"Финансами" по одной и той же записи быть не должно.

import type { OrderPaymentStatus, PaymentMethod } from '@prisma/client'
import { ORDER_PAYMENT_STATUS_LABELS } from '@/lib/order-model'

export type { OrderPaymentStatus, PaymentMethod }

export type OrderPaymentType = 'SUBSCRIPTION' | 'AMOUNT' | 'UNKNOWN'

export interface OrderSubscriptionUsage {
  usedHours: number
  remainingHours: number | null
}

export interface OrderPaymentSummaryInput {
  preliminaryAmount: number | null
  paymentStatus: OrderPaymentStatus
  paymentMethod: PaymentMethod | null
  subscriptionUsage: OrderSubscriptionUsage | null
}

export interface OrderPaymentSummary {
  paymentType: OrderPaymentType
  totalAmount: number | null
  paymentMethod: PaymentMethod | null
  paymentStatus: OrderPaymentStatus
  subscriptionUsedHours: number | null
  subscriptionRemainingHours: number | null
  // Готовые строки для ячейки/капсулы — основная и вторичная строка, тот же
  // принцип "primary/secondary", что уже был у orderPaymentCellDisplay
  // (order-model.ts), которую эта функция теперь заменяет изнутри.
  displayPrimary: string
  displaySecondary: string
}

function formatMoney(amount: number): string {
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(amount)
}

// Экспортирован — переиспользуется в плотном ("dense") режиме таблицы
// "Заказы" для укороченного варианта строки абонемента ("Списано 2 ч" без
// "· осталось Xч", когда объединённая строка не помещается), чтобы не
// заводить вторую копию форматирования часов рядом с этой.
export function formatHoursShort(v: number): string {
  return `${v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)} ч`
}

// Order.paymentStatus по умолчанию NOT_SPECIFIED — не значит "администратор
// явно выбрал 'не указана'", чаще значит "статус ни разу не трогали", в то
// время как способ оплаты (paymentMethod) мог уже быть заполнен через
// EventCardModal (карточка записи не показывает отдельный статус, только
// стоимость и способ). Поэтому при NOT_SPECIFIED статус донастраивается по
// уже известному способу оплаты — это ЕДИНСТВЕННОЕ место в проекте, где
// делается такой вывод, дальше везде используется уже готовый paymentStatus.
// Если статус выставлен явно (кем-то через селектор в OrderFormModal, включая
// PARTIALLY_PAID) — он всегда побеждает и никогда не переопределяется здесь.
function deriveEffectiveStatus(status: OrderPaymentStatus, method: PaymentMethod | null): OrderPaymentStatus {
  if (status !== 'NOT_SPECIFIED') return status
  if (method === 'UNPAID') return 'UNPAID'
  if (method === 'SUBSCRIPTION') return 'SUBSCRIPTION'
  if (method != null) return 'PAID'
  return 'NOT_SPECIFIED'
}

export function getOrderPaymentSummary(order: OrderPaymentSummaryInput): OrderPaymentSummary {
  const effectiveStatus = deriveEffectiveStatus(order.paymentStatus, order.paymentMethod)
  const su = order.subscriptionUsage
  const amountKnown = order.preliminaryAmount != null

  // Абонемент — приоритетнее обычной суммы, но не исключает её: если у
  // заказа одновременно есть и сумма, и списание часов (смешанная оплата —
  // сейчас в UI карточки записи это два взаимоисключающих режима, но схема
  // этого не запрещает и переключение режима туда-обратно теоретически
  // может оставить оба поля заполненными), показываем оба.
  if (effectiveStatus === 'SUBSCRIPTION' || su) {
    const secondary = su
      ? `Списано ${formatHoursShort(su.usedHours)}${su.remainingHours != null ? ` · осталось ${formatHoursShort(su.remainingHours)}` : ''}`
      : ORDER_PAYMENT_STATUS_LABELS.SUBSCRIPTION
    return {
      paymentType: 'SUBSCRIPTION',
      totalAmount: order.preliminaryAmount,
      paymentMethod: order.paymentMethod,
      paymentStatus: 'SUBSCRIPTION',
      subscriptionUsedHours: su?.usedHours ?? null,
      subscriptionRemainingHours: su?.remainingHours ?? null,
      displayPrimary: amountKnown ? `${formatMoney(order.preliminaryAmount!)} + абонемент` : 'Абонемент',
      displaySecondary: secondary,
    }
  }

  return {
    paymentType: amountKnown ? 'AMOUNT' : 'UNKNOWN',
    totalAmount: order.preliminaryAmount,
    paymentMethod: order.paymentMethod,
    paymentStatus: effectiveStatus,
    subscriptionUsedHours: null,
    subscriptionRemainingHours: null,
    displayPrimary: amountKnown ? formatMoney(order.preliminaryAmount!) : 'Нет данных',
    displaySecondary: amountKnown || effectiveStatus !== 'NOT_SPECIFIED'
      ? ORDER_PAYMENT_STATUS_LABELS[effectiveStatus]
      : 'Стоимость не указана',
  }
}
