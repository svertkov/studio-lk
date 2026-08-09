// Сборка "предлагаемых" domain-сущностей (ТЗ п.9/12/14/17/23/25/26) из уже
// дедуплицированных ContentDedupGroup + сопоставленных клиентов/редакторов.
// Ничего не пишет в БД — только строит Proposed*-объекты + manifest +
// exceptions, которые dry-run.ts печатает в отчёт.

import type {
  ClientMatch, ContentDedupGroup, EditorMatch, ManifestEntry, MigrationException,
  ProposedContentItem, ProposedMaterial, ProposedMetric, ProposedPublication,
  ProposedRecurringPayout, ProposedWorkItem, RowTrace, SourceContentRow,
  SourceTeamPayoutRow, SourceWorkPaymentRow,
} from './types'
import { makeManifestEntry } from './manifest'

function pickRepresentative(rows: SourceContentRow[]): SourceContentRow {
  return rows.find(r => r.legacyCode) ?? rows.find(r => r.date) ?? rows[0]
}

// Стабильная смысловая идентичность единицы контента — используется ВМЕСТО
// tempId внутри fingerprint дочерних сущностей (Publication/Metric/Material).
// tempId ("content-3-Д186") содержит порядковый индекс группы в ТЕКУЩЕМ
// прогоне — этот индекс может сместиться между запусками, если появляется
// новая исходная строка, обрабатываемая раньше по порядку файлов (реальный
// риск pre-apply hardening: без этой развязки fingerprint дочерней сущности
// менялся бы вместе с чужим сдвигом индекса, ломая идемпотентность). tempId
// остаётся для связи объектов ТОЛЬКО внутри одного вызова buildContentEntities.
function contentIdentityParts(clientHint: string, legacyCode: string | null, title: string, plannedPublishDate: string | null): (string | null)[] {
  return [clientHint, legacyCode, title, plannedPublishDate]
}

// entityKey ContentItem — НАМЕРЕННО без title/date (см. заголовок manifest.ts):
// при наличии legacy-кода это единственный устойчивый якорь (title в
// источнике реально правился между версиями таблиц, ТЗ п.6 hardening); без
// кода используем client+title — менее надёжно, но title хотя бы не
// участвует в fingerprint-сравнении дважды.
function contentEntityKeyParts(clientHint: string, legacyCode: string | null, title: string): (string | null)[] {
  return [clientHint, legacyCode ?? `T:${title.trim().toLowerCase()}`]
}

export interface ContentBuildResult {
  contentItems: ProposedContentItem[]
  publications: ProposedPublication[]
  metrics: ProposedMetric[]
  materials: ProposedMaterial[]
  exceptions: MigrationException[]
  manifest: ManifestEntry[]
}

export function buildContentEntities(
  groups: ContentDedupGroup[],
  clientMatches: Map<string, ClientMatch>,
): ContentBuildResult {
  const contentItems: ProposedContentItem[] = []
  const publications: ProposedPublication[] = []
  const metrics: ProposedMetric[] = []
  const materials: ProposedMaterial[] = []
  const exceptions: MigrationException[] = []
  const manifest: ManifestEntry[] = []

  groups.forEach((group, i) => {
    const rep = pickRepresentative(group.rows)
    const tempId = `content-${i}-${rep.legacyCode ?? rep.title.slice(0, 20)}`.replace(/\s+/g, '_')
    const match = clientMatches.get(rep.clientHint) ?? null
    const sources: RowTrace[] = group.rows.map(r => r.trace)

    if (!match || match.proposedSmmProjectId === null) {
      exceptions.push({
        category: match?.missingClient ? 'NEEDS_CLIENT_MAPPING' : 'NEEDS_CLIENT_MAPPING',
        message: match?.missingClient
          ? `клиент "${rep.clientHint}" не найден в Client — единица контента "${rep.title}" не может быть импортирована без ручного сопоставления`
          : `у клиента "${match?.proposedClientName ?? rep.clientHint}" нет SmmProject — единица контента "${rep.title}" не может быть импортирована, пока проект не создан`,
        trace: rep.trace,
        context: { clientHint: rep.clientHint, title: rep.title },
      })
    }

    const legacyCode = group.rows.find(r => r.legacyCode)?.legacyCode ?? null
    const description = group.rows.find(r => r.description)?.description ?? null
    const plannedPublishDate = group.rows.find(r => r.date)?.date ?? null

    contentItems.push({
      tempId,
      smmProjectId: match?.proposedSmmProjectId ?? null,
      clientHint: rep.clientHint,
      title: rep.title,
      description,
      productionBrief: null,
      legacyCode,
      plannedPublishDate,
      parentTempId: null,
      fileCodeStatus: 'UNRESOLVED',
      fileCodeBase: null,
      sources,
      dedupConfidence: group.confidence,
    })

    // File Code исторических роликов сознательно НЕ генерируется (ТЗ п.8/22)
    // — точный editor sequence на момент производства неизвестен и
    // придумывать его запрещено; отмечаем как отдельное ожидаемое
    // исключение, а не молчаливый пробел.
    exceptions.push({
      category: 'FILE_CODE_UNRESOLVED',
      message: `File Code для "${rep.title}"${legacyCode ? ` (legacy-код ${legacyCode})` : ''} не сформирован — исторический editor sequence неизвестен, требуется, при необходимости, ручная нормализация после импорта`,
      trace: rep.trace,
      context: { clientHint: rep.clientHint, legacyCode },
    })

    const identity = contentIdentityParts(rep.clientHint, legacyCode, rep.title, plannedPublishDate)
    const entityKeyParts = contentEntityKeyParts(rep.clientHint, legacyCode, rep.title)
    manifest.push(makeManifestEntry(rep.trace, 'ContentItem', tempId, entityKeyParts, identity))

    // --- Publications: одна на площадку, объединяя данные из всех строк группы ---
    const pubByPlatform = new Map<string, ProposedPublication>()
    for (const row of group.rows) {
      for (const p of row.platforms) {
        const key = p.platform
        const existing = pubByPlatform.get(key)
        const status = p.url ? 'PUBLISHED' : 'PLANNED'
        if (!existing) {
          pubByPlatform.set(key, {
            contentTempId: tempId, platform: p.platform,
            plannedPublishAt: row.date, publishedAt: p.url ? row.date : null,
            url: p.url, status, sources: [row.trace],
          })
        } else {
          if (!existing.url && p.url) { existing.url = p.url; existing.publishedAt = row.date; existing.status = 'PUBLISHED' }
          if (!existing.plannedPublishAt && row.date) existing.plannedPublishAt = row.date
          existing.sources.push(row.trace)
        }
      }
    }
    for (const pub of pubByPlatform.values()) {
      publications.push(pub)
      // Publication entityKey = родительский ключ контента + площадка (url
      // НЕ входит в ключ — он и есть то, что может обновиться после apply,
      // как раз то, что должно триггерить SOURCE_CHANGED_AFTER_APPLY, а не
      // расцениваться как "новая" публикация).
      manifest.push(makeManifestEntry(pub.sources[0], 'Publication', `${tempId}:${pub.platform}`, [...entityKeyParts, pub.platform], [...identity, pub.platform, pub.url]))
    }

    // --- Metrics: снимок на площадку/тип, дедуплицируя идентичные значения (ТЗ п.16) ---
    const seenMetric = new Map<string, ProposedMetric>()
    for (const row of group.rows) {
      for (const p of row.platforms) {
        for (const [metricType, value] of Object.entries(p.metrics)) {
          const capturedAt = row.date ?? plannedPublishDate
          if (!capturedAt) continue // без даты снимок не на что "повесить" — не выдумываем capturedAt
          // Ключ снимка — площадка+тип+ДАТА (не только площадка+тип): разные
          // значения на РАЗНЫХ датах — это нормальная история роста
          // просмотров (ТЗ, «Метрики публикации» — снимки, не последнее
          // значение), а не конфликт. Конфликт — только если на ОДНУ И ТУ ЖЕ
          // дату два источника дают разные числа (тогда порядок неизвестен).
          const snapshotKey = `${p.platform}:${metricType}:${capturedAt}`
          const existing = seenMetric.get(snapshotKey)
          if (existing) {
            if (existing.value === value) { existing.sources.push(row.trace); continue }
            exceptions.push({
              category: 'METRIC_CONFLICT',
              message: `конфликт значений метрики ${metricType}/${p.platform} на одну и ту же дату (${capturedAt}) для "${rep.title}": ${existing.value} vs ${value} — сохранено первое найденное, требуется проверка`,
              trace: row.trace, context: { clientHint: rep.clientHint, metricType, platform: p.platform, capturedAt, values: [existing.value, value] },
            })
            continue
          }
          const metric: ProposedMetric = {
            contentTempId: tempId, platform: p.platform, metricType: metricType as ProposedMetric['metricType'],
            value, capturedAt, capturedAtIsApproximate: row.date === null, sources: [row.trace],
          }
          seenMetric.set(snapshotKey, metric)
          metrics.push(metric)
          // Metric entityKey включает capturedAt (снимок на конкретную дату
          // — это часть идентичности, не то, что "меняется"); value вынесен
          // только в fingerprint — расхождение value при том же ключе уже
          // отдельно обрабатывается как METRIC_CONFLICT выше, sourceChanged
          // здесь избыточен.
          manifest.push(makeManifestEntry(row.trace, 'Metric', `${tempId}:${snapshotKey}`, [...entityKeyParts, p.platform, metricType, capturedAt], [...identity, p.platform, metricType, value, capturedAt]))
        }
      }
    }

    // --- Materials: источники/мастер (ТЗ п.17), дедуплицируя одинаковый URL ---
    const seenUrls = new Set<string>()
    for (const row of group.rows) {
      if (row.sourceUrl && !seenUrls.has(row.sourceUrl)) {
        seenUrls.add(row.sourceUrl)
        materials.push({ contentTempId: tempId, materialType: 'SOURCE_VIDEO', url: row.sourceUrl, sources: [row.trace] })
        // Material entityKey — по URL, не по materialType-слоту: одна и та
        // же ссылка не должна задвоиться, даже если её роль (source/master)
        // окажется переопределена; url меняется — новая ссылка это и есть
        // другая сущность (Materials не редактируются на месте в этом потоке).
        manifest.push(makeManifestEntry(row.trace, 'Material', `${tempId}:src:${row.sourceUrl}`, [...entityKeyParts, 'SOURCE_VIDEO', row.sourceUrl]))
      }
      if (row.masterUrl && !seenUrls.has(row.masterUrl)) {
        seenUrls.add(row.masterUrl)
        materials.push({ contentTempId: tempId, materialType: 'MASTER', url: row.masterUrl, sources: [row.trace] })
        manifest.push(makeManifestEntry(row.trace, 'Material', `${tempId}:master:${row.masterUrl}`, [...entityKeyParts, 'MASTER', row.masterUrl]))
      }
    }
  })

  return { contentItems, publications, metrics, materials, exceptions, manifest }
}

// ============================================================
// WorkItems (ТЗ п.23/24) — финансовая таблица не содержит имени
// исполнителя вообще (реальный факт "Финансы SMM 2470_____.xlsx" — только
// клиент/дата/единица/сумма), а SmmWorkItem.performerId обязателен в схеме
// — придумывать исполнителя запрещено (ТЗ п.41), поэтому ЭТИ строки НЕ
// превращаются в ProposedWorkItem автоматически, только в exception с
// полными данными для последующего ручного назначения.
// ============================================================

export function buildWorkItemCandidates(
  paymentRows: SourceWorkPaymentRow[],
  contentItems: ProposedContentItem[],
  clientMatches: Map<string, ClientMatch>,
): { workItems: ProposedWorkItem[]; exceptions: MigrationException[]; manifest: ManifestEntry[] } {
  const exceptions: MigrationException[] = []
  const manifest: ManifestEntry[] = []
  const byLegacy = new Map<string, ProposedContentItem>()
  for (const ci of contentItems) if (ci.legacyCode) byLegacy.set(`${ci.clientHint}::${ci.legacyCode.toUpperCase()}`, ci)

  for (const row of paymentRows) {
    const match = clientMatches.get(row.clientHint)
    const contentMatch = row.legacyCode ? byLegacy.get(`${row.clientHint}::${row.legacyCode.toUpperCase()}`) : undefined

    if (!contentMatch) {
      exceptions.push({
        category: 'CONTENT_MATCH_NOT_FOUND',
        message: `финансовая строка (${row.clientHint}${row.legacyCode ? `, код ${row.legacyCode}` : ''}, ${row.amount ?? '?'}₽) не сопоставлена ни с одной единицей контента`,
        trace: row.trace, context: { clientHint: row.clientHint, legacyCode: row.legacyCode, title: row.title, amount: row.amount },
      })
    }

    exceptions.push({
      category: 'NEEDS_EDITOR_MAPPING',
      message: `в источнике не указан исполнитель — сумма ${row.amount ?? '?'}₽ за "${row.title ?? row.legacyCode ?? 'без названия'}" (${row.clientHint}) не может стать SmmWorkItem без ручного назначения монтажёра`,
      trace: row.trace,
      // performer: '(не указан в источнике)' — отдельная группа при
      // агрегации (ТЗ hardening п.17): эти строки в принципе не содержат
      // имени исполнителя (структурный пробел файла), не то же самое, что
      // "исполнитель есть, но не сопоставлен" (Лиза Ваниосова/Подрядчики).
      context: { clientHint: row.clientHint, performer: '(не указан в источнике)', amount: row.amount, contentTempId: contentMatch?.tempId ?? null, missingProject: match?.missingProject ?? true },
    })
  }

  return { workItems: [], exceptions, manifest }
}

// ============================================================
// SmmRecurringPayout-кандидаты (ТЗ п.26) — требуется повторяющийся паттерн
// минимум в 2 разных месяцах для одной и той же пары исполнитель+клиент,
// одной случайной исторической выплаты недостаточно.
// ============================================================

export function buildRecurringPayoutCandidates(
  teamRows: SourceTeamPayoutRow[],
  editorMatches: Map<string, EditorMatch>,
  clientMatches: Map<string, ClientMatch>,
): { proposals: ProposedRecurringPayout[]; exceptions: MigrationException[] } {
  const exceptions: MigrationException[] = []
  const byPair = new Map<string, SourceTeamPayoutRow[]>()
  for (const row of teamRows) {
    const key = `${row.performerHint}::${row.clientHint ?? '∅'}`
    if (!byPair.has(key)) byPair.set(key, [])
    byPair.get(key)!.push(row)
  }

  const proposals: ProposedRecurringPayout[] = []
  for (const [, rows] of byPair) {
    const months = new Set(rows.map(r => r.month).filter((m): m is string => m !== null))
    const editorMatch = editorMatches.get(rows[0].performerHint)
    const clientMatch = rows[0].clientHint ? clientMatches.get(rows[0].clientHint) : null

    if (months.size < 2) {
      exceptions.push({
        category: 'OTHER',
        message: `недостаточно данных для регулярного обязательства: "${rows[0].performerHint}" / ${rows[0].clientHint ?? '—'} встречается только в ${months.size} месяце(ах) — по ТЗ требуется минимум 2`,
        trace: rows[0].trace, context: { performer: rows[0].performerHint, client: rows[0].clientHint, months: [...months] },
      })
      continue
    }
    if (!editorMatch || editorMatch.notFound) {
      // По одному exception на КАЖДУЮ исходную строку (не одну на пару
      // исполнитель+клиент) — иначе агрегированный отчёт по уникальным
      // исполнителям (ТЗ hardening п.17) не увидит реальное число строк,
      // стоящих за "Лиза Ваниосова"/"Подрядчики" и т.п.
      for (const row of rows) {
        exceptions.push({
          category: 'NEEDS_EDITOR_MAPPING',
          message: `исполнитель "${row.performerHint}" не сопоставлен ни с одним EditorProfile — регулярное обязательство не может быть создано`,
          trace: row.trace, context: { performer: row.performerHint, clientHint: row.clientHint },
        })
      }
      continue
    }

    const allDays = [...new Set(rows.flatMap(r => r.dueDates.map(d => new Date(d).getUTCDate())))].sort((a, b) => a - b)
    const allAmounts = rows.flatMap(r => r.amounts)
    const sortedAmounts = [...allAmounts].sort((a, b) => a - b)
    const medianAmount = sortedAmounts[Math.floor(sortedAmounts.length / 2)]

    proposals.push({
      performerHint: rows[0].performerHint,
      proposedEditorId: editorMatch.proposedEditorId,
      clientHint: rows[0].clientHint,
      proposedSmmProjectId: clientMatch?.proposedSmmProjectId ?? null,
      amount: medianAmount,
      daysOfMonth: allDays,
      evidenceMonths: [...months],
      sources: rows.map(r => r.trace),
    })

    if (!clientMatch || clientMatch.proposedSmmProjectId === null) {
      exceptions.push({
        category: 'NEEDS_CLIENT_MAPPING',
        message: `для регулярного обязательства "${rows[0].performerHint}" / "${rows[0].clientHint}" не найден SmmProject — обязательство будет создано без привязки к проекту, если это не исправить`,
        trace: rows[0].trace, context: { client: rows[0].clientHint },
      })
    }
  }

  return { proposals, exceptions }
}
