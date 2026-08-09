// Классификация листа (ТЗ п.3) + обнаружение schema drift (ТЗ п.4) — чистые
// функции над уже прочитанным RawGrid (xlsx-read.ts). Никакого обращения к
// БД/файловой системе здесь нет.

import type { RawGrid } from './xlsx-read'
import type { DriftIssue, SheetClassification, WorkbookType } from './types'
import { normalizeDate, normalizeAmount, isWeekendMarker } from './normalize'
import { hintFromWorkbookName, hintFromLegacyCode, normalizePlatform, LEGACY_PREFIX_HINTS } from './dictionaries'

const HEADER_SCAN_ROWS = 5

function headerText(grid: RawGrid): string {
  return grid.rows
    .slice(0, HEADER_SCAN_ROWS)
    .flat()
    .filter((v): v is string => typeof v === 'string')
    .join(' | ')
    .toLowerCase()
}

interface TypeScore {
  type: WorkbookType
  score: number
  evidence: string[]
}

// Детектор — набор ключевых слов/фраз; каждое совпадение +1 к score этого типа.
const SCRIPT_LIBRARY_MARKERS = ['сценарии для видео', 'локация и кадр', 'сценарий / озвучка', 'раскадровка', 'история']
const PRODUCTION_MARKERS = ['готовность исходников', 'готовность материала', 'опубликовано (ссылка)', 'название единицы', 'производственный брифинг', 'формат / описание']
const ANALYTICS_MARKERS = ['просмотры', 'охват', 'удержание', 'комменты', 'подписки', 'реакции', 'лайки', 'репост']
const CONTENT_PLAN_MARKERS = ['площадка', 'площадки', 'пост / рилс / карусель', 'дата публикации', 'сторис']
const WORK_PAYMENTS_MARKERS = ['стоимость', 'единицы контента', 'единиц контента']
const TEAM_PAYOUTS_MARKERS = ['сотрудник', 'выплачено', 'оплата за месяц']

function scoreMarkers(text: string, markers: string[]): { score: number; hits: string[] } {
  const hits = markers.filter(m => text.includes(m))
  return { score: hits.length, hits }
}

export function classifySheet(grid: RawGrid): SheetClassification {
  const text = headerText(grid)
  const scores: TypeScore[] = []

  const script = scoreMarkers(text, SCRIPT_LIBRARY_MARKERS)
  scores.push({ type: 'SCRIPT_LIBRARY', score: script.score, evidence: script.hits })

  const teamPayouts = scoreMarkers(text, TEAM_PAYOUTS_MARKERS)
  scores.push({ type: 'TEAM_PAYOUTS', score: teamPayouts.score, evidence: teamPayouts.hits })

  const workPayments = scoreMarkers(text, WORK_PAYMENTS_MARKERS)
  scores.push({ type: 'WORK_PAYMENTS', score: workPayments.score, evidence: workPayments.hits })

  const analytics = scoreMarkers(text, ANALYTICS_MARKERS)
  const contentPlan = scoreMarkers(text, CONTENT_PLAN_MARKERS)
  const production = scoreMarkers(text, PRODUCTION_MARKERS)
  scores.push({ type: 'ANALYTICS', score: analytics.score, evidence: analytics.hits })
  scores.push({ type: 'CONTENT_PLAN', score: contentPlan.score, evidence: contentPlan.hits })
  scores.push({ type: 'PRODUCTION', score: production.score, evidence: production.hits })

  scores.sort((a, b) => b.score - a.score)
  const best = scores[0]

  if (best.score === 0) {
    return {
      file: grid.file, sheet: grid.sheet, type: 'UNKNOWN', secondaryTypes: [],
      evidence: ['ни один известный маркер заголовка не найден — требуется ручная классификация'],
      dimensions: grid.dimensions, maxRow: grid.maxRow, maxCol: grid.maxCol,
    }
  }

  // CONTENT_PLAN и ANALYTICS почти всегда идут вместе в реальных файлах
  // (одна и та же таблица планирует публикацию И тут же показывает
  // просмотры/комменты по ней) — вторичный тип, а не отдельная классификация.
  const secondaryTypes: WorkbookType[] = []
  if (best.type !== 'ANALYTICS' && analytics.score >= 2) secondaryTypes.push('ANALYTICS')
  if (best.type !== 'CONTENT_PLAN' && contentPlan.score >= 2 && best.type !== 'PRODUCTION') secondaryTypes.push('CONTENT_PLAN')
  if (best.type !== 'PRODUCTION' && production.score >= 2 && (best.type === 'CONTENT_PLAN' || best.type === 'ANALYTICS')) secondaryTypes.push('PRODUCTION')

  return {
    file: grid.file,
    sheet: grid.sheet,
    type: best.type,
    secondaryTypes,
    evidence: best.evidence,
    dimensions: grid.dimensions,
    maxRow: grid.maxRow,
    maxCol: grid.maxCol,
  }
}

// ============================================================
// Schema drift — внутри одного листа (ТЗ п.4)
// ============================================================

export function detectSheetDrift(grid: RawGrid, sheetType: WorkbookType = 'UNKNOWN'): DriftIssue[] {
  // SCRIPT_LIBRARY-листы (сценарии/раскадровки) не являются табличными
  // источниками ContentItem/WorkItem вообще (ТЗ п.27) — построчные проверки
  // сумм/дат на них дают только шум (сценарный текст ошибочно проверяется,
  // будто это сумма/дата), поэтому для них считаем только структурные
  // сигналы (merges/скрытые строки), не построчные.
  if (sheetType === 'SCRIPT_LIBRARY') {
    const issues: DriftIssue[] = []
    if (grid.mergedRanges.length > 0) {
      issues.push({ file: grid.file, sheet: grid.sheet, kind: 'MERGED_CELLS', description: `${grid.mergedRanges.length} объединённых диапазонов ячеек (лист вне модели ContentItem, ТЗ п.27)` })
    }
    return issues
  }

  const issues: DriftIssue[] = []
  const seen = new Set<string>()
  const push = (issue: DriftIssue) => {
    // ExcelJS реплицирует значение объединённой ячейки во ВСЕ ячейки
    // диапазона при чтении (в отличие от Excel-семантики "значение только в
    // левой верхней") — без этой защиты одна и та же текстовая заметка в
    // D8:E8 попала бы в отчёт дважды подряд как два разных нарушения.
    const key = `${issue.kind}:${issue.row ?? ''}:${issue.description}`
    if (seen.has(key)) return
    seen.add(key)
    issues.push(issue)
  }
  const { file, sheet } = grid

  if (grid.mergedRanges.length > 0) {
    push({ file, sheet, kind: 'MERGED_CELLS', description: `${grid.mergedRanges.length} объединённых диапазонов ячеек — заголовки/группировки могут не совпадать построчно с данными` })
  }
  if (grid.hiddenRows.length > 0) {
    push({ file, sheet, kind: 'HIDDEN_ROWS', description: `скрытые строки: ${grid.hiddenRows.join(', ')} — данные в них не должны молча пропадать` })
  }
  if (grid.declaredMaxRow > grid.maxRow * 3 && grid.declaredMaxRow > 200) {
    push({ file, sheet, kind: 'SPARSE_SHEET_DIMENSIONS', description: `объявленный диапазон листа (${grid.declaredMaxRow} строк) значительно больше реально используемого (${grid.maxRow}) — лист заранее отформатирован с запасом` })
  }

  const legacyPrefixesSeen = new Set<string>()
  let sawDateAsRealDate = false
  let sawDateAsPlainText = false

  for (let r = 0; r < grid.rows.length; r++) {
    const row = grid.rows[r]
    const rowNum = r + 1

    for (let c = 0; c < row.length; c++) {
      const cell = row[c]
      // Битый serial бывает и NaN-датой (парсинг не удался), и ФОРМАЛЬНО
      // валидной датой с абсурдным годом (реальное предупреждение openpyxl
      // на "Финансы SMM 2470_____.xlsx": serial 3323830 → год далеко за
      // пределами разумного) — тот же диапазон, что normalizeDate уже
      // использует для отбраковки (2000..2100).
      if (cell instanceof Date && (isNaN(cell.getTime()) || cell.getUTCFullYear() < 2000 || cell.getUTCFullYear() > 2100)) {
        push({ file, sheet, kind: 'INVALID_DATE_SERIAL', description: 'ячейка помечена как дата, но значение вне допустимого диапазона (битый serial)', row: rowNum, column: String(c + 1) })
      }
      if (cell instanceof Date) sawDateAsRealDate = true
      if (typeof cell === 'string') {
        if (isWeekendMarker(cell)) {
          // Маркер "выходной" может стоять и в колонке даты (ожидаемо), и в
          // колонке названия/заголовка (реальный случай — Контент-план
          // Диамед РАБОЧИЙ, сентябрь, строка "ВЫХОДНОЙ" в колонке названия).
          if (c === 0) push({ file, sheet, kind: 'WEEKEND_MARKER_IN_DATE', description: `"${cell.trim()}" в колонке даты`, row: rowNum })
          else push({ file, sheet, kind: 'WEEKEND_MARKER_IN_TITLE', description: `"${cell.trim()}" встречен вне колонки даты (колонка ${c + 1})`, row: rowNum })
        } else if (/^\d{4}-\d{2}-\d{2}/.test(cell.trim())) {
          sawDateAsPlainText = true
        }
      }
      // Только для листов, где колонки вообще являются суммами
      // (WORK_PAYMENTS/TEAM_PAYOUTS) — на PRODUCTION/CONTENT_PLAN текстовые
      // колонки названия/описания насквозь содержат цифры (даты в тексте,
      // номера кадров и т.п.), и без этого ограничения проверка тонет в шуме.
      if (sheetType === 'WORK_PAYMENTS' || sheetType === 'TEAM_PAYOUTS') {
        const amount = normalizeAmount(cell)
        if (amount.isComplexText) {
          push({ file, sheet, kind: 'AMOUNT_AS_TEXT', description: `текстовая заметка вместо числовой суммы: "${amount.raw.slice(0, 60)}"`, row: rowNum, column: String(c + 1) })
        }
      }
      if (typeof cell === 'string' && LEGACY_PREFIX_HINTS.some(h => h.pattern.test(cell.trim()))) {
        const hint = hintFromLegacyCode(cell.trim())
        if (hint) legacyPrefixesSeen.add(`${cell.trim().replace(/\d+$/, '')}→${hint}`)
      }
    }
  }

  if (sawDateAsRealDate && sawDateAsPlainText) {
    push({ file, sheet, kind: 'DATE_AS_TEXT', description: 'в одном листе даты хранятся и как реальные даты, и как текстовые строки' })
  }

  // Один и тот же клиент в одном листе адресуется РАЗНЫМИ префиксами
  // legacy-кода (реальный случай — АЛЬГИЗ РАБОЧАЯ.xlsx: "АЛ1" и "А5" оба
  // означают АльгизВет) — не ошибка данных, но обязательный сигнал в отчёт.
  const byClient = new Map<string, Set<string>>()
  for (const entry of legacyPrefixesSeen) {
    const [prefix, client] = entry.split('→')
    if (!byClient.has(client)) byClient.set(client, new Set())
    byClient.get(client)!.add(prefix)
  }
  for (const [client, prefixes] of byClient) {
    if (prefixes.size > 1) {
      push({ file, sheet, kind: 'LEGACY_INDEX_VARIANT', description: `клиент "${client}" встречается под разными префиксами legacy-кода: ${[...prefixes].join(', ')}` })
    }
  }

  return issues
}

// ============================================================
// Schema drift — между листами одного workbook (ТЗ п.4, "один месяц имеет
// другую схему") + сопоставление колонок между соседними по названию месяца
// листами (ТЗ п.4, "колонки менялись местами")
// ============================================================

export function detectWorkbookDrift(grids: RawGrid[]): DriftIssue[] {
  const issues: DriftIssue[] = []
  if (grids.length < 2) return issues

  const headerRows = grids.map(g => ({
    file: g.file, sheet: g.sheet,
    firstTwoHeaders: (g.rows[0] ?? []).slice(0, 2).map(v => (typeof v === 'string' ? v.trim().toLowerCase() : null)),
    colCount: g.maxCol,
  }))

  const referenceOrder = headerRows[0].firstTwoHeaders
  for (const h of headerRows.slice(1)) {
    if (referenceOrder[0] && h.firstTwoHeaders[0] && referenceOrder[0] !== h.firstTwoHeaders[0] && referenceOrder.includes(h.firstTwoHeaders[0])) {
      issues.push({
        file: h.file, sheet: h.sheet, kind: 'COLUMN_ORDER_CHANGED',
        description: `первые колонки переставлены местами относительно листа "${headerRows[0].sheet}" ("${referenceOrder.join(', ')}" → "${h.firstTwoHeaders.join(', ')}")`,
      })
    }
  }

  const colCounts = headerRows.map(h => h.colCount)
  const minCols = Math.min(...colCounts)
  const maxCols = Math.max(...colCounts)
  if (maxCols > 0 && maxCols > minCols * 2 && maxCols - minCols > 5) {
    issues.push({
      file: grids[0].file, sheet: '(все листы)', kind: 'SHEET_SCHEMA_DIFFERS',
      description: `число колонок сильно различается между листами (от ${minCols} до ${maxCols}) — вероятно разные месяцы имеют разный набор площадок/метрик`,
    })
  }

  return issues
}

export function hintClientForWorkbook(fileName: string): string | null {
  return hintFromWorkbookName(fileName)
}

export function normalizePlatformHeader(raw: string): ReturnType<typeof normalizePlatform> {
  return normalizePlatform(raw)
}

export function normalizeDateCell(raw: unknown): string | null {
  return normalizeDate(raw)
}
