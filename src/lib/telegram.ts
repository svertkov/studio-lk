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

export interface TelegramPhotoSize {
  file_id: string
  file_unique_id: string
  width: number
  height: number
  file_size?: number
}

export interface TelegramDocument {
  file_id: string
  file_unique_id: string
  file_name?: string
  mime_type?: string
  file_size?: number
}

export interface TelegramVoice {
  file_id: string
  file_unique_id: string
  duration: number
  mime_type?: string
  file_size?: number
}

export interface TelegramVideo {
  file_id: string
  file_unique_id: string
  width: number
  height: number
  duration: number
  mime_type?: string
  file_size?: number
}

export interface TelegramSticker {
  file_id: string
  file_unique_id: string
  width: number
  height: number
  is_animated: boolean
  is_video: boolean
  file_size?: number
}

export interface TelegramMessagePayload {
  message_id: number
  date: number
  chat: TelegramChat
  from?: TelegramUser
  text?: string
  // Подпись к фото/документу/видео — Telegram присылает её в отдельном
  // поле, а не в text, даже когда сообщение состоит только из вложения.
  caption?: string
  photo?: TelegramPhotoSize[] // несколько размеров одного фото — берём наибольший
  document?: TelegramDocument
  voice?: TelegramVoice
  video?: TelegramVideo
  sticker?: TelegramSticker
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

// ============================================================
// ФАЙЛЫ ВЛОЖЕНИЙ — файлы не хранятся у нас (нет S3/Object Storage в проекте),
// при каждом просмотре запрашиваем у Telegram свежий file_path и проксируем
// байты через src/app/api/telegram/file/[attachmentId]/route.ts. file_path
// может со временем истекать/меняться — поэтому getTelegramFileInfo
// вызывается заново на каждый запрос, а не кешируется.
// ============================================================

export interface TelegramFileInfo {
  file_id: string
  file_unique_id: string
  file_size?: number
  file_path?: string
}

export async function getTelegramFileInfo(fileId: string): Promise<TelegramFileInfo | null> {
  try {
    const res = await fetch(`${TELEGRAM_API_BASE}/bot${getBotToken()}/getFile?file_id=${encodeURIComponent(fileId)}`)
    const data = await res.json()
    return data.ok ? (data.result as TelegramFileInfo) : null
  } catch (e) {
    console.error('[getTelegramFileInfo]', e)
    return null
  }
}

// Содержит токен в URL — используется только на сервере (внутри API-роута),
// никогда не передаётся в браузер напрямую.
export function getTelegramFileDownloadUrl(filePath: string): string {
  return `${TELEGRAM_API_BASE}/file/bot${getBotToken()}/${filePath}`
}

// ============================================================
// ОТПРАВКА ВЛОЖЕНИЙ АДМИНИСТРАТОРОМ — multipart/form-data напрямую через
// fetch (FormData + Blob), без новой зависимости. Каждый метод возвращает
// file_id отправленного файла — сохраняем его же в TelegramMessageAttachment,
// чтобы отправленный админом файл открывался через тот же прокси-роут, что
// и присланный клиентом.
// ============================================================

export type SendAttachmentResult =
  | { ok: true; telegramMessageId: string; fileId: string; fileSize?: number; width?: number; height?: number; duration?: number }
  | { ok: false; error: string }

async function sendTelegramFile(
  method: 'sendPhoto' | 'sendDocument' | 'sendVideo',
  field: 'photo' | 'document' | 'video',
  chatId: string, fileBuffer: Buffer, filename: string, caption?: string,
): Promise<SendAttachmentResult> {
  try {
    const form = new FormData()
    form.append('chat_id', chatId)
    if (caption) form.append('caption', caption)
    form.append(field, new Blob([new Uint8Array(fileBuffer)]), filename)

    const res = await fetch(`${TELEGRAM_API_BASE}/bot${getBotToken()}/${method}`, { method: 'POST', body: form })
    const data = await res.json()
    if (!res.ok || !data.ok) {
      return { ok: false, error: data.description || `Telegram API вернул ${res.status}` }
    }

    const result = data.result
    // Telegram пересжимает фото при sendPhoto — реальный размер загруженного
    // файла на серверах Telegram отличается от исходного file.size с браузера.
    // Берём метаданные из ответа Telegram (как и для входящих вложений), а не
    // из исходного файла — иначе прокси-роут отдаёт неверный Content-Length,
    // и браузер обрывает загрузку картинки как повреждённую.
    type RemoteFile = { file_id: string; file_size?: number; width?: number; height?: number; duration?: number }
    const remote: RemoteFile | undefined =
      field === 'photo'
        ? (result.photo as RemoteFile[]).reduce((a, b) => ((b.width ?? 0) > (a.width ?? 0) ? b : a))
        : result[field]
    if (!remote?.file_id) return { ok: false, error: 'Telegram не вернул file_id отправленного файла' }

    return {
      ok: true,
      telegramMessageId: String(result.message_id),
      fileId: remote.file_id,
      fileSize: remote.file_size,
      width: remote.width,
      height: remote.height,
      duration: remote.duration,
    }
  } catch (e) {
    console.error(`[${method}]`, e)
    return { ok: false, error: 'Не удалось отправить файл в Telegram' }
  }
}

export function sendTelegramPhoto(chatId: string, fileBuffer: Buffer, filename: string, caption?: string) {
  return sendTelegramFile('sendPhoto', 'photo', chatId, fileBuffer, filename, caption)
}

export function sendTelegramDocument(chatId: string, fileBuffer: Buffer, filename: string, caption?: string) {
  return sendTelegramFile('sendDocument', 'document', chatId, fileBuffer, filename, caption)
}

export function sendTelegramVideo(chatId: string, fileBuffer: Buffer, filename: string, caption?: string) {
  return sendTelegramFile('sendVideo', 'video', chatId, fileBuffer, filename, caption)
}
