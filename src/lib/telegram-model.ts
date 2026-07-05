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

// Единый статус согласия для UI — 4 состояния из ТЗ, при этом сам enum в БД
// остаётся 3-значным (NONE/GIVEN/REVOKED): "не запрошено" и "ожидаем" — оба
// это NONE, различаются только наличием consentRequestSentAt. Отдельное
// значение PENDING в БД не заводили — незачем: как только запрос отправлен,
// это уже полностью определяется существующими полями.
export type ConsentDisplayStatus = 'not_requested' | 'pending' | 'given' | 'revoked'

export function getConsentDisplayStatus(
  consentStatus: TelegramConsentStatus,
  consentRequestSentAt: string | Date | null,
): ConsentDisplayStatus {
  if (consentStatus === 'GIVEN') return 'given'
  if (consentStatus === 'REVOKED') return 'revoked'
  return consentRequestSentAt ? 'pending' : 'not_requested'
}

export const CONSENT_DISPLAY_LABELS: Record<ConsentDisplayStatus, string> = {
  not_requested: 'Согласие не запрошено',
  pending: 'Ожидаем согласие',
  given: 'Согласие получено',
  revoked: 'Согласие отозвано',
}

export const CONSENT_DISPLAY_COLORS: Record<ConsentDisplayStatus, string> = {
  not_requested: 'text-zinc-500 bg-zinc-800/40 border-zinc-700',
  pending: 'text-amber-400 bg-amber-950/30 border-amber-800',
  given: 'text-[#00c26b] bg-[#00c26b]/10 border-[#00c26b]/40',
  revoked: 'text-red-400 bg-red-950/30 border-red-800',
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

// Единственный источник дефолтного текста согласия/сообщения после
// согласия — раньше было продублировано в webhook/route.ts и
// actions/telegram.ts по отдельности, теперь оба импортируют отсюда.
// {{privacy_policy_url}} подставляется renderConsentText() на реальную
// ссылку из TelegramSettings.privacyPolicyUrl.
export const DEFAULT_CONSENT_TEXT =
  'Здравствуйте! Это студия контента 2470.\n\n' +
  'Пока мы подключаем администратора, подтвердите, пожалуйста, согласие на обработку персональных данных. ' +
  'Администратор ответит вам в течение нескольких минут.\n\n' +
  'Согласие на обработку персональных данных:\n{{privacy_policy_url}}\n\n' +
  'Нажимая «Согласиться», вы подтверждаете согласие на обработку персональных данных, включая условия, указанные в согласии.'

export const DEFAULT_MANAGER_HANDOFF_MESSAGE = 'Спасибо! Согласие получено. Администратор скоро подключится к диалогу.'
