import type { TelegramConversationStatus } from '@prisma/client'

export type { TelegramConversationStatus }

// Централизованные подписи/цвета статуса диалога — по тому же принципу, что
// и ORDER_STATUS_LABELS в order-model.ts: одно место, не размазывать по UI.
export const TELEGRAM_STATUS_LABELS: Record<TelegramConversationStatus, string> = {
  NEW: 'Новый',
  IN_PROGRESS: 'В работе',
  CONVERTED_TO_ORDER: 'Стал заказом',
  ARCHIVED: 'Архив',
}

export const TELEGRAM_STATUS_COLORS: Record<TelegramConversationStatus, string> = {
  NEW: 'text-blue-400 bg-blue-950/30 border-blue-800',
  IN_PROGRESS: 'text-amber-400 bg-amber-950/30 border-amber-800',
  CONVERTED_TO_ORDER: 'text-[#00c26b] bg-[#00c26b]/10 border-[#00c26b]/40',
  ARCHIVED: 'text-zinc-500 bg-zinc-800/40 border-zinc-700',
}
