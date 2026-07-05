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

// ============================================================
// ПРИОРИТЕТ ДИАЛОГА — вычисляемый (не хранимый) визуальный статус,
// используемый ВЕЗДЕ одинаково: список /admin/telegram, шапка открытого
// диалога (ConversationView), встроенная панель в карточке клиента
// (ClientTelegramPanel), фильтры, легенда. Один источник правды —
// computeChatPriority() — гарантирует, что список и открытый диалог не
// могут показать разный статус для одного и того же чата.
//
// "needs_reply" ("Требует ответа") — единственное, за что он отвечает: есть
// ли непрочитанные входящие сообщения от клиента (unreadCount > 0). Раньше
// это ошибочно считалось по направлению ПОСЛЕДНЕГО сообщения
// (lastMessageDirection === 'INBOUND') — из-за этого бейдж не пропадал даже
// после того, как администратор открывал и читал диалог, потому что
// направление последнего сообщения не менялось от самого факта прочтения.
// unreadCount — существующее поле в БД (инкрементируется в webhook на каждое
// входящее сообщение клиента), просто markConversationRead(), которая его
// обнуляет, раньше нигде не вызывалась при открытии диалога — см.
// markConversationRead в actions/telegram.ts.
export type TelegramChatPriority = 'needs_reply' | 'new_unprocessed' | 'in_progress' | 'inactive' | 'normal'

export interface TelegramChatPriorityInput {
  conversationStatus: TelegramConversationStatus
  // Сколько входящих сообщений клиента ещё не прочитаны администратором.
  unreadCount: number
  linkedClientId: string | null
  // Заказ, созданный ИЗ ЭТОГО диалога (Order.telegramConversationId), а не
  // "есть ли у клиента хоть один заказ откуда угодно" — так конкретное
  // обращение не перестаёт считаться "новым/не оформленным" только из-за
  // не связанной с ним старой сделки того же клиента.
  orderId: string | null
  lastMessageAt: string | Date | null
}

const INACTIVE_THRESHOLD_DAYS = 7

// Порядок проверок — это и есть приоритет из ТЗ:
// 1) требует ответа  2) новый/не оформлен  3) в работе  4) неактивен  5) обычный.
export function computeChatPriority(input: TelegramChatPriorityInput): TelegramChatPriority {
  // Архив — сознательно закрытый диалог, не подсвечиваем как "требующий
  // внимания" даже если формально подходит под одно из условий ниже.
  if (input.conversationStatus === 'ARCHIVED') return 'normal'

  if (input.unreadCount > 0) return 'needs_reply'

  if (!input.linkedClientId || !input.orderId) return 'new_unprocessed'

  if (input.conversationStatus === 'IN_PROGRESS') return 'in_progress'

  if (input.lastMessageAt) {
    const days = (Date.now() - new Date(input.lastMessageAt).getTime()) / (24 * 60 * 60 * 1000)
    if (days >= INACTIVE_THRESHOLD_DAYS) return 'inactive'
  }

  return 'normal'
}

export const CHAT_PRIORITY_LABELS: Record<TelegramChatPriority, string> = {
  needs_reply: 'Требует ответа',
  new_unprocessed: 'Новый / не оформлен',
  in_progress: 'В работе',
  inactive: 'Нет активности 7+ дней',
  normal: 'Обычный',
}

// Бейдж — покрасочнее (для быстрого сканирования взглядом списка).
export const CHAT_PRIORITY_BADGE_COLORS: Record<TelegramChatPriority, string> = {
  needs_reply: 'text-red-400 bg-red-950/40 border-red-700',
  new_unprocessed: 'text-amber-400 bg-amber-950/40 border-amber-700',
  in_progress: 'text-blue-400 bg-blue-950/40 border-blue-700',
  inactive: 'text-emerald-400 bg-emerald-950/40 border-emerald-700',
  normal: 'text-zinc-500 bg-zinc-800/40 border-zinc-700',
}

// Левая полоска + мягкий фон всей строки — приглушённее бейджа, чтобы не
// спорить с ним по яркости, но всё равно заметно на общем фоне списка.
export const CHAT_PRIORITY_ROW_ACCENT: Record<TelegramChatPriority, string> = {
  needs_reply: 'border-l-4 border-l-red-500 bg-red-500/[0.06]',
  new_unprocessed: 'border-l-4 border-l-amber-500 bg-amber-500/[0.06]',
  in_progress: 'border-l-4 border-l-blue-500 bg-blue-500/[0.06]',
  inactive: 'border-l-4 border-l-emerald-500 bg-emerald-500/[0.05]',
  normal: 'border-l-4 border-l-transparent',
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
