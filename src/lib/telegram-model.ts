import type { TelegramConversationStatus, TelegramConsentStatus, TelegramMessageStatus } from '@prisma/client'

export type { TelegramConversationStatus, TelegramConsentStatus, TelegramMessageStatus }

// Централизованные подписи/цвета статуса диалога — по тому же принципу, что
// и ORDER_STATUS_LABELS в order-model.ts: одно место, не размазывать по UI.
export const TELEGRAM_STATUS_LABELS: Record<TelegramConversationStatus, string> = {
  NEW: 'Новый',
  CONSENT_REQUIRED: 'Нужно согласие',
  CONSENT_GIVEN: 'Согласие получено',
  WAITING_MANAGER: 'Ожидает менеджера',
  IN_PROGRESS: 'В работе',
  ORDER_CREATED: 'Заказ создан',
  ARCHIVED: 'Архив',
  CONSENT_REVOKED: 'Согласие отозвано',
}

export const TELEGRAM_STATUS_COLORS: Record<TelegramConversationStatus, string> = {
  NEW: 'text-blue-400 bg-blue-950/30 border-blue-800',
  CONSENT_REQUIRED: 'text-amber-400 bg-amber-950/30 border-amber-800',
  CONSENT_GIVEN: 'text-cyan-400 bg-cyan-950/30 border-cyan-800',
  WAITING_MANAGER: 'text-violet-400 bg-violet-950/30 border-violet-800',
  IN_PROGRESS: 'text-blue-300 bg-blue-950/30 border-blue-800',
  ORDER_CREATED: 'text-[#00c26b] bg-[#00c26b]/10 border-[#00c26b]/40',
  ARCHIVED: 'text-zinc-500 bg-zinc-800/40 border-zinc-700',
  CONSENT_REVOKED: 'text-red-400 bg-red-950/30 border-red-800',
}

// Список статусов, показываемых как отдельные вкладки-фильтры в инбоксе,
// в порядке отображения. "Все" — отдельная синтетическая вкладка, не отсюда.
export const TELEGRAM_STATUS_FILTER_ORDER: TelegramConversationStatus[] = [
  'NEW', 'CONSENT_REQUIRED', 'CONSENT_GIVEN', 'WAITING_MANAGER', 'IN_PROGRESS', 'ORDER_CREATED', 'ARCHIVED', 'CONSENT_REVOKED',
]

export const TELEGRAM_CONSENT_STATUS_LABELS: Record<TelegramConsentStatus, string> = {
  NONE: 'Нет согласия',
  GIVEN: 'Согласие получено',
  REVOKED: 'Согласие отозвано',
}

export const TELEGRAM_MESSAGE_STATUS_LABELS: Record<TelegramMessageStatus, string> = {
  RECEIVED: 'Получено',
  PENDING: 'Отправляется…',
  SENT: 'Отправлено',
  FAILED: 'Не отправлено',
}

// Текстовые триггеры отзыва согласия — сравниваются регистронезависимо,
// после trim() (см. src/app/api/telegram/webhook/route.ts). Это не NLU и не
// ИИ (модуль их не использует нигде) — просто список точных фраз из ТЗ.
export const REVOKE_CONSENT_PHRASES = ['отозвать согласие', 'отзываю согласие']
