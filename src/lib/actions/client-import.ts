'use server'

import ExcelJS from 'exceljs'
import { PDFParse } from 'pdf-parse'
import { Readable } from 'stream'
import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { auth } from '@/auth'
import {
  detectColumns, applyMapping, groupIntoClients, describeColumnShape,
  type DetectedColumn, type ImportField, type GroupedClientDraft, type VisitRecord,
} from '@/lib/import/detect'
import { normalizePhone, normalizeTelegram, normalizeEmail, splitFullName } from '@/lib/import/normalize'
import { classifyHeadersWithAI } from '@/lib/import/ai-classify'
import { computeStatusFromVisitCount } from '@/lib/client-model'

// ============================================================
// АВТОРИЗАЦИЯ
// ============================================================

async function requireStaffSession(): Promise<{ ok: true; userId: string | null } | { ok: false; error: string }> {
  try {
    const session = await auth()
    if (!session?.user) return { ok: false, error: 'Требуется авторизация' }
    return { ok: true, userId: session.user.id ?? null }
  } catch {
    return { ok: false, error: 'Требуется авторизация' }
  }
}

// ============================================================
// ЧТЕНИЕ ФАЙЛОВ/ССЫЛОК В "СЫРУЮ" ТАБЛИЦУ
// ============================================================

export interface RawTableResult {
  ok: boolean
  table: string[][]
  error?: string
}

function cellToString(v: ExcelJS.CellValue): string {
  if (v == null) return ''
  if (v instanceof Date) return v.toISOString()
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map(r => r.text).join('')
    if ('text' in v) return String((v as { text: unknown }).text)
    if ('result' in v) return String((v as { result: unknown }).result ?? '')
    return ''
  }
  return String(v).trim()
}

function worksheetToTable(worksheet: ExcelJS.Worksheet): string[][] {
  const table: string[][] = []
  worksheet.eachRow(row => {
    const values = (row.values as ExcelJS.CellValue[]).slice(1).map(cellToString)
    table.push(values)
  })
  return table
}

export async function parseExcelFile(formData: FormData): Promise<RawTableResult> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, table: [], error: authResult.error }

  try {
    const file = formData.get('file')
    if (!(file instanceof File)) return { ok: false, table: [], error: 'Файл не найден' }

    const buffer = Buffer.from(await file.arrayBuffer())
    const workbook = new ExcelJS.Workbook()

    if (file.name.toLowerCase().endsWith('.csv')) {
      await workbook.csv.read(Readable.from(buffer))
    } else {
      // exceljs bundles its own @types/node copy via @fast-csv, which produces a
      // structurally incompatible (but runtime-identical) Buffer type
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await workbook.xlsx.load(buffer as any)
    }

    const worksheet = workbook.worksheets[0]
    if (!worksheet) return { ok: false, table: [], error: 'В файле нет листов с данными' }

    const table = worksheetToTable(worksheet)
    if (table.length === 0) return { ok: false, table: [], error: 'Файл пуст' }
    return { ok: true, table }
  } catch (e) {
    console.error('[parseExcelFile]', e)
    return { ok: false, table: [], error: 'Не удалось прочитать файл. Проверьте, что это корректный Excel/CSV файл' }
  }
}

export async function parseGoogleSheetUrl(url: string): Promise<RawTableResult> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, table: [], error: authResult.error }

  try {
    const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)
    if (!match) return { ok: false, table: [], error: 'Не похоже на ссылку на Google Таблицу' }

    const gidMatch = url.match(/[#&?]gid=(\d+)/)
    const gid = gidMatch ? gidMatch[1] : '0'
    const csvUrl = `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv&gid=${gid}`

    const res = await fetch(csvUrl)
    if (!res.ok) {
      return {
        ok: false, table: [],
        error: 'Не удалось открыть таблицу. Убедитесь, что доступ настроен как "Все, у кого есть ссылка — Читатель"',
      }
    }
    const csvText = await res.text()
    if (csvText.trim().startsWith('<')) {
      return {
        ok: false, table: [],
        error: 'Таблица недоступна по ссылке. Откройте доступ: Настройки доступа → "Все, у кого есть ссылка"',
      }
    }

    const workbook = new ExcelJS.Workbook()
    await workbook.csv.read(Readable.from(Buffer.from(csvText, 'utf-8')))
    const worksheet = workbook.worksheets[0]
    if (!worksheet) return { ok: false, table: [], error: 'Таблица пуста' }

    const table = worksheetToTable(worksheet)
    if (table.length === 0) return { ok: false, table: [], error: 'Таблица пуста' }
    return { ok: true, table }
  } catch (e) {
    console.error('[parseGoogleSheetUrl]', e)
    return { ok: false, table: [], error: 'Не удалось загрузить таблицу по ссылке' }
  }
}

// ============================================================
// ПРЕДПРОСМОТР: КОЛОНКИ → КЛИЕНТЫ + ВИЗИТЫ
// ============================================================

export interface PreviewClient {
  key: string
  firstName: string
  lastName?: string
  patronymic?: string
  workplace?: string
  phone?: string
  telegram?: string
  email?: string
  visitsCount: number
  visits: VisitRecord[]
  status: 'new' | 'existing' | 'possible_duplicate'
  existingClientId?: string
  existingClientName?: string
  warnings: string[]
}

export interface AnalyzeResult {
  ok: boolean
  columns: DetectedColumn[]
  totalRows: number
  skippedNoName: number
  clients: PreviewClient[]
  error?: string
}

interface ExistingRef { id: string; name: string }

async function buildPreview(groups: GroupedClientDraft[]): Promise<PreviewClient[]> {
  if (groups.length === 0) return []

  const existing = await prisma.client.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, firstName: true, lastName: true, workplace: true, phone: true, telegram: true, email: true },
  })

  const byPhone = new Map<string, ExistingRef>()
  const byEmail = new Map<string, ExistingRef>()
  const byTelegram = new Map<string, ExistingRef>()
  const byNameWorkplace = new Map<string, ExistingRef>()
  const byName = new Map<string, ExistingRef>()

  for (const c of existing) {
    const ref: ExistingRef = { id: c.id, name: c.name }
    if (c.phone) {
      const n = normalizePhone(c.phone)
      if (n.valid) byPhone.set(n.value, ref)
    }
    if (c.email) byEmail.set(normalizeEmail(c.email), ref)
    if (c.telegram) byTelegram.set(normalizeTelegram(c.telegram).toLowerCase(), ref)

    const fullName = ([c.lastName, c.firstName].filter(Boolean).join(' ') || c.name).toLowerCase()
    if (c.workplace) byNameWorkplace.set(`${fullName}+${c.workplace.toLowerCase()}`, ref)
    byName.set(fullName, ref)
  }

  return groups.map(g => {
    let match: ExistingRef | undefined
    let status: PreviewClient['status'] = 'new'

    if (g.phone) match = byPhone.get(g.phone)
    if (!match && g.email) match = byEmail.get(g.email)
    if (!match && g.telegram) match = byTelegram.get(g.telegram.toLowerCase())

    if (match) {
      status = 'existing'
    } else {
      const fullName = [g.lastName, g.firstName].filter(Boolean).join(' ').toLowerCase()
      const nameMatch = g.workplace
        ? byNameWorkplace.get(`${fullName}+${g.workplace.toLowerCase()}`)
        : byName.get(fullName)
      if (nameMatch) { match = nameMatch; status = 'possible_duplicate' }
    }

    return {
      key: g.key,
      firstName: g.firstName, lastName: g.lastName, patronymic: g.patronymic, workplace: g.workplace,
      phone: g.phone, telegram: g.telegram, email: g.email,
      visitsCount: g.visits.length,
      visits: g.visits,
      status,
      existingClientId: match?.id,
      existingClientName: match?.name,
      warnings: g.rowWarnings,
    }
  })
}

export async function analyzeImportTable(
  table: string[][],
  overrides?: { index: number; field: ImportField | null }[],
): Promise<AnalyzeResult> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, columns: [], totalRows: 0, skippedNoName: 0, clients: [], error: authResult.error }

  try {
    let columns = detectColumns(table)

    // Колонки, которые обычные правила не смогли распознать — отдаём на разбор ИИ
    // (он видит только названия этих колонок, без данных клиентов)
    const unrecognized = columns.filter(c => c.confidence === 'ignored')
    if (unrecognized.length > 0) {
      const aiGuesses = await classifyHeadersWithAI(
        unrecognized.map(c => ({ header: c.header, hint: describeColumnShape(table, c.index) }))
      )
      if (aiGuesses) {
        columns = columns.map(c => {
          const posInSubset = unrecognized.findIndex(u => u.index === c.index)
          if (posInSubset === -1) return c
          const guess = aiGuesses.find(g => g.index === posInSubset)
          return guess?.field ? { ...c, field: guess.field, confidence: 'ai' as const } : c
        })
      }
    }

    if (overrides?.length) {
      columns = columns.map(c => {
        const ov = overrides.find(o => o.index === c.index)
        return ov ? { ...c, field: ov.field, confidence: 'high' as const } : c
      })
    }

    const { rows, skippedNoName } = applyMapping(table, columns)
    const totalRows = Math.max(table.length - 1, 0)

    if (rows.length === 0) {
      return {
        ok: false, columns, totalRows, skippedNoName, clients: [],
        error: 'Не удалось определить колонку с телефоном, email или именем клиента. Проверьте сопоставление колонок вручную',
      }
    }

    const groups = groupIntoClients(rows)
    const clients = await buildPreview(groups)
    return { ok: true, columns, totalRows, skippedNoName, clients }
  } catch (e) {
    console.error('[analyzeImportTable]', e)
    return { ok: false, columns: [], totalRows: 0, skippedNoName: 0, clients: [], error: 'Не удалось проанализировать таблицу' }
  }
}

// ============================================================
// PDF — построчное распознавание (менее точное, без сопоставления колонок)
// ============================================================

const PHONE_RE = /(\+?\d[\d\s\-()]{7,}\d)/
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/
const TELEGRAM_RE = /@[a-zA-Z0-9_]{4,}/

export async function parsePdfFile(formData: FormData): Promise<AnalyzeResult> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, columns: [], totalRows: 0, skippedNoName: 0, clients: [], error: authResult.error }

  try {
    const file = formData.get('file')
    if (!(file instanceof File)) {
      return { ok: false, columns: [], totalRows: 0, skippedNoName: 0, clients: [], error: 'Файл не найден' }
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const parser = new PDFParse({ data: buffer })
    const result = await parser.getText()
    await parser.destroy()

    const lines = result.text.split('\n').map(l => l.trim()).filter(Boolean)
    const rows: { firstName: string; lastName?: string; patronymic?: string; phone?: string; phoneValid?: boolean; telegram?: string; email?: string; visit: null }[] = []
    let skippedNoName = 0

    for (const line of lines) {
      const emailMatch = line.match(EMAIL_RE)
      const phoneMatch = line.match(PHONE_RE)
      let rest = line
      if (emailMatch) rest = rest.replace(emailMatch[0], ' ')
      if (phoneMatch) rest = rest.replace(phoneMatch[0], ' ')
      const telegramMatch = rest.match(TELEGRAM_RE)
      if (telegramMatch) rest = rest.replace(telegramMatch[0], ' ')

      const namePart = rest.replace(/[,;|]/g, ' ').trim()
      if (!namePart) { skippedNoName++; continue }

      const { firstName, lastName, patronymic } = splitFullName(namePart)
      if (!firstName) { skippedNoName++; continue }

      const phoneNorm = phoneMatch ? normalizePhone(phoneMatch[0]) : undefined

      rows.push({
        firstName, lastName, patronymic,
        phone: phoneNorm?.value, phoneValid: phoneNorm?.valid,
        telegram: telegramMatch ? normalizeTelegram(telegramMatch[0]) : undefined,
        email: emailMatch ? normalizeEmail(emailMatch[0]) : undefined,
        visit: null,
      })
    }

    if (rows.length === 0) {
      return {
        ok: false, columns: [], totalRows: lines.length, skippedNoName, clients: [],
        error: 'Не удалось распознать клиентов в PDF. Попробуйте загрузить Excel/CSV — так результат надёжнее',
      }
    }

    const groups = groupIntoClients(rows)
    const clients = await buildPreview(groups)
    return { ok: true, columns: [], totalRows: lines.length, skippedNoName, clients }
  } catch (e) {
    console.error('[parsePdfFile]', e)
    return { ok: false, columns: [], totalRows: 0, skippedNoName: 0, clients: [], error: 'Не удалось прочитать PDF файл' }
  }
}

// ============================================================
// ПОДТВЕРЖДЕНИЕ ИМПОРТА
// ============================================================

function buildFullName(c: { firstName: string; lastName?: string; patronymic?: string }) {
  return [c.lastName, c.firstName, c.patronymic].map(p => p?.trim()).filter(Boolean).join(' ')
}

export async function confirmImport(clients: PreviewClient[], importSource: 'GOOGLE_SHEET' | 'EXCEL' | 'PDF') {
  const authResult = await requireStaffSession()
  if (!authResult.ok) {
    return { ok: false as const, error: authResult.error, createdClients: 0, updatedClients: 0, createdVisits: 0 }
  }

  try {
    let createdClients = 0
    let updatedClients = 0
    let createdVisits = 0

    await prisma.$transaction(async tx => {
      for (const c of clients) {
        let clientId: string
        let existingVisitCount = 0

        if (c.status === 'existing' && c.existingClientId) {
          clientId = c.existingClientId
          existingVisitCount = await tx.clientVisit.count({ where: { clientId } })
          updatedClients++
        } else {
          const created = await tx.client.create({
            data: {
              name: buildFullName(c),
              firstName: c.firstName.trim(),
              lastName: c.lastName?.trim() || null,
              patronymic: c.patronymic?.trim() || null,
              workplace: c.workplace?.trim() || null,
              phone: c.phone?.trim() || null,
              telegram: c.telegram?.trim() || null,
              email: c.email?.trim() || null,
              type: 'INDIVIDUAL',
              status: computeStatusFromVisitCount(c.visits.length),
            },
          })
          clientId = created.id
          createdClients++
        }

        for (const v of c.visits) {
          await tx.clientVisit.create({
            data: {
              clientId,
              date: v.date ? new Date(v.date) : null,
              room: v.room || null,
              format: v.format || null,
              durationHours: v.durationHours ?? null,
              grossAmount: v.grossAmount ?? null,
              netAmount: v.netAmount ?? null,
              comment: v.comment || null,
              importSource,
            },
          })
          createdVisits++
        }

        // Для уже существующего клиента статус пересчитываем по итоговому числу визитов
        if (c.status === 'existing' && c.visits.length > 0) {
          await tx.client.update({
            where: { id: clientId },
            data: { status: computeStatusFromVisitCount(existingVisitCount + c.visits.length) },
          })
        }
      }
    }, { timeout: 120_000 })

    await prisma.auditLog.create({
      data: {
        userId: authResult.userId,
        action: 'CLIENTS_IMPORTED',
        entityType: 'Client',
        entityId: 'bulk',
        metadata: { createdClients, updatedClients, createdVisits, importSource },
      },
    })

    revalidatePath('/admin/clients')
    return { ok: true as const, createdClients, updatedClients, createdVisits }
  } catch (e) {
    console.error('[confirmImport]', e)
    return { ok: false as const, error: 'Не удалось импортировать клиентов', createdClients: 0, updatedClients: 0, createdVisits: 0 }
  }
}
