// Синхронизация вкладки "Расходы" Google-таблицы — в отличие от синхронизации
// выручки (revenue-sync.ts, которая только ДОБАВЛЯЕТ новые визиты и никогда их
// не меняет), здесь строки нужно ОБНОВЛЯТЬ: одно и то же обязательство может
// доплачиваться со временем (actualAmount растёт), поэтому идентичность строки
// (externalId, см. parse-expenses-sheet.ts) стабильна, а сумма факта — нет.
// Повторный запуск: новых externalId — создаёт, существующих — обновляет сумму
// факта/статус/кто оплатил, никогда не создаёт дубликат.
import { prisma } from '@/lib/prisma'
import { fetchGoogleSheetTable } from '@/lib/import/fetch-sheet'
import { parseExpensesTable } from '@/lib/expenses/parse-expenses-sheet'
import { EXPENSE_CATEGORY_DICTIONARY } from '@/lib/expense-model'

export const EXPENSES_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1W9AIYljLusgYcDSbeG5oK8HmTWuESVooBuBdiFmmGe8/edit?gid=0'

export interface ExpenseSyncResult {
  ok: boolean
  createdCount: number
  updatedCount: number
  error?: string
}

// Категории — небольшой фиксированный справочник, но хранится как настоящая
// таблица (не enum), чтобы в будущем можно было добавлять/переименовывать/
// перекрашивать категории из интерфейса, не трогая код.
async function ensureCategories(): Promise<Map<string, string>> {
  const byName = new Map<string, string>()
  for (const cat of EXPENSE_CATEGORY_DICTIONARY) {
    const row = await prisma.expenseCategory.upsert({
      where: { name: cat.name },
      update: { color: cat.color, sortOrder: cat.sortOrder },
      create: { name: cat.name, color: cat.color, sortOrder: cat.sortOrder },
    })
    byName.set(cat.name, row.id)
  }
  return byName
}

export async function syncExpensesSheet(): Promise<ExpenseSyncResult> {
  try {
    const raw = await fetchGoogleSheetTable(EXPENSES_SHEET_URL)
    if (!raw.ok) {
      return { ok: false, createdCount: 0, updatedCount: 0, error: raw.error }
    }

    const parsedRows = parseExpensesTable(raw.table)
    if (parsedRows.length === 0) {
      return { ok: true, createdCount: 0, updatedCount: 0 }
    }

    const categoryIdByName = await ensureCategories()

    const existing = await prisma.expense.findMany({
      where: { externalId: { in: parsedRows.map(r => r.externalId) } },
      select: { externalId: true },
    })
    const existingIds = new Set(existing.map(e => e.externalId))

    let createdCount = 0
    let updatedCount = 0

    for (const row of parsedRows) {
      const data = {
        externalSource: 'google_sheets',
        date: row.date,
        title: row.title,
        categoryId: categoryIdByName.get(row.category) ?? null,
        plannedAmount: row.plannedAmount,
        actualAmount: row.actualAmount,
        rawStatus: row.rawStatus,
        orderedBy: row.orderedBy,
        paidBy: row.paidBy,
        receivedBy: row.receivedBy,
      }

      if (existingIds.has(row.externalId)) {
        await prisma.expense.update({ where: { externalId: row.externalId }, data })
        updatedCount++
      } else {
        await prisma.expense.create({ data: { ...data, externalId: row.externalId } })
        existingIds.add(row.externalId) // на случай повторного externalId в этом же прогоне
        createdCount++
      }
    }

    return { ok: true, createdCount, updatedCount }
  } catch (e) {
    console.error('[syncExpensesSheet]', e)
    return { ok: false, createdCount: 0, updatedCount: 0, error: 'Не удалось синхронизировать таблицу расходов' }
  }
}
