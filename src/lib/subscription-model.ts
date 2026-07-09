import type { SubscriptionStatus } from '@prisma/client'

export type { SubscriptionStatus }

// Порог "абонемент заканчивается" — общий для аналитики (Финансы), карточки
// клиента и выбора абонемента в заказе. Раньше жил как локальная константа в
// двух местах (finance.ts, SubscriptionsAnalyticsView.tsx) — вынесено сюда,
// чтобы не разъезжались, если порог когда-нибудь поменяют.
export const SUBSCRIPTION_LOW_HOURS_THRESHOLD = 2

export const SUBSCRIPTION_STATUS_LABELS: Record<SubscriptionStatus, string> = {
  ACTIVE:    'Активен',
  USED_UP:   'Использован',
  CANCELLED: 'Аннулирован',
  REFUNDED:  'Возврат',
}

export const SUBSCRIPTION_STATUS_COLORS: Record<SubscriptionStatus, string> = {
  ACTIVE:    'border-green-700 text-green-400',
  USED_UP:   'border-zinc-600 text-zinc-400',
  CANCELLED: 'border-red-700 text-red-400',
  REFUNDED:  'border-purple-700 text-purple-400',
}

// ============================================================
// "ВИЗУАЛЬНЫЙ" СТАТУС ДЛЯ БЕЙДЖА — шире, чем сырой status в БД: добавляет
// LOW (активен, но осталось мало часов — не отдельный статус в БД, просто
// визуальное предупреждение) и ARCHIVED (isArchived поверх любого статуса,
// см. схему: архивация не переписывает status, только скрывает из списков).
// Единственный источник правды для того, какой бейдж/цвет показать — везде,
// где сейчас отображается статус абонемента (Финансы, карточка клиента,
// карточка заказа).
// ============================================================

export type SubscriptionDisplayStatus = SubscriptionStatus | 'LOW' | 'ARCHIVED'

export interface SubscriptionStatusInput {
  status: SubscriptionStatus
  isArchived: boolean
  remainingHours: number
}

export function getSubscriptionDisplayStatus(input: SubscriptionStatusInput): SubscriptionDisplayStatus {
  if (input.isArchived) return 'ARCHIVED'
  if (input.status === 'ACTIVE' && input.remainingHours <= SUBSCRIPTION_LOW_HOURS_THRESHOLD) return 'LOW'
  return input.status
}

export const SUBSCRIPTION_DISPLAY_STATUS_LABELS: Record<SubscriptionDisplayStatus, string> = {
  ...SUBSCRIPTION_STATUS_LABELS,
  LOW:      'Заканчивается',
  ARCHIVED: 'В архиве',
}

export const SUBSCRIPTION_DISPLAY_STATUS_COLORS: Record<SubscriptionDisplayStatus, string> = {
  ...SUBSCRIPTION_STATUS_COLORS,
  LOW:      'border-amber-600 text-amber-400',
  ARCHIVED: 'border-zinc-700 text-zinc-500',
}

// ============================================================
// БИЗНЕС-ПРАВИЛА
// ============================================================

// Доступен ли абонемент для выбора при списании часов в заказе/записи —
// единственное условие: реально активен, не архивирован и есть остаток.
// used/cancelled/refunded/архивные сюда не попадают ни при каких условиях.
export function isSubscriptionSelectable(input: SubscriptionStatusInput): boolean {
  return input.status === 'ACTIVE' && !input.isArchived && input.remainingHours > 0
}

// Может ли автоматика (списание/возврат часов при сохранении записи)
// перекидывать статус между ACTIVE и USED_UP сама, без участия администратора.
// CANCELLED/REFUNDED — терминальные ручные статусы, автоматика их никогда не
// трогает (см. chargeEventToSubscription/removeEventSubscriptionCharge).
export function canAutoRecomputeStatus(status: SubscriptionStatus): boolean {
  return status === 'ACTIVE' || status === 'USED_UP'
}

// "Отметить использованным" (updateSubscriptionStatus) — административное
// действие поверх статуса, оно НЕ создаёт SubscriptionUsage и не трогает
// openingUsedHours (это исказило бы реальную историю списаний), поэтому
// сырой remainingHours (packageHours − usedHours) после такого действия может
// остаться положительным, хотя статус уже "Использован". Здесь — единственное
// место, где остаток "схлопывается" до 0 для отображения (Финансы, карточка
// клиента, список выбора в заказе), не трогая сами данные о списаниях.
export function displayRemainingHours(status: SubscriptionStatus, rawRemainingHours: number): number {
  return status === 'USED_UP' ? 0 : rawRemainingHours
}
