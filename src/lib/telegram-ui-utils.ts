// Общие форматтеры для UI Telegram-модуля — используются и в ленте сообщений
// (TelegramMessageThread), и в панели вложений (TelegramAttachmentsPanel),
// чтобы не дублировать одинаковые функции в обоих местах.

export function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`
}

export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds) return ''
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

// Простое извлечение URL из текста сообщения — ссылки не хранятся как
// отдельная сущность в БД (см. память проекта), вычисляются на лету при
// отображении. Достаточно для "Ссылок" во вкладке вложений — не претендует
// на полный RFC-парсинг URL.
const URL_REGEX = /https?:\/\/[^\s<>"']+/gi

export function extractLinks(text: string | null | undefined): string[] {
  if (!text) return []
  const matches = text.match(URL_REGEX)
  if (!matches) return []
  // Убираем случайные хвостовые знаки препинания, прилипшие к ссылке из текста.
  return matches.map(u => u.replace(/[.,!?;:)\]]+$/, ''))
}

export function getUrlDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
