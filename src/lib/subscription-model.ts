import type { SubscriptionStatus } from '@prisma/client'

export type { SubscriptionStatus }

export const SUBSCRIPTION_STATUS_LABELS: Record<SubscriptionStatus, string> = {
  ACTIVE:    'Активен',
  USED_UP:   'Использован',
  CANCELLED: 'Отменён',
}

export const SUBSCRIPTION_STATUS_COLORS: Record<SubscriptionStatus, string> = {
  ACTIVE:    'border-green-700 text-green-400',
  USED_UP:   'border-zinc-600 text-zinc-400',
  CANCELLED: 'border-red-700 text-red-400',
}
