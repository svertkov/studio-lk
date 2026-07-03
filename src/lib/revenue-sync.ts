// Автоматическая безопасная досинхронизация вкладки "Выручка" Google-таблицы.
// Не сервер-экшн (без 'use server') — вызывается только из защищённого секретом
// API-роута (src/app/api/cron/sync-revenue/route.ts), у которого нет сессии
// сотрудника, поэтому обычные server actions с requireStaffSession здесь не подходят.
//
// Безопасность от задвоения выручки: каждая строка таблицы при разборе получает
// стабильный хэш (hashSheetRow). confirmImport теперь сохраняет этот хэш на
// каждом визите. Эта функция импортирует ТОЛЬКО те строки, чьего хэша ещё нет
// среди уже загруженных визитов — существующие 340 визитов были захэшированы
// одноразовым скриптом при внедрении этой фичи, поэтому обычный запуск никогда
// не создаёт дубликат уже загруженного визита.
import { prisma } from '@/lib/prisma'
import { fetchGoogleSheetTable } from '@/lib/import/fetch-sheet'
import { detectColumns, applyMapping, groupIntoClients } from '@/lib/import/detect'
import { buildPreview, runConfirmImport } from '@/lib/actions/client-import'

export const REVENUE_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1W9AIYljLusgYcDSbeG5oK8HmTWuESVooBuBdiFmmGe8/edit?gid=2019194119'

export interface RevenueSyncResult {
  ok: boolean
  addedClients: number
  addedVisits: number
  skippedExisting: number
  error?: string
}

export async function syncRevenueSheet(): Promise<RevenueSyncResult> {
  try {
    const raw = await fetchGoogleSheetTable(REVENUE_SHEET_URL)
    if (!raw.ok) {
      return { ok: false, addedClients: 0, addedVisits: 0, skippedExisting: 0, error: raw.error }
    }

    const columns = detectColumns(raw.table)
    const { rows } = applyMapping(raw.table, columns)
    const groups = groupIntoClients(rows)

    const allHashes = groups.flatMap(g => g.visits.map(v => v.sourceRowHash).filter((h): h is string => !!h))
    if (allHashes.length === 0) {
      return { ok: true, addedClients: 0, addedVisits: 0, skippedExisting: 0 }
    }

    const existingRows = await prisma.clientVisit.findMany({
      where: { sourceRowHash: { in: allHashes } },
      select: { sourceRowHash: true },
    })
    const existingHashes = new Set(existingRows.map(r => r.sourceRowHash))
    const skippedExisting = allHashes.filter(h => existingHashes.has(h)).length

    // Оставляем в каждой группе только визиты с ещё не встречавшимся хэшем —
    // сама идентичность клиента (телефон/email/имя) остаётся прежней, меняется
    // только список визитов, которые реально нужно создать.
    const groupsWithNewVisitsOnly = groups
      .map(g => ({ ...g, visits: g.visits.filter(v => !v.sourceRowHash || !existingHashes.has(v.sourceRowHash)) }))
      .filter(g => g.visits.length > 0)

    if (groupsWithNewVisitsOnly.length === 0) {
      return { ok: true, addedClients: 0, addedVisits: 0, skippedExisting }
    }

    const preview = await buildPreview(groupsWithNewVisitsOnly)
    const result = await runConfirmImport(preview, 'GOOGLE_SHEET', null)

    if (!result.ok) {
      return { ok: false, addedClients: 0, addedVisits: 0, skippedExisting, error: result.error }
    }

    return { ok: true, addedClients: result.createdClients, addedVisits: result.createdVisits, skippedExisting }
  } catch (e) {
    console.error('[syncRevenueSheet]', e)
    return { ok: false, addedClients: 0, addedVisits: 0, skippedExisting: 0, error: 'Не удалось синхронизировать таблицу' }
  }
}
