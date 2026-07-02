// Нормализация "грязных" значений из реальных таблиц студии в единый вид

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

export function parseDurationHours(raw: string): number | undefined {
  const v = raw.trim().toLowerCase()
  if (!v) return undefined

  const hhmm = v.match(/^(\d{1,2}):(\d{2})$/)
  if (hhmm) return parseInt(hhmm[1], 10) + parseInt(hhmm[2], 10) / 60

  const numMatch = v.match(/(\d+(?:[.,]\d+)?)/)
  if (!numMatch) return undefined
  const num = parseFloat(numMatch[1].replace(',', '.'))
  if (!Number.isFinite(num)) return undefined

  if (/мин/.test(v)) return num / 60
  return num
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
  { canonical: 'Интервью', aliases: ['интервью', 'interview'] },
  { canonical: 'Reels', aliases: ['reels', 'рилс', 'рилз'] },
  { canonical: 'Shorts', aliases: ['shorts', 'шортс'] },
  { canonical: 'Курс', aliases: ['курс', 'course'] },
  { canonical: 'Онлайн-трансляция', aliases: ['трансляц', 'stream', 'эфир'] },
  { canonical: 'Вебинар', aliases: ['вебинар', 'webinar'] },
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
