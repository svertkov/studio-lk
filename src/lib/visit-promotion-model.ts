// Чистая логика "повышения" исторического визита (ClientVisit, из старого
// импорта Google-таблицы) до полноценного заказа (Order + ScheduleEvent) —
// используется скриптом scripts/promote-visits-to-orders (dry-run/apply),
// без обращения к Prisma напрямую, чтобы план можно было протестировать без
// подключения к базе.
//
// Переиспользует уже существующие helpers, а не дублирует их:
// - commentMentionsFirstVisitPromo/stripPromotionTextFromComment (promotion-model.ts)
//   — та же логика распознавания и очистки акции, что и везде на платформе;
// - isOrderReadyForArchive (order-model.ts) — тот же порог 7 дней для решения,
//   должен ли исторический (заведомо прошедший) заказ сразу попасть в архив.
//
// Абонемент по тексту комментария ("абонемент...") НЕ создаётся автоматически
// (решение владельца, 2026-07-12: слишком высокий риск придумать задним числом
// финансовую историю, которой не было структурированно зафиксировано) —
// такие визиты только помечаются needsSubscriptionReview для отчёта.

import type { OrderStatus, OrderPaymentStatus, PaymentMethod, ArchiveReason } from '@prisma/client'
import { commentMentionsFirstVisitPromo, stripPromotionTextFromComment, type OrderPromotionType } from '@/lib/promotion-model'
import { isOrderReadyForArchive } from '@/lib/order-model'

export interface VisitPromotionInput {
  id: string
  clientId: string
  date: Date | null
  startAt: Date | null
  endAt: Date | null
  room: string | null
  format: string | null
  durationHours: number | null
  grossAmount: number | null
  comment: string | null
}

export interface ClientSnapshot {
  name: string
  phone: string | null
  telegram: string | null
  email: string | null
  companyName: string | null
}

export type VisitPromotionAction = 'create' | 'skip_no_date'

export interface PromotedOrderData {
  clientId: string
  clientName: string
  clientPhone: string | null
  clientTelegram: string | null
  clientEmail: string | null
  companyName: string | null
  serviceType: string | null
  room: string | null
  plannedStartTime: Date | null
  plannedEndTime: Date | null
  durationMinutes: number | null
  preliminaryAmount: number | null
  paymentStatus: OrderPaymentStatus
  paymentMethod: PaymentMethod | null
  comment: string | null
  promotionType: OrderPromotionType | null
  status: OrderStatus
  completedAt: Date | null
  createdAt: Date
  statusUpdatedAt: Date
  isArchived: boolean
  archivedAt: Date | null
  archiveReason: ArchiveReason | null
}

export interface VisitPromotionPlan {
  visitId: string
  action: VisitPromotionAction
  promotionDetected: boolean
  needsStatusReview: boolean
  needsSubscriptionReview: boolean
  order: PromotedOrderData | null
}

// Признаки отмены/переноса в свободном тексте — намеренно НЕ приводят к
// автоматическому статусу CANCELLED (текст мог означать что угодно, включая
// "перенесли на 2 часа позже в тот же день"), а лишь исключают заказ из
// автоматического COMPLETED, оставляя его в BOOKED для ручной проверки
// администратором (см. ТЗ, п.13: "не должен помечаться завершённым автоматически").
const CANCELLATION_SIGNAL_RE = /отмен|отказ|не\s*приш[её]л|перенос/i

// Только флаг для отчёта — реальный SubscriptionUsage/ClientSubscription
// этим НЕ создаётся, см. комментарий в шапке файла.
const SUBSCRIPTION_MENTION_RE = /абонемент/i

const FREE_SIGNAL_RE = /бесплатн/i

export function detectCancellationSignal(comment: string | null): boolean {
  return !!comment && CANCELLATION_SIGNAL_RE.test(comment)
}

export function detectSubscriptionMention(comment: string | null): boolean {
  return !!comment && SUBSCRIPTION_MENTION_RE.test(comment)
}

export function detectFreeSignal(comment: string | null): boolean {
  return !!comment && FREE_SIGNAL_RE.test(comment)
}

// Стоимость известна из исходной таблицы (grossAmount) — считается уже
// полученной студией (тот же принцип, что уже применяется в существующем
// расчёте выручки, см. categorizeShootAmount/computeFinanceOverview в
// client-shoots-model.ts: сумма в таблице = деньги получены). Способ оплаты
// (картой/наличными/переводом) исходная таблица не фиксировала — не
// придумываем его, оставляем null, а не гадаем.
function derivePayment(grossAmount: number | null, isFree: boolean): {
  amount: number | null
  status: OrderPaymentStatus
  method: PaymentMethod | null
} {
  if (isFree) return { amount: grossAmount ?? 0, status: 'PAID', method: 'FREE' }
  if (grossAmount != null) return { amount: grossAmount, status: 'PAID', method: null }
  return { amount: null, status: 'NOT_SPECIFIED', method: null }
}

export function buildVisitPromotionPlan(
  visit: VisitPromotionInput, client: ClientSnapshot, now: Date = new Date(),
): VisitPromotionPlan {
  const anchorDate = visit.startAt ?? visit.date

  if (!anchorDate) {
    return {
      visitId: visit.id, action: 'skip_no_date',
      promotionDetected: false, needsStatusReview: false, needsSubscriptionReview: false,
      order: null,
    }
  }

  const promotionDetected = commentMentionsFirstVisitPromo(visit.comment)
  const rawCleanedComment = promotionDetected
    ? stripPromotionTextFromComment(visit.comment)
    : (visit.comment?.trim() || null)
  // Исходная таблица клала "0" в комментарий для строк без затрат (колонка
  // "Затраты" маппится в comment, см. detect.ts) — это не содержательный
  // комментарий, показывать его в карточке заказа как есть значило бы
  // выглядеть сломанным (ТЗ: комментарии должны быть содержательными полями,
  // не бессистемной склейкой). Сама ClientVisit.comment не трогается —
  // только то, что переносится в новый заказ.
  const cleanedComment = rawCleanedComment === '0' ? null : rawCleanedComment

  const needsStatusReview = detectCancellationSignal(visit.comment)
  const needsSubscriptionReview = detectSubscriptionMention(visit.comment)
  const isFree = detectFreeSignal(visit.comment)

  const payment = derivePayment(visit.grossAmount, isFree)

  const statusFields = needsStatusReview
    ? {
        status: 'BOOKED' as const,
        completedAt: null,
        isArchived: false,
        archivedAt: null,
        archiveReason: null,
      }
    : (() => {
        const archiveReady = isOrderReadyForArchive({ status: 'COMPLETED', completedAt: anchorDate, rejectedAt: null }, now)
        return {
          status: 'COMPLETED' as const,
          completedAt: anchorDate,
          isArchived: archiveReady,
          archivedAt: archiveReady ? now : null,
          archiveReason: (archiveReady ? 'COMPLETED' : null) as ArchiveReason | null,
        }
      })()

  return {
    visitId: visit.id,
    action: 'create',
    promotionDetected,
    needsStatusReview,
    needsSubscriptionReview,
    order: {
      clientId: visit.clientId,
      clientName: client.name,
      clientPhone: client.phone,
      clientTelegram: client.telegram,
      clientEmail: client.email,
      companyName: client.companyName,
      serviceType: visit.format,
      room: visit.room,
      plannedStartTime: visit.startAt,
      plannedEndTime: visit.endAt,
      durationMinutes: visit.durationHours != null ? Math.round(visit.durationHours * 60) : null,
      preliminaryAmount: payment.amount,
      paymentStatus: payment.status,
      paymentMethod: payment.method,
      comment: cleanedComment,
      promotionType: promotionDetected ? 'FIRST_VISIT_20' : null,
      status: statusFields.status,
      completedAt: statusFields.completedAt,
      createdAt: anchorDate,
      statusUpdatedAt: anchorDate,
      isArchived: statusFields.isArchived,
      archivedAt: statusFields.archivedAt,
      archiveReason: statusFields.archiveReason,
    },
  }
}
