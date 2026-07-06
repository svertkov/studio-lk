// Нормализация "грязных" значений из реальных таблиц студии в единый вид

import { createHash } from 'crypto'

// Стабильный отпечаток исходной строки таблицы (до любой нормализации/маппинга
// колонок) — ключ для безопасной досинхронизации: одна и та же строка таблицы
// всегда даёт один и тот же хэш, поэтому повторный запуск синхронизации не
// создаёт визит повторно, даже если раскладка колонок или их порядок не менялись.
export function hashSheetRow(row: string[]): string {
  return createHash('sha256').update(row.join('')).digest('hex')
}

export interface NormalizedPhone {
  value: string
  valid: boolean
}

export function normalizePhone(raw: string): NormalizedPhone {
  const trimmed = raw.trim()
  if (!trimmed) return { value: '', valid: false }

  const hasPlus = trimmed.startsWith('+')
  const digits = trimmed.replace(/\D/g, '')
  if (!digits) return { value: trimmed, valid: false }

  if (digits.length === 11 && (digits.startsWith('7') || digits.startsWith('8'))) {
    return { value: `+7${digits.slice(1)}`, valid: true }
  }
  if (digits.length === 10 && !hasPlus) {
    return { value: `+7${digits}`, valid: true }
  }
  if (hasPlus) {
    return { value: `+${digits}`, valid: digits.length >= 8 }
  }
  return { value: trimmed, valid: false }
}

export function normalizeTelegram(raw: string): string {
  let v = raw.trim()
  if (!v) return ''
  const tMeMatch = v.match(/t\.me\/([a-zA-Z0-9_]+)/i)
  if (tMeMatch) v = tMeMatch[1]
  v = v.replace(/^@/, '').trim()
  return v ? `@${v}` : ''
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase()
}

export function splitFullName(full: string): { firstName: string; lastName?: string; patronymic?: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean)
  if (parts.length >= 3) return { lastName: parts[0], firstName: parts[1], patronymic: parts.slice(2).join(' ') }
  if (parts.length === 2) return { lastName: parts[0], firstName: parts[1] }
  return { firstName: parts[0] ?? '' }
}

export function parseAmount(raw: string): number | undefined {
  let v = raw.trim()
  if (!v) return undefined
  // \b не распознаёт кириллицу как "словесные" символы в JS-регулярках,
  // поэтому валютные обозначения вырезаем по позиции (начало/конец строки), а не по границе слова
  v = v.replace(/^[₽$€]\s*/i, '').replace(/\s*[₽$€]$/i, '')
  v = v.replace(/^р\.?\s*/i, '').replace(/\s*руб(?:лей|ля)?\.?$/i, '').replace(/\s*р\.?$/i, '')
  v = v.replace(/\s+/g, '')
  if (v.includes(',') && !v.includes('.')) v = v.replace(',', '.')
  else v = v.replace(/,/g, '')
  if (!v) return undefined
  const num = parseFloat(v)
  return Number.isFinite(num) ? num : undefined
}

const TIME_RANGE_RE = /(\d{1,2})(?::(\d{2}))?\s*[-–]\s*(\d{1,2})(?::(\d{2}))?/g

// Число, явно подписанное как часы («2 часа», «5 часов»), отдельно от общей
// parseDurationHours — нужно, чтобы отличить настоящий конфликт исходных данных
// (стоит «3 часа», а диапазон в скобках даёт 2 часа — путаница у того, кто вёл
// таблицу) от однозначной ошибки (ведущее число — это камеры/микрофоны, не часы).
export function extractStatedHours(raw: string): number | undefined {
  const v = raw.trim().toLowerCase()
  const m = v.match(/(\d+(?:[.,]\d+)?)\s*(час|часа|часов)/)
  return m ? parseFloat(m[1].replace(',', '.')) : undefined
}

// Реальные строки студийной таблицы бывают вида «2 часа (14-16)», «1 камера
// (13-16)» (число перед скобкой — это камеры/микрофоны, НЕ часы!), «15-20»
// (голый диапазон без слова "час"), «2 часа (12-14) + 2 часа (16-18)»
// (несколько отрезков одной записи), «смена» (без числа вообще). Раньше
// парсер брал первое попавшееся число в строке — для «1 камера (13-16)» это
// значило бы "1 час" вместо реальных 3 часов по диапазону. Теперь: если в
// строке есть диапазон времени — длительность считается по НЕМУ (сумма всех
// найденных диапазонов, на случай нескольких отрезков), и только если диапазона
// нет вообще — берётся ведущее число, но лишь когда оно стоит рядом со словом
// "час"/"часа"/"часов"/"мин" (не рядом с "камера"/"микрофон" и т.п.).
export function parseDurationHours(raw: string): number | undefined {
  const v = raw.trim().toLowerCase()
  if (!v) return undefined

  const hhmm = v.match(/^(\d{1,2}):(\d{2})$/)
  if (hhmm) return parseInt(hhmm[1], 10) + parseInt(hhmm[2], 10) / 60

  const ranges = Array.from(v.matchAll(TIME_RANGE_RE))
  if (ranges.length > 0) {
    let totalMinutes = 0
    for (const r of ranges) {
      const startMin = parseInt(r[1], 10) * 60 + (r[2] ? parseInt(r[2], 10) : 0)
      const endMin = parseInt(r[3], 10) * 60 + (r[4] ? parseInt(r[4], 10) : 0)
      const diff = endMin - startMin
      if (diff > 0 && diff <= 16 * 60) totalMinutes += diff
    }
    if (totalMinutes > 0) return Math.round((totalMinutes / 60) * 100) / 100
  }

  if (/смена/.test(v)) return undefined

  const numWithUnit = v.match(/(\d+(?:[.,]\d+)?)\s*(час|часа|часов|мин)/)
  if (numWithUnit) {
    const num = parseFloat(numWithUnit[1].replace(',', '.'))
    if (Number.isFinite(num)) return numWithUnit[2] === 'мин' ? num / 60 : num
  }

  return undefined
}

export function parseFlexibleDate(raw: string): Date | undefined {
  const v = raw.trim()
  if (!v) return undefined

  const ruMatch = v.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{2,4})/)
  if (ruMatch) {
    const day = parseInt(ruMatch[1], 10)
    const month = parseInt(ruMatch[2], 10)
    let year = parseInt(ruMatch[3], 10)
    if (year < 100) year += 2000
    const d = new Date(Date.UTC(year, month - 1, day))
    if (!Number.isNaN(d.getTime())) return d
  }

  const parsed = new Date(v)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed
}

interface AliasEntry {
  canonical: string
  aliases: string[]
}

// Расширяемый словарь залов студии — добавляйте новые варианты названий сюда
export const ROOM_DICTIONARY: AliasEntry[] = [
  { canonical: 'Тёмный зал', aliases: ['тёмный', 'темный', 'dark', 'чёрный', 'черный', 'зал 1', 'зал1'] },
  { canonical: 'Светлый зал', aliases: ['светлый', 'white', 'белый', 'зал 2', 'зал2'] },
]

export function normalizeRoom(raw: string): string {
  const v = raw.trim().toLowerCase()
  if (!v) return raw.trim()
  for (const entry of ROOM_DICTIONARY) {
    if (entry.aliases.some(a => v.includes(a))) return entry.canonical
  }
  return raw.trim()
}

// Расширяемый словарь форматов съёмки — добавляйте новые варианты сюда
export const FORMAT_DICTIONARY: AliasEntry[] = [
  { canonical: 'Подкаст', aliases: ['подкаст', 'podcast'] },
  { canonical: 'Выездная съёмка', aliases: ['выездн'] },
  { canonical: 'Говорящая голова', aliases: ['говорящ', 'гг', 'голова'] },
  { canonical: 'Интервью', aliases: ['интервью', 'interview'] },
  { canonical: 'Короткие ролики', aliases: ['reels', 'рилс', 'рилз', 'shorts', 'шортс'] },
  { canonical: 'Курс', aliases: ['курс', 'course', 'урок'] },
  { canonical: 'Онлайн-трансляция', aliases: ['трансляц', 'транляц', 'stream', 'эфир', 'вебинар', 'webinar'] },
  { canonical: 'Корпоративное видео', aliases: ['корпоратив', 'corporate'] },
]

export function normalizeFormat(raw: string): string {
  const v = raw.trim().toLowerCase()
  if (!v) return raw.trim()
  for (const entry of FORMAT_DICTIONARY) {
    if (entry.aliases.some(a => v.includes(a))) return entry.canonical
  }
  return raw.trim()
}
