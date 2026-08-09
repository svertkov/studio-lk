// Извлечение нормализованных "исходных строк" (ТЗ п.9/23/26) из уже
// прочитанного и классифицированного RawGrid. Здесь решается, какие строки
// вообще являются кандидатами в ContentItem/WorkItem/TeamPayout, а какие —
// служебный мусор (выходной/пустой разделитель/итог/заголовок, ТЗ п.9).

import type { RawGrid } from './xlsx-read'
import type { PlatformCell, SmmMetricType, SmmPublicationPlatform, SourceContentRow, SourceTeamPayoutRow, SourceWorkPaymentRow } from './types'
import { fillMergedCells } from './grid-utils'
import { normalizeAmount, normalizeDate, extractUrls, isWeekendMarker } from './normalize'
import { normalizePlatform } from './dictionaries'

const METRIC_KEYWORDS: [RegExp, SmmMetricType][] = [
  [/просмотр/, 'VIEWS'],
  [/охват/, 'REACH'],
  [/нравится|лайк/, 'LIKES'],
  [/коммент/, 'COMMENTS'],
  [/репост|share/, 'SHARES'],
  [/сохран/, 'SAVES'],
  [/реакци/, 'REACTIONS'],
  [/подпис/, 'FOLLOWERS_GAINED'],
  [/удержан/, 'RETENTION_PERCENT'],
  [/время\s*просмотр|watch\s*time/, 'WATCH_TIME'],
]

type ColumnRole =
  | { kind: 'DATE' }
  | { kind: 'LEGACY_CODE' }
  | { kind: 'TITLE'; platform: SmmPublicationPlatform | null }
  | { kind: 'DESCRIPTION' }
  | { kind: 'SOURCE_URL' }
  | { kind: 'MASTER_URL' }
  | { kind: 'PUBLISHED_URL'; platform: SmmPublicationPlatform | null }
  | { kind: 'SHOOT_NOTE' }
  | { kind: 'METRIC'; metricType: SmmMetricType; platform: SmmPublicationPlatform | null }
  | { kind: 'IGNORE' }

function asText(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t === '' ? null : t
}

// Комбинированный набор ключевых слов для распознавания "это похоже на
// строку-заголовок колонок" — используется и для поиска labelRow, и внутри
// classifyColumns для самой классификации.
const LABEL_KEYWORDS_RE = /название единиц|^пост\b|рилс|карусель|^клип\b|длинные видео|сторис|формат\s*\/\s*описание|^описание$|готовность исходников|готовность материала|готовность\s*\(ссылка\)|готовность ролика|опубликовано|публикация\s*\(ссылка\)|съемк|съёмк|индекс|^номер$|просмотр|охват|нравится|лайк|коммент|репост|сохран|реакци|подпис|удержан/

// Ищет ячейку с текстом "дата..." в первых maxScanRows строках — возвращает
// ВСЕ вхождения (не только первое), т.к. в реальных файлах "Дата" и строка с
// названиями остальных колонок иногда лежат на РАЗНЫХ строках (реальный
// случай — Контент-план Диамед РАБОЧИЙ, лист "февраль": строка 0 = "Дата
// публикации"/"Instagram"/"Telegram" (заголовок группы), а "номер"/"название
// единицы/ролика"/... — уже на строке 1; на других листах того же файла
// "Дата" и подписи колонок — одна и та же строка). labelRow ищется отдельно
// как строка с максимальным числом совпадений с LABEL_KEYWORDS_RE — не
// предполагается, что она обязательно совпадает со строкой "Дата".
function findDateRows(filled: unknown[][], maxScanRows: number): { row: number; col: number }[] {
  const found: { row: number; col: number }[] = []
  for (let r = 0; r < Math.min(maxScanRows, filled.length); r++) {
    for (let c = 0; c < (filled[r]?.length ?? 0); c++) {
      const t = asText(filled[r][c])?.toLowerCase()
      if (t && /^дата(\s|$)/.test(t)) found.push({ row: r, col: c })
    }
  }
  return found
}

function findLabelRow(filled: unknown[][], maxScanRows: number): number {
  let best = 0
  let bestScore = -1
  for (let r = 0; r < Math.min(maxScanRows, filled.length); r++) {
    const score = (filled[r] ?? []).reduce((acc: number, cell) => {
      const t = asText(cell)?.toLowerCase()
      return acc + (t && LABEL_KEYWORDS_RE.test(t) ? 1 : 0)
    }, 0)
    if (score > bestScore) { bestScore = score; best = r }
  }
  return best
}

// Реальный случай (ЗубовЛаб Рабочая.xlsx, лист "июль"): заголовок "Дата"
// стоит НАД колонкой с legacy-кодами, а "Индекс" — над колонкой с реальными
// датами (headers физически перепутаны местами относительно данных под
// ними, а не просто переставлены как колонки целиком — на соседнем листе
// "август" тот же физический порядок данных подписан верно). Доверять
// одному только тексту заголовка здесь нельзя — резолвим data-driven:
// какая из двух кандидатных колонок реально содержит парсящиеся даты.
function resolveDateAndLegacyColumns(filled: unknown[][], labelRow: number, dateRowCandidates: { row: number; col: number }[]): { dateCol: number | null; legacyCol: number | null } {
  if (dateRowCandidates.length === 0) return { dateCol: null, legacyCol: null }
  const dateHeaderCol = dateRowCandidates[0].col
  const scanFrom = Math.max(labelRow, dateRowCandidates[0].row)

  let legacyHeaderCol: number | null = null
  for (let r = 0; r <= scanFrom; r++) {
    for (let c = 0; c < (filled[r]?.length ?? 0); c++) {
      const t = asText(filled[r][c])?.toLowerCase()
      if (t && /индекс|^номер$/.test(t) && c !== dateHeaderCol) { legacyHeaderCol = c; break }
    }
    if (legacyHeaderCol !== null) break
  }
  if (legacyHeaderCol === null) return { dateCol: dateHeaderCol, legacyCol: null }

  const dateHitRate = (col: number) => {
    let hits = 0
    let total = 0
    for (let r = scanFrom + 1; r < filled.length; r++) {
      const v = filled[r][col]
      if (v == null) continue
      total++
      if (normalizeDate(v) != null) hits++
    }
    return total === 0 ? 0 : hits / total
  }
  const rateAtDateHeader = dateHitRate(dateHeaderCol)
  const rateAtLegacyHeader = dateHitRate(legacyHeaderCol)
  return rateAtLegacyHeader > rateAtDateHeader
    ? { dateCol: legacyHeaderCol, legacyCol: dateHeaderCol }
    : { dateCol: dateHeaderCol, legacyCol: legacyHeaderCol }
}

function classifyColumns(filled: unknown[][], labelRow: number, dateCol: number, legacyCol: number | null, maxCol: number): ColumnRole[] {
  const roles: ColumnRole[] = []
  const groupRow1 = labelRow >= 2 ? filled[labelRow - 2] : null // напр. "Площадка"/"Съемка"
  const groupRow2 = labelRow >= 1 ? filled[labelRow - 1] : null // напр. "Инстаграм"/"ВК"

  for (let c = 0; c < maxCol; c++) {
    if (c === dateCol) { roles.push({ kind: 'DATE' }); continue }
    if (c === legacyCol) { roles.push({ kind: 'LEGACY_CODE' }); continue }
    const label = asText(filled[labelRow]?.[c])?.toLowerCase() ?? ''
    const groupLabel = asText(groupRow2?.[c]) ?? asText(groupRow1?.[c]) ?? ''
    const platform = normalizePlatform(groupLabel)

    if (!label) { roles.push({ kind: 'IGNORE' }); continue }
    if (/название единиц|^пост\b|рилс|карусель|^клип\b|длинные видео|сторис/.test(label)) { roles.push({ kind: 'TITLE', platform }); continue }
    if (/формат\s*\/\s*описание|^описание$/.test(label)) { roles.push({ kind: 'DESCRIPTION' }); continue }
    if (/готовность исходников/.test(label)) { roles.push({ kind: 'SOURCE_URL' }); continue }
    if (/готовность материала|готовность\s*\(ссылка\)|готовность ролика/.test(label)) { roles.push({ kind: 'MASTER_URL' }); continue }
    if (/опубликовано|публикация\s*\(ссылка\)/.test(label)) { roles.push({ kind: 'PUBLISHED_URL', platform }); continue }
    if (/съемк|съёмк/.test(label)) { roles.push({ kind: 'SHOOT_NOTE' }); continue }
    const metric = METRIC_KEYWORDS.find(([re]) => re.test(label))
    if (metric) { roles.push({ kind: 'METRIC', metricType: metric[1], platform }); continue }
    roles.push({ kind: 'IGNORE' })
  }
  return roles
}

// Единая точка входа для PRODUCTION/CONTENT_PLAN/ANALYTICS листов — все три
// имеют одну и ту же построчную (1 строка = 1 календарный день) форму,
// различие только в том, какие роли колонок реально заполнены.
export function extractContentRows(grid: RawGrid, clientHint: string): { rows: SourceContentRow[]; skippedServiceRows: number } {
  const filled = fillMergedCells(grid)
  const dateRowCandidates = findDateRows(filled, 5)
  if (dateRowCandidates.length === 0) return { rows: [], skippedServiceRows: 0 }
  const labelRow = findLabelRow(filled, 5)

  const { dateCol, legacyCol } = resolveDateAndLegacyColumns(filled, labelRow, dateRowCandidates)
  if (dateCol === null) return { rows: [], skippedServiceRows: 0 }
  const roles = classifyColumns(filled, labelRow, dateCol, legacyCol, grid.maxCol)
  const legacyColIdx = legacyCol ?? -1
  // Данные начинаются после САМОЙ НИЖНЕЙ из строк заголовка (labelRow может
  // быть выше строки с "Дата", как в примере из комментария выше) — иначе
  // строка с подписями колонок сама попала бы в данные как "контент".
  const dataStartRow = Math.max(labelRow, dateRowCandidates[0].row) + 1

  const rows: SourceContentRow[] = []
  let skipped = 0

  for (let r = dataStartRow; r < filled.length; r++) {
    const rawRow = filled[r]
    const dateRaw = rawRow[dateCol]
    if (isWeekendMarker(dateRaw)) { skipped++; continue }

    const titleCols = roles
      .map((role, idx) => ({ role, idx }))
      .filter((x): x is { role: Extract<ColumnRole, { kind: 'TITLE' }>; idx: number } => x.role.kind === 'TITLE')

    const titleTexts = titleCols.map(({ idx }) => asText(rawRow[idx])).filter((t): t is string => t !== null)
    // Заголовок вроде "ВЫХОДНОЙ" может стоять и в колонке названия, не даты
    // (реальный случай — Контент-план Диамед РАБОЧИЙ, сентябрь) — тоже служебная строка.
    if (titleTexts.length === 0 || titleTexts.every(t => isWeekendMarker(t))) { skipped++; continue }

    const primaryTitle = titleTexts[0]
    const date = normalizeDate(dateRaw)
    const legacyCode = legacyColIdx >= 0 ? asText(rawRow[legacyColIdx]) : null

    const descriptionParts = roles
      .map((role, idx) => (role.kind === 'DESCRIPTION' ? asText(rawRow[idx]) : null))
      .filter((t): t is string => t !== null)
    const shootParts = roles
      .map((role, idx) => (role.kind === 'SHOOT_NOTE' ? asText(rawRow[idx]) : null))
      .filter((t): t is string => t !== null)
    const sourceUrls = roles.flatMap((role, idx) => (role.kind === 'SOURCE_URL' ? extractUrls(rawRow[idx]) : []))
    const masterUrls = roles.flatMap((role, idx) => (role.kind === 'MASTER_URL' ? extractUrls(rawRow[idx]) : []))

    // Платформенные блоки — группируем по platform (null = "не привязано к
    // площадке", т.е. одиночная production-таблица без разбивки по соцсети).
    const platformsSeen = new Map<string, PlatformCell>()
    for (const { role, idx } of titleCols) {
      const key = role.platform ?? '∅'
      const title = asText(rawRow[idx])
      if (!title) continue
      if (!platformsSeen.has(key)) platformsSeen.set(key, { platform: role.platform ?? 'OTHER', title, url: null, metrics: {} })
      else platformsSeen.get(key)!.title = title
    }
    for (let idx = 0; idx < roles.length; idx++) {
      const role = roles[idx]
      if (role.kind === 'PUBLISHED_URL') {
        const key = role.platform ?? '∅'
        const urls = extractUrls(rawRow[idx])
        if (urls.length > 0) {
          if (!platformsSeen.has(key)) platformsSeen.set(key, { platform: role.platform ?? 'OTHER', title: primaryTitle, url: urls[0], metrics: {} })
          else platformsSeen.get(key)!.url = urls[0]
        }
      }
      if (role.kind === 'METRIC') {
        const key = role.platform ?? '∅'
        const amount = normalizeAmount(rawRow[idx])
        if (amount.value != null) {
          if (!platformsSeen.has(key)) platformsSeen.set(key, { platform: role.platform ?? 'OTHER', title: primaryTitle, url: null, metrics: {} })
          platformsSeen.get(key)!.metrics[role.metricType] = amount.value
        }
      }
    }

    rows.push({
      trace: { file: grid.file, sheet: grid.sheet, row: r + 1 },
      date,
      legacyCode,
      title: primaryTitle,
      description: descriptionParts.length > 0 ? descriptionParts.join('; ') : null,
      productionBrief: null,
      sourceUrl: sourceUrls[0] ?? null,
      masterUrl: masterUrls[0] ?? null,
      platforms: [...platformsSeen.values()],
      shootNote: shootParts.length > 0 ? shootParts.join('; ') : null,
      clientHint,
    })
  }

  return { rows, skippedServiceRows: skipped }
}

// ============================================================
// WORK_PAYMENTS (ТЗ п.23) — "Финансы SMM 2470_____.xlsx": несколько
// клиентских блоков дата/единица-контента/стоимость бок о бок в одном
// листе; иногда колонка "дата" фактически содержит legacy-код (Пастернак),
// а не дату (реальный случай, см. отчёт).
// ============================================================

const LEGACY_CODE_RE = /^[А-Яа-яЁё]{1,3}\d+$/

export function extractWorkPaymentRows(grid: RawGrid): SourceWorkPaymentRow[] {
  const filled = fillMergedCells(grid)
  const rows: SourceWorkPaymentRow[] = []

  // Найти ВСЕ вхождения тройки дата/единиц.../стоимость в заголовочных строках.
  const blocks: { headerRow: number; dateCol: number; titleCol: number; amountCol: number; clientHint: string }[] = []
  for (let r = 0; r < Math.min(6, filled.length); r++) {
    for (let c = 0; c < (filled[r]?.length ?? 0) - 2; c++) {
      const a = asText(filled[r][c])?.toLowerCase()
      const b = asText(filled[r][c + 1])?.toLowerCase()
      const cc = asText(filled[r][c + 2])?.toLowerCase()
      if (a && /^дата$/.test(a) && b && /единиц/.test(b) && cc && /стоимост/.test(cc)) {
        const clientHint = asText(filled[r - 1]?.[c]) ?? asText(filled[r - 1]?.[c - 1]) ?? 'неизвестный клиент'
        blocks.push({ headerRow: r, dateCol: c, titleCol: c + 1, amountCol: c + 2, clientHint })
      }
    }
  }

  for (const block of blocks) {
    for (let r = block.headerRow + 1; r < filled.length; r++) {
      const rowArr = filled[r]
      const leadingRaw = rowArr[block.dateCol - 1]
      const dateRaw = rowArr[block.dateCol]
      if (isWeekendMarker(dateRaw)) continue

      const parsedDate = normalizeDate(dateRaw)
      const legacyFromDateCol = parsedDate === null && typeof dateRaw === 'string' && LEGACY_CODE_RE.test(dateRaw.trim()) ? dateRaw.trim() : null
      const legacyFromLeadingCol = typeof leadingRaw === 'string' && LEGACY_CODE_RE.test(leadingRaw.trim()) ? leadingRaw.trim() : null
      const legacyCode = legacyFromLeadingCol ?? legacyFromDateCol

      const title = asText(rowArr[block.titleCol])
      const amount = normalizeAmount(rowArr[block.amountCol]).value

      if (legacyCode === null && parsedDate === null && title === null && amount === null) continue // пустая строка

      rows.push({
        trace: { file: grid.file, sheet: grid.sheet, row: r + 1 },
        clientHint: block.clientHint,
        legacyCode,
        title,
        date: parsedDate,
        amount,
        performerHint: null,
      })
    }
  }

  return rows
}

// ============================================================
// TEAM_PAYOUTS (ТЗ п.26) — "2470 SMM Оплата.xlsx": кросс-таб
// исполнитель × клиент, две даты в месяц на клиента, "Выплачено" в
// последней колонке.
// ============================================================

export function extractTeamPayoutRows(grid: RawGrid): SourceTeamPayoutRow[] {
  const filled = fillMergedCells(grid)
  const results: SourceTeamPayoutRow[] = []

  // Ищем блоки "Месяц"+"Сотрудник" в заголовке — каждый блок открывает
  // подтаблицу (в реальном файле их два — Июль и Август).
  for (let r = 0; r < filled.length; r++) {
    const c0 = asText(filled[r][0])?.toLowerCase()
    const c1 = asText(filled[r][1])?.toLowerCase()
    if (c0 !== 'месяц' || !c1 || !/сотрудник/.test(c1)) continue

    const clientRow = filled[r]
    const dateRow = filled[r + 2] // Месяц/Сотрудник(row r) → пусто(row r+1) → Дата(row r+2)
    if (!dateRow || asText(dateRow[0])?.toLowerCase() !== 'дата') continue

    // Данные начинаются с r+3, заканчиваются на следующей пустой строке или новом "Месяц" блоке.
    let dataRow = r + 3
    let monthLabel: string | null = null
    while (dataRow < filled.length) {
      const performer = asText(filled[dataRow][1])
      const monthCell = asText(filled[dataRow][0])
      if (monthCell) monthLabel = monthCell
      if (!performer) break // пустая строка — конец блока
      if (asText(filled[dataRow][0])?.toLowerCase() === 'месяц') break // начался следующий блок

      for (let c = 3; c < grid.maxCol; c++) {
        const clientHint = asText(clientRow[c])
        if (!clientHint || clientHint.toLowerCase() === 'сотрудник') continue
        const amount = normalizeAmount(filled[dataRow][c]).value
        const dueDate = normalizeDate(dateRow[c])
        if (amount == null) continue
        const paidCellRaw = asText(filled[dataRow][grid.maxCol - 1])
        const paid = paidCellRaw ? /выплачено/i.test(paidCellRaw) : null

        const existing = results.find(x => x.performerHint === performer && x.clientHint === clientHint && x.month === monthLabel)
        if (existing) {
          existing.amounts.push(amount)
          if (dueDate) existing.dueDates.push(dueDate)
        } else {
          results.push({
            trace: { file: grid.file, sheet: grid.sheet, row: dataRow + 1 },
            performerHint: performer,
            clientHint,
            month: monthLabel,
            dueDates: dueDate ? [dueDate] : [],
            amounts: [amount],
            paid,
          })
        }
      }
      dataRow++
    }
  }

  return results
}
