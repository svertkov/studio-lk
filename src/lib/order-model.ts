import type { OrderStatus, OrderSource, OrderPaymentStatus, PaymentMethod } from '@prisma/client'

export type { OrderStatus, OrderSource, OrderPaymentStatus }

// 5 основных колонок MVP-канбана — CANCELLED/ARCHIVED существуют в БД для
// будущего, но в интерфейсе MVP не показываются отдельными колонками.
export const ORDER_BOARD_COLUMNS: OrderStatus[] = ['LEAD', 'BOOKED', 'EDITING', 'REVISIONS', 'COMPLETED']

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  LEAD:      'Заявка',
  BOOKED:    'Записан в студию',
  EDITING:   'Монтаж',
  REVISIONS: 'Правки',
  COMPLETED: 'Работа завершена',
  CANCELLED: 'Отменён',
  ARCHIVED:  'Архив',
}

export const ORDER_SOURCE_LABELS: Record<OrderSource, string> = {
  MANUAL:          'Вручную',
  GOOGLE_CALENDAR: 'Google Calendar',
  OTHER:           'Другое',
}

export const ORDER_PAYMENT_STATUS_LABELS: Record<OrderPaymentStatus, string> = {
  NOT_SPECIFIED:  'Не указана',
  UNPAID:         'Не оплачено',
  PARTIALLY_PAID: 'Оплачено частично',
  PAID:           'Оплачено',
  SUBSCRIPTION:   'По абонементу',
}

export const ORDER_PAYMENT_STATUS_COLORS: Record<OrderPaymentStatus, string> = {
  NOT_SPECIFIED:  'text-zinc-400',
  UNPAID:         'text-red-400',
  PARTIALLY_PAID: 'text-amber-400',
  PAID:           'text-green-500',
  SUBSCRIPTION:   'text-blue-400',
}

// Способ оплаты заказа — то же перечисление, что и у разовой оплаты записи
// расписания, плюс SUBSCRIPTION (см. комментарий у enum PaymentMethod в схеме).
export const ORDER_PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH:         'Наличными',
  CARD:         'Картой',
  TRANSFER:     'Переводом',
  INVOICE:      'По счёту',
  UNPAID:       'Не оплачено',
  FREE:         'Бесплатно / бартер',
  OTHER:        'Другое',
  SUBSCRIPTION: 'Абонемент',
}

// Автоимпорт заказов из Google Calendar (ensureOrderForNewBooking) должен
// создавать заказы только для записей, начинающихся ПОСЛЕ этой даты — по
// явной просьбе пользователя (2026-07-04): раздел "Заказы" запускается с
// чистого листа, старые/прошедшие записи в календаре не должны задним числом
// становиться заказами, когда сотрудник открывает и сохраняет их карточку
// (например, чтобы просто добавить материалы). Ручное создание заказа через
// "+ Создать заказ" этим ограничением не связано.
export const ORDERS_AUTO_IMPORT_LAUNCH_DATE = new Date('2026-07-05T00:00:00')

export function computeDurationMinutes(start: string | null | undefined, end: string | null | undefined): number | null {
  if (!start || !end) return null
  const ms = new Date(end).getTime() - new Date(start).getTime()
  if (!Number.isFinite(ms) || ms <= 0) return null
  return Math.round(ms / 60000)
}
