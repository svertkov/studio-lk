// Восстановление startAt/endAt у уже импортированных ClientVisit из исходной
// Google-таблицы студии. Общее ядро для dry-run.ts и apply.ts — оба скрипта
// обязаны считать один и тот же план по одной и той же логике, иначе apply
// мог бы применить не то, что показал dry-run.
//
// Сопоставление со старыми записями — НЕ по имени клиента (клиент.ts просит
// явно не полагаться только на имя), а по sourceRowHash: это тот же самый
// хэш исходной строки таблицы (см. hashSheetRow в src/lib/import/normalize.ts),
// который уже сохранён при первом импорте на каждой ClientVisit. Раз таблица
// с тех пор не редактировалась построчно, hashSheetRow(строка) сегодня даёт
// точно тот же хэш, что и тогда — это точное, а не нечёткое сопоставление.

import { prisma } from '@/lib/prisma'
import { fetchGoogleSheetTable } from '@/lib/import/fetch-sheet'
import { detectColumns, applyMapping } from '@/lib/import/detect'
import { extractStatedHours, extractTimeRange, combineDateWithStudioTime } from '@/lib/import/normalize'
import type { TimeRangeExtraction } from '@/lib/import/normalize'

export const SHEET_URL = 'https://docs.google.com/spreadsheets/d/1W9AIYljLusgYcDSbeG5oK8HmTWuESVooBuBdiFmmGe8/edit?gid=2019194119#gid=2019194119'

// Строки, где числа расходятся хотя бы на полчаса, — не совпадение округления,
// а реальное разногласие между тем, что уже сохранено, и тем, что дал разбор
// диапазона (см. ТЗ, часть 9: "16:00-18:30 при указанной длительности 2 часа — конфликт").
const DURATION_CONFLICT_TOLERANCE_HOURS = 0.5

export type PlanAction =
  | 'update'                    // время отсутствовало и уверенно восстановлено — будет применено apply
  | 'skip_already_correct'      // время уже есть и совпадает с тем, что даёт таблица — трогать не нужно
  | 'skip_already_set'          // время уже есть (расхождений не проверить/нет диапазона) — не трогаем
  | 'skip_no_time_in_sheet'     // в исходной строке нет диапазона времени вообще
  | 'skip_no_date'              // у визита нет даты — не от чего считать startAt
  | 'skip_unmatched'            // строка таблицы не сопоставлена ни с одним ClientVisit
  | 'skip_no_visit_data'        // строка не породила ни клиента, ни визита (совпадает с тем, что реальный импорт тоже её пропускает)
  | 'conflict_ambiguous_range'  // несколько диапазонов в строке — неясно, какой из них время съёмки
  | 'conflict_time_differs'     // время уже есть, но новое отличается — не перезаписываем молча
  | 'conflict_duration_mismatch' // разбор диапазона не согласуется с уже сохранённой длительностью

export interface RowPlan {
  sheetRow: number
  clientName: string
  rawDuration: string
  sourceRowHash: string | null
  matchedVisitId: string | null
  existingStartAt: string | null
  existingDurationHours: number | null
  timeRange: TimeRangeExtraction | null
  statedHours: number | null
  plannedStartAt: string | null
  plannedEndAt: string | null
  action: PlanAction
}

export interface Plan {
  totalSheetRows: number
  rows: RowPlan[]
}

interface SheetRowParsed {
  sheetRow: number
  clientName: string
  rawDuration: string
  sourceRowHash: string | null
  parsedDateIso: string | null
}

export async function buildSheetRows(): Promise<{ header: string[]; rows: SheetRowParsed[] }> {
  const sheetRes = await fetchGoogleSheetTable(SHEET_URL)
  if (!sheetRes.ok) throw new Error(sheetRes.error ?? 'Не удалось загрузить Google-таблицу')

  const table = sheetRes.table
  const header = table[0]
  const dataRows = table.slice(1)
  const columns = detectColumns(table)
  const durationIdx = columns.find(c => c.field === 'durationHours')?.index
  if (durationIdx == null) throw new Error('В таблице не найдена колонка длительности/времени съёмки')

  const rows: SheetRowParsed[] = []
  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i]
    if (row.every(c => !c?.trim())) continue
    const rawDuration = (row[durationIdx] ?? '').trim()

    // Прогоняем эту же строку через РЕАЛЬНУЮ applyMapping (ту же функцию, что
    // использует настоящий импорт) — гарантирует побайтово тот же sourceRowHash
    // и то же решение "есть ли у строки клиент/визит", без дублирования логики.
    const { rows: single } = applyMapping([header, row], columns)
    const parsed = single[0] ?? null
    const visit = parsed?.visit ?? null

    rows.push({
      sheetRow: i + 2, // +1 за заголовок, +1 за 1-based нумерацию строк в таблице
      clientName: parsed ? [parsed.lastName, parsed.firstName].filter(Boolean).join(' ') || parsed.firstName : '(не определён)',
      rawDuration,
      sourceRowHash: visit?.sourceRowHash ?? null,
      parsedDateIso: visit?.date ? visit.date.toISOString() : null,
    })
  }

  return { header, rows }
}

function sameMinute(a: Date, b: Date): boolean {
  return Math.abs(a.getTime() - b.getTime()) < 60_000
}

export async function buildPlan(): Promise<Plan> {
  const { rows } = await buildSheetRows()

  const hashes = rows.map(r => r.sourceRowHash).filter((h): h is string => !!h)
  const existingVisits = hashes.length > 0
    ? await prisma.clientVisit.findMany({
        where: { sourceRowHash: { in: hashes } },
        select: { id: true, sourceRowHash: true, date: true, startAt: true, durationHours: true },
      })
    : []
  const existingByHash = new Map(existingVisits.map(v => [v.sourceRowHash as string, v]))

  const plans: RowPlan[] = []

  for (const r of rows) {
    const base = {
      sheetRow: r.sheetRow,
      clientName: r.clientName,
      rawDuration: r.rawDuration,
      sourceRowHash: r.sourceRowHash,
    }

    if (!r.sourceRowHash) {
      plans.push({
        ...base, matchedVisitId: null, existingStartAt: null, existingDurationHours: null,
        timeRange: null, statedHours: null, plannedStartAt: null, plannedEndAt: null,
        action: 'skip_no_visit_data',
      })
      continue
    }

    const existing = existingByHash.get(r.sourceRowHash)
    if (!existing) {
      plans.push({
        ...base, matchedVisitId: null, existingStartAt: null, existingDurationHours: null,
        timeRange: null, statedHours: null, plannedStartAt: null, plannedEndAt: null,
        action: 'skip_unmatched',
      })
      continue
    }

    const timeRange = r.rawDuration ? extractTimeRange(r.rawDuration) : undefined
    const statedHours = r.rawDuration ? (extractStatedHours(r.rawDuration) ?? null) : null

    const rowMeta = {
      ...base,
      matchedVisitId: existing.id,
      existingStartAt: existing.startAt ? existing.startAt.toISOString() : null,
      existingDurationHours: existing.durationHours,
      timeRange: timeRange ?? null,
      statedHours,
    }

    if (existing.startAt) {
      // Время уже есть — не перезаписываем молча (ТЗ, часть 8). Если по
      // диапазону выходит то же самое — просто отмечаем "уже верно", если нет
      // диапазона вообще — "уже стоит, трогать нечего". Расхождение — конфликт.
      if (!timeRange || timeRange.confidence !== 'high' || !existing.date) {
        plans.push({ ...rowMeta, plannedStartAt: null, plannedEndAt: null, action: 'skip_already_set' })
        continue
      }
      const computedStart = combineDateWithStudioTime(existing.date, timeRange.startHour, timeRange.startMinute)
      plans.push({
        ...rowMeta,
        plannedStartAt: computedStart.toISOString(),
        plannedEndAt: new Date(computedStart.getTime() + timeRange.rangeDurationHours * 3_600_000).toISOString(),
        action: sameMinute(computedStart, existing.startAt) ? 'skip_already_correct' : 'conflict_time_differs',
      })
      continue
    }

    if (!existing.date) {
      plans.push({ ...rowMeta, plannedStartAt: null, plannedEndAt: null, action: 'skip_no_date' })
      continue
    }

    if (!timeRange) {
      plans.push({ ...rowMeta, plannedStartAt: null, plannedEndAt: null, action: 'skip_no_time_in_sheet' })
      continue
    }

    if (timeRange.confidence === 'low') {
      plans.push({ ...rowMeta, plannedStartAt: null, plannedEndAt: null, action: 'conflict_ambiguous_range' })
      continue
    }

    if (existing.durationHours != null && Math.abs(existing.durationHours - timeRange.rangeDurationHours) >= DURATION_CONFLICT_TOLERANCE_HOURS) {
      plans.push({ ...rowMeta, plannedStartAt: null, plannedEndAt: null, action: 'conflict_duration_mismatch' })
      continue
    }

    const start = combineDateWithStudioTime(existing.date, timeRange.startHour, timeRange.startMinute)
    const end = new Date(start.getTime() + timeRange.rangeDurationHours * 3_600_000)
    plans.push({ ...rowMeta, plannedStartAt: start.toISOString(), plannedEndAt: end.toISOString(), action: 'update' })
  }

  return { totalSheetRows: rows.length, rows: plans }
}

export function summarizePlan(plan: Plan) {
  const counts: Record<PlanAction, number> = {
    update: 0, skip_already_correct: 0, skip_already_set: 0, skip_no_time_in_sheet: 0,
    skip_no_date: 0, skip_unmatched: 0, skip_no_visit_data: 0,
    conflict_ambiguous_range: 0, conflict_time_differs: 0, conflict_duration_mismatch: 0,
  }
  for (const r of plan.rows) counts[r.action]++
  return counts
}
