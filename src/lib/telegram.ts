// Минимальный клиент Telegram Bot API — обычный fetch(), без SDK (Bot API —
// простой HTTP/JSON, отдельная библиотека не нужна, как и для Google Calendar
// в этом проекте используется googleapis напрямую, а не собственная обвязка).
// Токен только из env, нигде не логируется и не возвращается наружу.

const TELEGRAM_API_BASE = 'https://api.telegram.org'

function getBotToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN не задан в переменных окружения')
  return token
}

// Минимальная форма Telegram Update — только поля, которые реально использует
// webhook (src/app/api/telegram/webhook/route.ts). Полный объект всё равно
// сохраняется целиком в TelegramMessage.rawPayload.
export interface TelegramUpdate {
  update_id: number
  message?: TelegramMessagePayload
  callback_query?: TelegramCallbackQuery
}

export interface TelegramChat {
  id: number
  type: 'private' | 'group' | 'supergroup' | 'channel'
  title?: string
  username?: string
  first_name?: string
  last_name?: string
}

export interface TelegramUser {
  id: number
  is_bot: boolean
  username?: string
  first_name?: string
  last_name?: string
}

export interface TelegramMessagePayload {
  message_id: number
  date: number
  chat: TelegramChat
  from?: TelegramUser
  text?: string
}

// callback_query приходит при нажатии inline-кнопки (Согласен / Позвать
// менеджера) — своя структура, у неё нет chat напрямую, только через message.
export interface TelegramCallbackQuery {
  id: string
  from: TelegramUser
  message?: TelegramMessagePayload
  data?: string
}

export async function sendTelegramMessage(
  chatId: string, text: string
): Promise<{ ok: true; telegramMessageId: string } | { ok: false; error: string }> {
  return sendTelegramMessageRaw({ chat_id: chatId, text })
}

export interface InlineButton {
  text: string
  // Ровно одно из двух: callback_data (обрабатывается в webhook) или url
  // (обычная ссылка, Telegram открывает её сам, без обращения к нам).
  callback_data?: string
  url?: string
}

export async function sendTelegramMessageWithButtons(
  chatId: string, text: string, buttons: InlineButton[][]
): Promise<{ ok: true; telegramMessageId: string } | { ok: false; error: string }> {
  return sendTelegramMessageRaw({
    chat_id: chatId,
    text,
    reply_markup: { inline_keyboard: buttons },
  })
}

async function sendTelegramMessageRaw(
  body: Record<string, unknown>
): Promise<{ ok: true; telegramMessageId: string } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${TELEGRAM_API_BASE}/bot${getBotToken()}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    if (!res.ok || !data.ok) {
      // description от Telegram безопасен для лога — не содержит токен.
      return { ok: false, error: data.description || `Telegram API вернул ${res.status}` }
    }
    return { ok: true, telegramMessageId: String(data.result.message_id) }
  } catch (e) {
    console.error('[sendTelegramMessage]', e)
    return { ok: false, error: 'Не удалось отправить сообщение в Telegram' }
  }
}

// Обязательно вызывать после обработки callback_query — иначе кнопка в
// Telegram-клиенте у клиента продолжает "крутиться" (visual loading state).
export async function answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
  try {
    await fetch(`${TELEGRAM_API_BASE}/bot${getBotToken()}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
    })
  } catch (e) {
    console.error('[answerCallbackQuery]', e)
  }
}

// Разовая настройка вебхука — вызывается вручную одной командой при первичной
// настройке бота (см. инструкцию), не используется в рантайме приложения.
export async function setTelegramWebhook(
  webhookUrl: string, secretToken: string
): Promise<{ ok: boolean; description?: string }> {
  const res = await fetch(`${TELEGRAM_API_BASE}/bot${getBotToken()}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: webhookUrl, secret_token: secretToken }),
  })
  const data = await res.json()
  return { ok: !!data.ok, description: data.description }
}

export interface TelegramWebhookInfo {
  url: string
  pending_update_count: number
  last_error_date?: number
  last_error_message?: string
}

// Для страницы настроек — показать реальный статус вебхука "вживую", не из
// БД (в БД он не хранится, чтобы не рассинхронизироваться с Telegram).
export async function getTelegramWebhookInfo(): Promise<TelegramWebhookInfo | null> {
  try {
    const res = await fetch(`${TELEGRAM_API_BASE}/bot${getBotToken()}/getWebhookInfo`)
    const data = await res.json()
    return data.ok ? (data.result as TelegramWebhookInfo) : null
  } catch (e) {
    console.error('[getTelegramWebhookInfo]', e)
    return null
  }
}

export interface TelegramBotInfo {
  username: string
  first_name: string
}

export async function getTelegramBotInfo(): Promise<TelegramBotInfo | null> {
  try {
    const res = await fetch(`${TELEGRAM_API_BASE}/bot${getBotToken()}/getMe`)
    const data = await res.json()
    return data.ok ? (data.result as TelegramBotInfo) : null
  } catch (e) {
    console.error('[getTelegramBotInfo]', e)
    return null
  }
}

// Токен настроен — но НЕ показываем его целиком нигде, даже в этом файле.
// Используется страницей настроек, чтобы отличить "не настроено" от "настроено".
export function isTelegramBotTokenConfigured(): boolean {
  return !!process.env.TELEGRAM_BOT_TOKEN
}
