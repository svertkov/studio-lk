// Чистые функции нормализации сырых значений ячеек Excel (ТЗ п.4/18/32) —
// НИЧЕГО не знает про Prisma/БД, только data in → normalized data out.
// Каждая функция явно возвращает null, если распознать не удалось — вместо
// того чтобы выдумывать значение (ТЗ п.41, «NULL лучше выдуманного значения»).

const WEEKEND_MARKERS = ['выходной', 'вых.', 'вых', 'weekend']

export function isWeekendMarker(raw: unknown): boolean {
  if (typeof raw !== 'string') return false
  const v = raw.trim().toLowerCase()
  return WEEKEND_MARKERS.some(m => v === m || v.startsWith(m))
}

// ExcelJS отдаёт дату либо как Date, либо (реже) как число/строку — единая
// точка входа. Возвращает ISO-дату (без времени, только календарный день —
// исторические таблицы никогда не несут точное время публикации).
export function normalizeDate(raw: unknown): string | null {
  if (raw == null) return null
  if (raw instanceof Date) {
    if (isNaN(raw.getTime())) return null
    // Excel date-only ячейки ExcelJS отдаёт в UTC-полночь — берём календарную
    // дату как есть, не смещаем по локальному часовому поясу.
    const y = raw.getUTCFullYear()
    const m = String(raw.getUTCMonth() + 1).padStart(2, '0')
    const d = String(raw.getUTCDate()).padStart(2, '0')
    if (y < 2000 || y > 2100) return null // защита от битых serial-дат (ТЗ п.4, INVALID_DATE_SERIAL)
    return `${y}-${m}-${d}`
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (isWeekendMarker(trimmed)) return null
    const m = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/)
    if (m) return `${m[1]}-${m[2]}-${m[3]}`
    const ru = trimmed.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/)
    if (ru) return `${ru[3]}-${ru[2].padStart(2, '0')}-${ru[1].padStart(2, '0')}`
    return null
  }
  return null
}

// Сумма может прийти числом, строкой-числом ("20000.0"), строкой с
// пробелом-разделителем тысяч ("3 864"), либо текстовой заметкой вместо
// числа ("25000 + 10000 (выездная)\n+ 5000 ...") — в последнем случае
// намеренно НЕ считаем сумму (ТЗ п.41) и возвращаем null + isComplexText,
// чтобы вызывающий код мог отдельно отметить это в отчёте, а не тихо
// потерять данные.
export interface AmountParseResult {
  value: number | null
  isComplexText: boolean
  raw: string
}

export function normalizeAmount(raw: unknown): AmountParseResult {
  if (raw == null) return { value: null, isComplexText: false, raw: '' }
  if (typeof raw === 'number') return { value: raw, isComplexText: false, raw: String(raw) }
  if (typeof raw !== 'string') return { value: null, isComplexText: false, raw: String(raw) }
  const trimmed = raw.trim()
  if (trimmed === '') return { value: null, isComplexText: false, raw: trimmed }
  // Чистое число, возможно с пробелами/неразрывными пробелами как разделителем тысяч.
  const cleaned = trimmed.replace(/[ \s]/g, '')
  if (/^-?\d+([.,]\d+)?$/.test(cleaned)) {
    return { value: parseFloat(cleaned.replace(',', '.')), isComplexText: false, raw: trimmed }
  }
  // Содержит цифры, но также буквы/операторы/переносы строк — не однозначное число.
  return { value: null, isComplexText: /\d/.test(trimmed), raw: trimmed }
}

const URL_RE = /https?:\/\/[^\s"'<>)\]]+/gi

export function extractUrls(raw: unknown): string[] {
  if (typeof raw !== 'string') return []
  const matches = raw.match(URL_RE) ?? []
  return matches.map(normalizeUrl).filter((u): u is string => u !== null)
}

// Нормализация URL перед сравнением (ТЗ п.18) — только безопасные,
// однозначные преобразования: обрезка пробелов, снятие висячего trailing
// slash, если после него ничего нет. Signed/token-параметры НЕ трогаем.
export function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim().replace(/[.,;]+$/, '')
  if (trimmed === '') return null
  try {
    const u = new URL(trimmed)
    if (u.pathname.endsWith('/') && u.pathname !== '/') u.pathname = u.pathname.slice(0, -1)
    return u.toString()
  } catch {
    return null // битый/неполный URL — не выдумываем, isEmptyOrBroken=true у вызывающего кода
  }
}

// "00:13:00" / "0:14:" (обрезанный форматированием) → секунды. Возвращает
// null для формата, который не удаётся однозначно разобрать (напр. "18/43" —
// это retention как дробь, не watch time — не пытаемся угадать смысл дроби).
export function parseTimeToSeconds(raw: unknown): number | null {
  if (typeof raw !== 'string') return null
  const m = raw.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/)
  if (!m) return null
  const h = m[3] ? parseInt(m[1], 10) : 0
  const min = m[3] ? parseInt(m[2], 10) : parseInt(m[1], 10)
  const sec = m[3] ? parseInt(m[3], 10) : parseInt(m[2], 10)
  return h * 3600 + min * 60 + sec
}

// Стабильный fingerprint исходной строки по нормализованным значениям (ТЗ
// п.31/32) — НЕ по номеру строки (тот может съехать при правке файла).
// Простая детерминированная хеш-функция без внешних зависимостей (crypto
// доступен, но здесь достаточно некриптографического хеша — fingerprint
// нужен только для дедупликации/идемпотентности одного и того же запуска
// импортёра, не для защиты от подделки).
export function fingerprint(parts: (string | number | null | undefined)[]): string {
  const joined = parts.map(p => (p == null ? '∅' : String(p))).join('')
  let h1 = 0xdeadbeef ^ joined.length
  let h2 = 0x41c6ce57 ^ joined.length
  for (let i = 0; i < joined.length; i++) {
    const ch = joined.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0')
}
