// Определение колонок таблицы и группировка строк в клиентов + визиты.
// Чистая логика, без обращений к БД — принимает таблицу, отдаёт структурированные данные.

import {
  normalizePhone, normalizeTelegram, normalizeEmail, splitFullName,
  parseAmount, parseDurationHours, parseFlexibleDate, normalizeRoom, normalizeFormat,
  hashSheetRow,
} from './normalize'

export type ClientField =
  | 'firstName' | 'lastName' | 'patronymic' | 'fullName' | 'workplace'
  | 'phone' | 'telegram' | 'email'

export type VisitField =
  | 'date' | 'room' | 'format' | 'durationHours' | 'grossAmount' | 'netAmount' | 'comment'

export type ImportField = ClientField | VisitField

export const FIELD_LABELS: Record<ImportField, string> = {
  firstName: 'Имя', lastName: 'Фамилия', patronymic: 'Отчество', fullName: 'ФИО целиком',
  workplace: 'Компания', phone: 'Телефон', telegram: 'Telegram', email: 'Email',
  date: 'Дата визита', room: 'Зал', format: 'Формат записи', durationHours: 'Длительность (часы)',
  grossAmount: 'Сумма грязными', netAmount: 'Сумма чистыми', comment: 'Комментарий',
}

const FIELD_ALIASES: Record<string, ImportField> = {
  'имя': 'firstName', 'first name': 'firstName',
  'фамилия': 'lastName', 'last name': 'lastName', 'surname': 'lastName',
  'отчество': 'patronymic', 'patronymic': 'patronymic', 'middle name': 'patronymic',
  'фио': 'fullName', 'ф.и.о.': 'fullName', 'ф.и.о': 'fullName', 'full name': 'fullName',
  'клиент': 'fullName', 'заказчик': 'fullName', 'контакт': 'fullName', 'название клиента': 'fullName', 'name': 'fullName',
  'компания': 'workplace', 'место работы': 'workplace', 'работодатель': 'workplace', 'company': 'workplace', 'workplace': 'workplace',

  'телефон': 'phone', 'номер': 'phone', 'номер телефона': 'phone', 'phone': 'phone', 'tel': 'phone',
  'whatsapp': 'phone', 'контактный номер': 'phone',
  'telegram': 'telegram', 'телеграм': 'telegram', 'телеграмм': 'telegram', 'tg': 'telegram', 'username': 'telegram', 'ник': 'telegram',
  'email': 'email', 'e-mail': 'email', 'почта': 'email', 'mail': 'email',

  'дата визита': 'date', 'дата съёмки': 'date', 'дата съемки': 'date', 'дата записи': 'date', 'дата': 'date',
  'зал': 'room', 'студия': 'room', 'локация': 'room', 'помещение': 'room', 'room': 'room',
  'формат': 'format', 'формат записи': 'format', 'тип съёмки': 'format', 'тип съемки': 'format',
  'вид записи': 'format', 'услуга': 'format', 'проект': 'format', 'recording type': 'format',
  'часы': 'durationHours', 'кол-во часов': 'durationHours', 'количество часов': 'durationHours',
  'длительность': 'durationHours', 'время': 'durationHours', 'продолжительность': 'durationHours', 'duration': 'durationHours',
  'сумма': 'grossAmount', 'оплата': 'grossAmount', 'стоимость': 'grossAmount', 'доход': 'grossAmount',
  'выручка': 'grossAmount', 'грязными': 'grossAmount', 'gross': 'grossAmount',
  'чистыми': 'netAmount', 'прибыль': 'netAmount', 'net': 'netAmount', 'после расходов': 'netAmount', 'после налогов': 'netAmount',
  'комментарий': 'comment', 'примечание': 'comment',
}

const PHONE_RE = /(\+?\d[\d\s\-()]{7,}\d)/
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/
const TELEGRAM_RE = /(^@[a-zA-Z0-9_]{3,}$)|t\.me\//i

// Более мягкая проверка "похоже на ник Telegram" — для построчного определения
// типа контакта в смешанных колонках (телефон ИЛИ ник в одной колонке)
function looksLikeTelegramHandle(v: string): boolean {
  const trimmed = v.trim()
  if (TELEGRAM_RE.test(trimmed)) return true
  return /^[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(trimmed.replace(/^@/, ''))
}

function normalizeHeader(h: string): string {
  return h.toLowerCase().trim().replace(/\s+/g, ' ')
}

function detectByContent(samples: string[]): ImportField | null {
  const nonEmpty = samples.map(s => s.trim()).filter(Boolean)
  if (nonEmpty.length === 0) return null
  const ratio = (test: (s: string) => boolean) => nonEmpty.filter(test).length / nonEmpty.length

  if (ratio(s => EMAIL_RE.test(s)) > 0.6) return 'email'
  if (ratio(s => TELEGRAM_RE.test(s)) > 0.6) return 'telegram'
  if (ratio(s => PHONE_RE.test(s)) > 0.6) return 'phone'
  // Смешанная колонка: где-то телефон, где-то ник Telegram — по отдельности порог не проходят,
  // но вместе явно "контактная" колонка. Отмечаем как "phone" — applyMapping разложит по строкам сам.
  if (ratio(s => PHONE_RE.test(s) || looksLikeTelegramHandle(s)) > 0.6) return 'phone'
  if (ratio(s => /[₽$€]|руб/i.test(s)) > 0.5) return 'grossAmount'
  if (ratio(s => parseFlexibleDate(s) !== undefined && /\d{2,4}/.test(s)) > 0.6) return 'date'
  if (ratio(s => /^\d{1,2}:\d{2}$/.test(s) || /^\d+([.,]\d+)?\s*(ч|час|h)$/i.test(s)) > 0.6) return 'durationHours'
  return null
}

export interface DetectedColumn {
  index: number
  header: string
  field: ImportField | null
  confidence: 'high' | 'low' | 'ignored' | 'ai'
}

export function detectColumns(table: string[][]): DetectedColumn[] {
  if (table.length === 0) return []
  const headerRow = table[0]
  const dataRows = table.slice(1)

  return headerRow.map((rawHeader, index) => {
    const header = rawHeader.trim()
    const aliasField = FIELD_ALIASES[normalizeHeader(header)]
    if (aliasField) return { index, header, field: aliasField, confidence: 'high' as const }

    const samples = dataRows.slice(0, 15).map(r => r[index] ?? '')
    const contentField = detectByContent(samples)
    if (contentField) return { index, header, field: contentField, confidence: 'low' as const }

    return { index, header, field: null, confidence: 'ignored' as const }
  })
}

// Короткое privacy-safe описание содержимого колонки для ИИ — без утечки данных клиентов.
// Примеры значений показываются, ТОЛЬКО если они не похожи на имя/телефон/email —
// то есть это категории, статусы, форматы съёмки и т.п., а не личные данные конкретного клиента.
const NAME_LIKE_RE = /^[А-ЯЁA-Z][а-яёa-z]+\s+[А-ЯЁA-Z][а-яёa-z]+(\s+[А-ЯЁA-Z][а-яёa-z]+)?$/

export function describeColumnShape(table: string[][], colIndex: number): string {
  const values = table.slice(1, 30).map(r => (r[colIndex] ?? '').trim()).filter(Boolean)
  if (values.length === 0) return 'колонка пустая'

  const distinct = Array.from(new Set(values))
  const looksLikePersonalData = values.filter(v => NAME_LIKE_RE.test(v) || PHONE_RE.test(v) || EMAIL_RE.test(v))
    .length / values.length > 0.4

  if (looksLikePersonalData) {
    return 'похоже на личные данные (имя/телефон/email) — примеры не показываю'
  }
  if (distinct.length <= 20) {
    return `примеры значений: ${distinct.slice(0, 8).map(v => `"${v}"`).join(', ')}`
  }
  if (values.every(v => /^[\d\s.,₽рp%-]+$/i.test(v))) {
    return `преимущественно числа/суммы, например: ${distinct.slice(0, 3).map(v => `"${v}"`).join(', ')}`
  }
  if (values.filter(v => /\d{1,2}[.\/]\d{1,2}[.\/]\d{2,4}/.test(v)).length / values.length > 0.6) return 'преимущественно похоже на даты'
  return `много уникальных текстовых значений, примеры: ${distinct.slice(0, 5).map(v => `"${v}"`).join(', ')}`
  return 'разные текстовые значения, много уникальных (может быть личными данными — не показываю)'
}

export interface VisitRecord {
  date?: Date
  room?: string
  format?: string
  durationHours?: number
  grossAmount?: number
  netAmount?: number
  comment?: string
  // Отпечаток исходной строки таблицы — для безопасной досинхронизации
  // (отличить уже загруженную строку от новой), см. hashSheetRow()
  sourceRowHash?: string
}

export interface ParsedImportRow {
  firstName: string
  lastName?: string
  patronymic?: string
  workplace?: string
  phone?: string
  phoneValid?: boolean
  telegram?: string
  email?: string
  visit: VisitRecord | null
}

export function applyMapping(table: string[][], columns: DetectedColumn[]): { rows: ParsedImportRow[]; skippedNoName: number } {
  const dataRows = table.slice(1)
  // Несколько колонок могут случайно определиться в одно и то же поле
  // (например «Номер» и «WhatsApp» оба похожи на телефон) — берём первое непустое значение среди них
  const colsFor = (field: ImportField) => columns.filter(c => c.field === field).map(c => c.index)

  const idx = {
    firstName: colsFor('firstName'), lastName: colsFor('lastName'), patronymic: colsFor('patronymic'),
    fullName: colsFor('fullName'), workplace: colsFor('workplace'),
    phone: colsFor('phone'), telegram: colsFor('telegram'), email: colsFor('email'),
    date: colsFor('date'), room: colsFor('room'), format: colsFor('format'),
    durationHours: colsFor('durationHours'), grossAmount: colsFor('grossAmount'), netAmount: colsFor('netAmount'),
    comment: colsFor('comment'),
  }

  const rows: ParsedImportRow[] = []
  let skippedNoName = 0

  for (const r of dataRows) {
    if (r.every(c => !c?.trim())) continue
    const get = (indices: number[]) => {
      for (const i of indices) {
        const v = (r[i] ?? '').trim()
        if (v) return v
      }
      return ''
    }
    // Комментарий — не единственное значение, а все непустые колонки сразу
    // (иначе, например, "Затраты" со значением "0" перекрывала бы настоящее примечание)
    const getAllJoined = (indices: number[]) =>
      indices.map(i => (r[i] ?? '').trim()).filter(Boolean).join('; ')

    let firstName = get(idx.firstName)
    let lastName = get(idx.lastName)
    let patronymic = get(idx.patronymic)

    if (!firstName && !lastName && idx.fullName.length > 0) {
      const split = splitFullName(get(idx.fullName))
      firstName = split.firstName
      lastName = split.lastName ?? ''
      patronymic = split.patronymic ?? ''
    }

    if (!firstName && lastName) {
      firstName = lastName
      lastName = ''
    }

    if (!firstName) { skippedNoName++; continue }

    // В одной "контактной" колонке иногда вперемешку то телефон, то ник Telegram —
    // смотрим на конкретное значение в строке, а не только на то, куда указывает колонка
    let phoneRaw = get(idx.phone)
    let telegramRaw = get(idx.telegram)

    if (phoneRaw && !normalizePhone(phoneRaw).valid && looksLikeTelegramHandle(phoneRaw) && !telegramRaw) {
      telegramRaw = phoneRaw
      phoneRaw = ''
    }
    if (telegramRaw && !looksLikeTelegramHandle(telegramRaw) && PHONE_RE.test(telegramRaw) && !phoneRaw) {
      phoneRaw = telegramRaw
      telegramRaw = ''
    }

    const phoneNorm = phoneRaw ? normalizePhone(phoneRaw) : undefined

    const dateRaw = get(idx.date)
    const durationRaw = get(idx.durationHours)
    const grossRaw = get(idx.grossAmount)
    const netRaw = get(idx.netAmount)
    const roomRaw = get(idx.room)
    const formatRaw = get(idx.format)
    const commentRaw = getAllJoined(idx.comment)

    const visit: VisitRecord = {
      date: dateRaw ? parseFlexibleDate(dateRaw) : undefined,
      room: roomRaw ? normalizeRoom(roomRaw) : undefined,
      format: formatRaw ? normalizeFormat(formatRaw) : undefined,
      durationHours: durationRaw ? parseDurationHours(durationRaw) : undefined,
      grossAmount: grossRaw ? parseAmount(grossRaw) : undefined,
      netAmount: netRaw ? parseAmount(netRaw) : undefined,
      comment: commentRaw || undefined,
    }
    const hasVisitData = Object.values(visit).some(v => v !== undefined)
    if (hasVisitData) visit.sourceRowHash = hashSheetRow(r)

    rows.push({
      firstName,
      lastName: lastName || undefined,
      patronymic: patronymic || undefined,
      workplace: get(idx.workplace) || undefined,
      phone: phoneNorm?.value || undefined,
      phoneValid: phoneNorm?.valid,
      telegram: telegramRaw ? normalizeTelegram(telegramRaw) : undefined,
      email: get(idx.email) ? normalizeEmail(get(idx.email)) : undefined,
      visit: hasVisitData ? visit : null,
    })
  }

  return { rows, skippedNoName }
}

export type MatchKind = 'phone' | 'email' | 'telegram' | 'name_workplace' | 'name'

export interface GroupedClientDraft {
  key: string
  matchKind: MatchKind
  firstName: string
  lastName?: string
  patronymic?: string
  workplace?: string
  phone?: string
  telegram?: string
  email?: string
  visits: VisitRecord[]
  rowWarnings: string[]
}

function dedupKey(row: ParsedImportRow): { key: string; kind: MatchKind } | null {
  if (row.phone && row.phoneValid) return { key: `phone:${row.phone}`, kind: 'phone' }
  if (row.email) return { key: `email:${row.email}`, kind: 'email' }
  if (row.telegram) return { key: `tg:${row.telegram.toLowerCase()}`, kind: 'telegram' }

  const fullName = [row.lastName, row.firstName, row.patronymic].filter(Boolean).join(' ').toLowerCase()
  if (!fullName) return null
  if (row.workplace) return { key: `name+wp:${fullName}+${row.workplace.toLowerCase()}`, kind: 'name_workplace' }
  return { key: `name:${fullName}`, kind: 'name' }
}

export function groupIntoClients(rows: ParsedImportRow[]): GroupedClientDraft[] {
  const groups = new Map<string, GroupedClientDraft>()

  for (const row of rows) {
    const dk = dedupKey(row)
    if (!dk) continue

    let group = groups.get(dk.key)
    if (!group) {
      group = {
        key: dk.key, matchKind: dk.kind,
        firstName: row.firstName, lastName: row.lastName, patronymic: row.patronymic,
        workplace: row.workplace, phone: row.phone, telegram: row.telegram, email: row.email,
        visits: [], rowWarnings: [],
      }
      groups.set(dk.key, group)
    } else {
      group.workplace ??= row.workplace
      group.phone ??= row.phone
      group.telegram ??= row.telegram
      group.email ??= row.email
    }

    if (row.visit) group.visits.push(row.visit)
    if (row.phone && row.phoneValid === false) {
      group.rowWarnings.push(`Не удалось точно распознать телефон: "${row.phone}"`)
    }
  }

  return Array.from(groups.values())
}
