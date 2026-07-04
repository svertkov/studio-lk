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

// Минимальная форма Telegram Update/Message — только поля, которые реально
// использует webhook (src/app/api/telegram/webhook/route.ts). Полный объект
// всё равно сохраняется целиком в TelegramMessage.rawPayload.
export interface TelegramUpdate {
  update_id: number
  message?: TelegramMessagePayload
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

export async function sendTelegramMessage(
  chatId: string, text: string
): Promise<{ ok: true; telegramMessageId: string } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${TELEGRAM_API_BASE}/bot${getBotToken()}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
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
