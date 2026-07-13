// Импорт исторических проектов монтажа из Google-таблицы "Монтаж" в
// MontageProject — общее ядро для dry-run.ts и apply.ts (оба обязаны считать
// один и тот же план по одной и той же логике, см. тот же принцип в
// scripts/promote-visits-to-orders/core.ts).
//
// Таблица сама по себе не содержит ссылок на Order/CRM — все импортированные
// проекты создаются САМОСТОЯТЕЛЬНЫМИ (orderId: null, clientId: реальный
// Client), это не заказы студии, а отдельные исторические записи монтажа.
//
// Правило "неоплачено" — ДАННЫЕ-ЗАВИСИМОЕ, не хардкод трёх имён: любая
// строка со статусом "В работе" на момент импорта считается неоплаченной
// клиентом и невыплаченной монтажёру, остальные ("Сдан") — закрытыми по
// оплате. На момент написания скрипта в таблице 4 такие строки, а не 3 (как
// было в постановке задачи) — см. отчёт dry-run, различие не скрывается.

import { createHash } from 'crypto'
import { prisma } from '@/lib/prisma'
import { fetchGoogleSheetTable } from '@/lib/import/fetch-sheet'
import { computeMontageProfit } from '@/lib/montage-model'
import type { MontageStatus, MontageClientPaymentStatus, MontageEditorPaymentStatus } from '@prisma/client'

export const SHEET_URL = 'https://docs.google.com/spreadsheets/d/1W9AIYljLusgYcDSbeG5oK8HmTWuESVooBuBdiFmmGe8/edit?gid=1021492670#gid=1021492670'
export const IMPORT_SOURCE = 'google_sheets_montage'

// ============================================================
// РАЗБОР ЗАГОЛОВКОВ — по тексту, не по букве колонки (ТЗ п.25: "не
// ориентироваться только на буквы колонок — анализировать заголовки").
// ============================================================

type RawFieldKey =
  | 'dateStr' | 'clientRaw' | 'statusRaw' | 'title' | 'sourceUrl' | 'deadlineStr'
  | 'clientAmountStr' | 'editorAmountStr' | 'profitStr' | 'terms' | 'revisions' | 'executorRaw'

const HEADER_FIELD_MAP: Record<string, RawFieldKey> = {
  'дата поступления заказа': 'dateStr',
  'заказчик': 'clientRaw',
  'статус': 'statusRaw',
  'столбец 4': 'title',
  'ссылка на исходники': 'sourceUrl',
  'срок сдачи': 'deadlineStr',
  'стоимость для заказчика': 'clientAmountStr',
  'стоимость подрядчика': 'editorAmountStr',
  'прибыль': 'profitStr',
  'условия': 'terms',
  'итераций правок': 'revisions',
  'исполнитель': 'executorRaw',
}
const REQUIRED_FIELDS: RawFieldKey[] = ['dateStr', 'clientRaw', 'statusRaw', 'title']

function buildColumnIndex(header: string[]): Partial<Record<RawFieldKey, number>> {
  const index: Partial<Record<RawFieldKey, number>> = {}
  header.forEach((cell, i) => {
    const key = HEADER_FIELD_MAP[cell.trim().toLowerCase()]
    if (key) index[key] = i
  })
  const missing = REQUIRED_FIELDS.filter(f => index[f] === undefined)
  if (missing.length > 0) throw new Error(`В таблице не найдены обязательные колонки: ${missing.join(', ')}`)
  return index
}

// ============================================================
// ПАРСИНГ ЗНАЧЕНИЙ
// ============================================================

export function parseRuDate(raw: string): Date | null {
  const m = raw.trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/)
  if (!m) return null
  const [, d, mo, y] = m
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)))
  return Number.isNaN(date.getTime()) ? null : date
}

export function parseRuMoney(raw: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  // "р." (валютный префикс) и пробелы (разделители тысяч) отбрасываются
  // полностью — точка в исходном формате НИКОГДА не десятичный разделитель
  // (им всегда служит запятая), поэтому она удаляется вместе с "р", а не
  // сохраняется в допустимом наборе символов.
  const cleaned = trimmed.replace(/[^\d,\-]/g, '').replace(',', '.')
  if (!cleaned || cleaned === '-') return null
  const num = parseFloat(cleaned)
  return Number.isFinite(num) ? num : null
}

const STATUS_MAP: Record<string, MontageStatus> = {
  'сдан': 'DELIVERED',
  'в работе': 'IN_PROGRESS',
}

// ============================================================
// НОРМАЛИЗАЦИЯ ИСПОЛНИТЕЛЯ (ТЗ п.26) — "Иван Тесёлкин"/"Иван Теселкин"
// должны стать ОДНИМ монтажёром. Ключ дедупликации — без "ё" (частый источник
// расхождений в написании), схлопнутые пробелы, нижний регистр. Отображаемое
// имя — вариант С "ё", если он встретился хотя бы раз (более грамотное
// написание), иначе первый по появлению вариант.
// ============================================================

export function normalizeEditorKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ')
}

// Если ячейка содержит несколько исполнителей через "/", "," или "+" (ТЗ п.26:
// "Сергей Зубарев / Леха Теселкин"; реальный пример из таблицы, строка 76:
// "Иван Теселкин + моушен") — основной исполнитель первый, остальное текстом
// уходит в internalComment проекта (не создаём M2M-профили задним числом для
// структурирования второстепенного вклада). "+" обязателен в списке
// разделителей: без него "Иван Теселкин + моушен" стал бы отдельным,
// нигде больше не встречающимся "исполнителем" и не слился бы с уже
// существующим профилем "Иван Тесёлкин"/"Иван Теселкин" из других строк.
export function splitExecutors(raw: string): { primary: string; extra: string[] } {
  const parts = raw.split(/[/,+]/).map(p => p.trim()).filter(Boolean)
  return { primary: parts[0] ?? '', extra: parts.slice(1) }
}

// ============================================================
// СОПОСТАВЛЕНИЕ КЛИЕНТА — точный / однозначный частичный матч применяются
// автоматически; НЕОДНОЗНАЧНЫЕ (только пересечение слов, например "Наталия и
// Нина" ~ "Наталия Богданова и Нина") — только как подсказка в отчёте, без
// автоматической привязки (ТЗ п.4/26: "если сопоставление неоднозначно — не
// применять автоматически, вынести в отчёт").
// ============================================================

export interface ClientMatch {
  clientId: string | null
  clientName: string | null
  kind: 'exact' | 'contains' | 'suggested' | 'none'
  suggestion?: { id: string; name: string }
}

const STOPWORD_MIN_LEN = 3

export function resolveClientMatch(rawName: string, clients: { id: string; name: string }[]): ClientMatch {
  const trimmed = rawName.trim()
  if (!trimmed) return { clientId: null, clientName: null, kind: 'none' }
  const lower = trimmed.toLowerCase()

  const exact = clients.find(c => c.name.trim().toLowerCase() === lower)
  if (exact) return { clientId: exact.id, clientName: exact.name, kind: 'exact' }

  const containsMatches = clients.filter(c => {
    const cLower = c.name.trim().toLowerCase()
    return cLower.includes(lower) || lower.includes(cLower)
  })
  if (containsMatches.length === 1) {
    return { clientId: containsMatches[0].id, clientName: containsMatches[0].name, kind: 'contains' }
  }

  const words = new Set(lower.split(/\s+/).filter(w => w.length >= STOPWORD_MIN_LEN))
  let best: { id: string; name: string; score: number } | null = null
  for (const c of clients) {
    const cWords = new Set(c.name.toLowerCase().split(/\s+/).filter(w => w.length >= STOPWORD_MIN_LEN))
    const overlap = [...words].filter(w => cWords.has(w)).length
    if (overlap === 0) continue
    const score = overlap / Math.max(words.size, cWords.size, 1)
    if (!best || score > best.score) best = { id: c.id, name: c.name, score }
  }
  if (best && best.score >= 0.4) {
    return { clientId: null, clientName: null, kind: 'suggested', suggestion: { id: best.id, name: best.name } }
  }
  return { clientId: null, clientName: null, kind: 'none' }
}

// ============================================================
// FINGERPRINT — идемпотентность импорта (ТЗ п.30): дата + заказчик +
// описание + исполнитель + сумма клиента + дедлайн, НЕ одно только имя
// клиента (то же требование, что явно проговорено в ТЗ).
// ============================================================

export function buildFingerprint(fields: {
  dateStr: string; clientRaw: string; title: string; executorRaw: string
  clientAmountStr: string; deadlineStr: string
}): string {
  const key = [fields.dateStr, fields.clientRaw, fields.title, fields.executorRaw, fields.clientAmountStr, fields.deadlineStr]
    .map(s => s.trim().toLowerCase()).join('|')
  return createHash('sha256').update(key).digest('hex')
}

// ============================================================
// ПЛАН
// ============================================================

export type MontageImportAction = 'create' | 'skip_empty' | 'skip_already_imported'

export interface MontageImportRow {
  sheetRow: number
  dateStr: string
  clientRaw: string
  statusRaw: string
  title: string
  sourceUrl: string
  deadlineStr: string
  clientAmountStr: string
  editorAmountStr: string
  profitStr: string
  terms: string
  revisions: string
  executorRaw: string

  sourceReceivedAt: Date | null
  deadlineDate: Date | null
  clientAmount: number | null
  editorAmount: number | null
  sheetStatedProfit: number | null
  computedProfit: number | null
  profitMismatch: boolean
  status: MontageStatus | null
  clientPaymentStatus: MontageClientPaymentStatus
  editorPaymentStatus: MontageEditorPaymentStatus
  clientMatch: ClientMatch
  // true, если clientMatch не дал уверенной связи (kind !== 'exact'/'contains')
  // — проект всё равно создаётся (по явному решению владельца, 2026-07-13:
  // "внеси их просто без привязки к клиенту... я потом выберу вручную"), но
  // clientId остаётся null, а MontageProject.clientName хранит исходное имя
  // из таблицы — UI помечает такие карточки значком "!" (см.
  // getMontageAttentionReasons/'NO_CLIENT_LINK', montage-model.ts).
  needsClientReview: boolean
  executorPrimaryRaw: string
  executorExtraRaw: string[]
  executorKey: string | null
  fingerprint: string
  action: MontageImportAction
}

export interface MontageImportPlan {
  totalRows: number
  rows: MontageImportRow[]
  earliestDate: Date | null
  latestDate: Date | null
  distinctStatuses: string[]
}

export async function buildPlan(): Promise<MontageImportPlan> {
  const sheetRes = await fetchGoogleSheetTable(SHEET_URL)
  if (!sheetRes.ok) throw new Error(sheetRes.error ?? 'Не удалось загрузить Google-таблицу')

  const [header, ...dataRows] = sheetRes.table
  const columnIndex = buildColumnIndex(header)
  const get = (row: string[], key: RawFieldKey): string => {
    const i = columnIndex[key]
    return i == null ? '' : (row[i] ?? '').trim()
  }

  const clients = await prisma.client.findMany({ where: { deletedAt: null }, select: { id: true, name: true } })
  const existingFingerprints = new Set(
    (await prisma.montageProject.findMany({ where: { importSource: IMPORT_SOURCE }, select: { importExternalId: true } }))
      .map(p => p.importExternalId).filter((v): v is string => !!v),
  )

  const rows: MontageImportRow[] = []
  const distinctStatuses = new Set<string>()
  let earliestDate: Date | null = null
  let latestDate: Date | null = null

  dataRows.forEach((row, i) => {
    const sheetRow = i + 2 // +1 заголовок, +1 нумерация с 1
    if (row.every(c => !c?.trim())) return

    const dateStr = get(row, 'dateStr')
    const clientRaw = get(row, 'clientRaw')
    const statusRaw = get(row, 'statusRaw')
    const title = get(row, 'title')
    const sourceUrl = get(row, 'sourceUrl')
    const deadlineStr = get(row, 'deadlineStr')
    const clientAmountStr = get(row, 'clientAmountStr')
    const editorAmountStr = get(row, 'editorAmountStr')
    const profitStr = get(row, 'profitStr')
    const terms = get(row, 'terms')
    const revisions = get(row, 'revisions')
    const executorRaw = get(row, 'executorRaw')

    if (!clientRaw && !title && !dateStr) return

    if (statusRaw) distinctStatuses.add(statusRaw)

    const sourceReceivedAt = parseRuDate(dateStr)
    if (sourceReceivedAt) {
      if (!earliestDate || sourceReceivedAt < earliestDate) earliestDate = sourceReceivedAt
      if (!latestDate || sourceReceivedAt > latestDate) latestDate = sourceReceivedAt
    }
    const deadlineDate = parseRuDate(deadlineStr)
    const clientAmount = parseRuMoney(clientAmountStr)
    const editorAmount = parseRuMoney(editorAmountStr)
    const sheetStatedProfit = parseRuMoney(profitStr)
    const computedProfit = computeMontageProfit(clientAmount, editorAmount)
    const profitMismatch = sheetStatedProfit != null && computedProfit != null && Math.abs(sheetStatedProfit - computedProfit) >= 1

    const statusKey = statusRaw.trim().toLowerCase()
    const status = STATUS_MAP[statusKey] ?? null

    // Правило оплаты — data-driven по статусу (см. заголовок файла), НЕ
    // хардкод конкретных заказчиков.
    const clientPaymentStatus: MontageClientPaymentStatus = status === 'IN_PROGRESS' ? 'PENDING' : 'PAID'
    const editorPaymentStatus: MontageEditorPaymentStatus = status === 'IN_PROGRESS' ? 'PENDING' : 'PAID'

    const clientMatch = resolveClientMatch(clientRaw, clients)
    const { primary: executorPrimaryRaw, extra: executorExtraRaw } = splitExecutors(executorRaw)
    const executorKey = executorPrimaryRaw ? normalizeEditorKey(executorPrimaryRaw) : null

    const fingerprint = buildFingerprint({ dateStr, clientRaw, title, executorRaw, clientAmountStr, deadlineStr })
    const needsClientReview = clientMatch.kind === 'none' || clientMatch.kind === 'suggested'

    // action проставляется ПОСЛЕ disambiguateFingerprints ниже — до этого
    // момента fingerprint ещё может совпадать с другой строкой этого же
    // прогона (см. комментарий у disambiguateFingerprints).
    rows.push({
      sheetRow, dateStr, clientRaw, statusRaw, title, sourceUrl, deadlineStr,
      clientAmountStr, editorAmountStr, profitStr, terms, revisions, executorRaw,
      sourceReceivedAt, deadlineDate, clientAmount, editorAmount,
      sheetStatedProfit, computedProfit, profitMismatch, status,
      clientPaymentStatus, editorPaymentStatus, clientMatch, needsClientReview,
      executorPrimaryRaw, executorExtraRaw, executorKey, fingerprint, action: 'create',
    })
  })

  disambiguateFingerprints(rows)
  for (const r of rows) {
    r.action = existingFingerprints.has(r.fingerprint) ? 'skip_already_imported' : 'create'
  }

  return { totalRows: rows.length, rows, earliestDate, latestDate, distinctStatuses: [...distinctStatuses] }
}

// Две РЕАЛЬНО РАЗНЫЕ строки таблицы иногда дают одинаковый fingerprint —
// например, несколько похожих проектов для одного клиента в один день с
// одинаковой формулировкой названия (реальный случай, строки 51-62,
// "СТЭП": несколько однотипных роликов одной датой/суммой/исполнителем).
// ТЗ п.30 явно требует НЕ использовать только имя клиента для fingerprint,
// но не запрещает добавить детерминированный, устойчивый между запусками
// разрядник для настоящих коллизий: нумерация ПО ПОРЯДКУ появления строки в
// таблице (sheetRow уже отсортирован по возрастанию — dataRows.forEach выше)
// — при повторном запуске строки в том же порядке получат те же суффиксы,
// поэтому идемпотентность (уже импортированные — не дублируются) не ломается.
export function disambiguateFingerprints(rows: MontageImportRow[]): void {
  const seen = new Map<string, number>()
  for (const r of rows) {
    const count = (seen.get(r.fingerprint) ?? 0) + 1
    seen.set(r.fingerprint, count)
    if (count > 1) r.fingerprint = `${r.fingerprint}#${count}`
  }
}

// Уникальные исполнители среди строк, которые реально будут созданы —
// используется и dry-run (посчитать), и apply (создать профили один раз).
export function collectDistinctEditors(rows: MontageImportRow[]): { key: string; displayName: string }[] {
  const byKey = new Map<string, string>()
  for (const r of rows) {
    if (r.action !== 'create' || !r.executorKey) continue
    const existing = byKey.get(r.executorKey)
    if (!existing) byKey.set(r.executorKey, r.executorPrimaryRaw)
    else if (!existing.includes('ё') && r.executorPrimaryRaw.includes('ё')) byKey.set(r.executorKey, r.executorPrimaryRaw)
  }
  return [...byKey.entries()].map(([key, displayName]) => ({ key, displayName }))
}
