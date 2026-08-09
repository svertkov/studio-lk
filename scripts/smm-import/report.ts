// Человекочитаемый рендер DryRunResult (ТЗ п.29) — только форматирование,
// никакой бизнес-логики.

import type { ContentDedupGroup, DryRunResult, ExceptionCategory, ProposedContentItem } from './types'

const EXCEPTION_LABELS: Record<ExceptionCategory, string> = {
  NEEDS_CLIENT_MAPPING: 'NEEDS_CLIENT_MAPPING (нет клиента/проекта)',
  NEEDS_CONTENT_MATCH: 'NEEDS_CONTENT_MATCH',
  NEEDS_EDITOR_MAPPING: 'NEEDS_EDITOR_MAPPING (не сопоставлен исполнитель)',
  NEEDS_SCHEDULE_MATCH: 'NEEDS_SCHEDULE_MATCH',
  FILE_CODE_UNRESOLVED: 'FILE_CODE_UNRESOLVED (ожидаемо для истории)',
  METRIC_CONFLICT: 'METRIC_CONFLICT',
  PAYMENT_CONFLICT: 'PAYMENT_CONFLICT',
  UNSUPPORTED_SCRIPT_LIBRARY: 'UNSUPPORTED_SCRIPT_LIBRARY',
  INVALID_URL: 'INVALID_URL',
  INVALID_DATE: 'INVALID_DATE',
  CONTENT_MATCH_NOT_FOUND: 'CONTENT_MATCH_NOT_FOUND',
  OTHER: 'OTHER',
}

function line(char = '=', n = 78): string {
  return char.repeat(n)
}

export function renderTextReport(result: DryRunResult): string {
  const out: string[] = []
  out.push(line())
  out.push('SMM MIGRATION — DRY RUN REPORT')
  out.push(line())
  out.push('')

  out.push('--- 1. КЛАССИФИКАЦИЯ ЛИСТОВ -------------------------------------------------')
  const byFile = new Map<string, typeof result.sheetClassifications>()
  for (const c of result.sheetClassifications) {
    if (!byFile.has(c.file)) byFile.set(c.file, [])
    byFile.get(c.file)!.push(c)
  }
  for (const [file, sheets] of byFile) {
    out.push(`  ${file}`)
    for (const s of sheets) {
      const sec = s.secondaryTypes.length ? ` (+${s.secondaryTypes.join(',')})` : ''
      out.push(`    · ${s.sheet.padEnd(18)} ${s.dimensions.padEnd(12)} → ${s.type}${sec}`)
    }
  }
  out.push('')

  out.push('--- 2. SCHEMA DRIFT ----------------------------------------------------------')
  if (result.driftIssues.length === 0) out.push('  drift не обнаружен')
  const driftByKind = new Map<string, number>()
  for (const d of result.driftIssues) driftByKind.set(d.kind, (driftByKind.get(d.kind) ?? 0) + 1)
  for (const [kind, count] of driftByKind) out.push(`  ${kind}: ${count}`)
  out.push('')
  out.push('  Примеры (до 15):')
  for (const d of result.driftIssues.slice(0, 15)) {
    out.push(`    [${d.kind}] ${d.file} / ${d.sheet}${d.row ? ` строка ${d.row}` : ''} — ${d.description}`)
  }
  out.push('')

  out.push('--- 3. КЛИЕНТЫ -----------------------------------------------------------------')
  out.push('  Source → Proposed Client → Confidence')
  for (const m of result.clientMatches) {
    const target = m.proposedClientName ? `${m.proposedClientName}${m.proposedProjectCode ? ` (${m.proposedProjectCode})` : ' [SmmProject отсутствует]'}` : '— не найден'
    out.push(`    ${m.source.padEnd(45)} → ${target.padEnd(35)} ${m.confidence}`)
  }
  const missingClients = result.clientMatches.filter(m => m.missingClient)
  const missingProjects = result.clientMatches.filter(m => !m.missingClient && m.missingProject)
  out.push(`  MISSING_CLIENT: ${missingClients.length}, MISSING_PROJECT (клиент есть, проекта нет): ${missingProjects.length}`)
  out.push('')

  out.push('--- 4. РЕДАКТОРЫ ---------------------------------------------------------------')
  for (const m of result.editorMatches) {
    out.push(`    "${m.nameHint}" → ${m.proposedEditorName ?? '— не найден'} (${m.confidence})`)
  }
  out.push('')

  out.push('--- 5. КОНТЕНТ -------------------------------------------------------------')
  const totalSourceRows = result.contentDedupGroups.reduce((s, g) => s + g.rows.length, 0)
  out.push(`  Source rows (кандидаты в контент, до dedup): ${totalSourceRows}`)
  out.push(`  Content candidates после dedup:               ${result.contentDedupGroups.length}`)
  out.push(`  Пропущено служебных строк:                    ${result.skippedServiceRows}`)
  const conf = { HIGH: 0, MEDIUM: 0, LOW: 0 }
  for (const g of result.contentDedupGroups) conf[g.confidence]++
  out.push(`  Confidence: HIGH=${conf.HIGH}  MEDIUM=${conf.MEDIUM}  LOW=${conf.LOW}`)
  out.push('')

  out.push('--- 6. PUBLICATIONS ------------------------------------------------------------')
  const byPlatform = new Map<string, number>()
  for (const p of result.proposedPublications) byPlatform.set(p.platform, (byPlatform.get(p.platform) ?? 0) + 1)
  for (const [platform, count] of byPlatform) out.push(`  ${platform}: ${count}`)
  out.push(`  Всего: ${result.proposedPublications.length}`)
  out.push('')

  out.push('--- 7. METRICS -------------------------------------------------------------')
  const byMetric = new Map<string, number>()
  for (const m of result.proposedMetrics) byMetric.set(m.metricType, (byMetric.get(m.metricType) ?? 0) + 1)
  for (const [t, count] of byMetric) out.push(`  ${t}: ${count}`)
  out.push(`  Всего: ${result.proposedMetrics.length}`)
  out.push('')

  out.push('--- 8. MATERIALS -----------------------------------------------------------')
  const byMaterial = new Map<string, number>()
  for (const m of result.proposedMaterials) byMaterial.set(m.materialType, (byMaterial.get(m.materialType) ?? 0) + 1)
  for (const [t, count] of byMaterial) out.push(`  ${t}: ${count}`)
  out.push(`  Всего: ${result.proposedMaterials.length}`)
  out.push('')

  out.push('--- 9. РЕГУЛЯРНЫЕ ВЫПЛАТЫ (proposed) ----------------------------------------')
  if (result.proposedRecurringPayouts.length === 0) out.push('  предложений нет')
  for (const p of result.proposedRecurringPayouts) {
    out.push(`  · ${p.performerHint} — ${p.clientHint ?? '—'} — ${p.amount}₽ — дни: ${p.daysOfMonth.join(', ')} (подтверждено месяцами: ${p.evidenceMonths.join(', ')})`)
  }
  out.push('')

  out.push('--- 10. EXCEPTIONS (агрегировано) --------------------------------------------')
  const byCategory = new Map<ExceptionCategory, number>()
  for (const e of result.exceptions) byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + 1)
  for (const [cat, count] of byCategory) out.push(`  ${EXCEPTION_LABELS[cat]}: ${count}`)
  out.push(`  Всего: ${result.exceptions.length}`)
  out.push('')

  // ТЗ hardening п.16: не 214 одинаковых строк, а "TOK: 214 rows — project missing".
  const clientMappingByHint = new Map<string, number>()
  for (const e of result.exceptions) {
    if (e.category !== 'NEEDS_CLIENT_MAPPING') continue
    const hint = String(e.context?.clientHint ?? 'неизвестно')
    clientMappingByHint.set(hint, (clientMappingByHint.get(hint) ?? 0) + 1)
  }
  if (clientMappingByHint.size > 0) {
    out.push('  NEEDS_CLIENT_MAPPING — по клиентам:')
    for (const [hint, count] of [...clientMappingByHint.entries()].sort((a, b) => b[1] - a[1])) {
      out.push(`    · ${hint}: ${count} строк`)
    }
    out.push('')
  }

  // ТЗ hardening п.17: уникальные исполнители, не количество строк как единственная цифра.
  const editorMappingByPerformer = new Map<string, number>()
  for (const e of result.exceptions) {
    if (e.category !== 'NEEDS_EDITOR_MAPPING') continue
    const performer = String(e.context?.performer ?? '(не указан в источнике)')
    editorMappingByPerformer.set(performer, (editorMappingByPerformer.get(performer) ?? 0) + 1)
  }
  if (editorMappingByPerformer.size > 0) {
    out.push('  NEEDS_EDITOR_MAPPING — по уникальным исполнителям:')
    for (const [performer, count] of [...editorMappingByPerformer.entries()].sort((a, b) => b[1] - a[1])) {
      out.push(`    · ${performer}: ${count} строк`)
    }
    out.push('')
  }

  // ТЗ hardening п.26: content migration exceptions vs financial linking exceptions.
  const contentMatchNotFound = result.exceptions.filter(e => e.category === 'CONTENT_MATCH_NOT_FOUND')
  if (contentMatchNotFound.length > 0) {
    out.push(`  CONTENT_MATCH_NOT_FOUND — все ${contentMatchNotFound.length} относятся к финансовым таблицам (Phase B), НЕ блокируют Phase A (Content/Publications/Metrics/Materials).`)
    out.push('')
  }

  out.push('--- 11. WARNINGS -------------------------------------------------------------')
  if (result.warnings.length === 0) out.push('  нет')
  for (const w of result.warnings) out.push(`  ! ${w}`)
  out.push('')

  out.push('--- 12. MANIFEST (idempotency) ------------------------------------------------')
  out.push(`  Записей в manifest: ${result.manifest.length}`)
  out.push('')

  out.push(line())
  out.push('DRY RUN ЗАВЕРШЁН — В БД НИЧЕГО НЕ ЗАПИСАНО.')
  out.push(line())
  return out.join('\n')
}

function monthKey(date: string | null): string {
  return date ? date.slice(0, 7) : 'без даты'
}

// ============================================================
// Углублённый отчёт для одного клиента (pre-apply hardening, ТЗ п.29-32) —
// месячная reconciliation, репрезентативный spot-check, отдельный разбор
// Д186, все metric conflicts проекта. Вызывается ТОЛЬКО при --project.
// ============================================================
export function renderProjectDeepDive(project: string, result: DryRunResult, groups: ContentDedupGroup[]): string {
  const out: string[] = []
  out.push('')
  out.push(line('#'))
  out.push(`DEEP DIVE — ${project}`)
  out.push(line('#'))

  // --- Monthly reconciliation (ТЗ п.30) ---
  out.push('')
  out.push('--- MONTHLY RECONCILIATION ----------------------------------------------------')
  const sourceRowsByMonth = new Map<string, number>()
  for (const g of groups) {
    const key = monthKey(g.rows.find(r => r.date)?.date ?? null)
    sourceRowsByMonth.set(key, (sourceRowsByMonth.get(key) ?? 0) + g.rows.length)
  }
  const contentByMonth = new Map<string, ProposedContentItem[]>()
  for (const ci of result.proposedContentItems) {
    const key = monthKey(ci.plannedPublishDate)
    if (!contentByMonth.has(key)) contentByMonth.set(key, [])
    contentByMonth.get(key)!.push(ci)
  }
  const allMonths = [...new Set([...sourceRowsByMonth.keys(), ...contentByMonth.keys()])].sort()
  out.push('  Месяц       Source rows   Proposed ContentItems   Publications   Metrics   Materials')
  for (const month of allMonths) {
    const items = contentByMonth.get(month) ?? []
    const tempIds = new Set(items.map(ci => ci.tempId))
    const pubs = result.proposedPublications.filter(p => tempIds.has(p.contentTempId)).length
    const metrics = result.proposedMetrics.filter(m => tempIds.has(m.contentTempId)).length
    const materials = result.proposedMaterials.filter(m => tempIds.has(m.contentTempId)).length
    out.push(`  ${month.padEnd(11)} ${String(sourceRowsByMonth.get(month) ?? 0).padEnd(13)} ${String(items.length).padEnd(23)} ${String(pubs).padEnd(14)} ${String(metrics).padEnd(9)} ${materials}`)
  }
  out.push('')

  // --- Random/representative spot check (ТЗ п.31) ---
  out.push('--- SPOT CHECK (до 10 репрезентативных единиц) ---------------------------------')
  const spotCheck = pickSpotCheckSample(result.proposedContentItems, 10)
  for (const ci of spotCheck) {
    out.push(...renderContentItemPreview(ci, result))
  }
  out.push('')

  // --- Д186 (эталонный пример, ТЗ п.32) ---
  out.push('--- Д186 (эталонный пример анализа) --------------------------------------------')
  const d186 = result.proposedContentItems.find(ci => ci.legacyCode?.toUpperCase() === 'Д186')
  if (d186) {
    out.push(...renderContentItemPreview(d186, result))
  } else {
    out.push('  Д186 не найден среди предложенных единиц контента для этого клиента.')
  }
  out.push('')

  // --- Metric conflicts (ТЗ п.34) ---
  out.push('--- METRIC CONFLICTS ------------------------------------------------------------')
  const conflicts = result.exceptions.filter(e => e.category === 'METRIC_CONFLICT')
  if (conflicts.length === 0) out.push('  конфликтов нет')
  for (const c of conflicts) {
    out.push(`  · ${c.message}`)
    out.push(`    source: ${c.trace?.file} / ${c.trace?.sheet} строка ${c.trace?.row}`)
  }
  out.push('')

  return out.join('\n')
}

function pickSpotCheckSample(items: ProposedContentItem[], n: number): ProposedContentItem[] {
  if (items.length <= n) return items
  // Простая диверсификация: чередуем месяцы, чтобы не взять 10 подряд из одного.
  const byMonth = new Map<string, ProposedContentItem[]>()
  for (const ci of items) {
    const key = monthKey(ci.plannedPublishDate)
    if (!byMonth.has(key)) byMonth.set(key, [])
    byMonth.get(key)!.push(ci)
  }
  const months = [...byMonth.keys()]
  const sample: ProposedContentItem[] = []
  let i = 0
  while (sample.length < n && months.some(m => byMonth.get(m)!.length > 0)) {
    const month = months[i % months.length]
    const bucket = byMonth.get(month)!
    if (bucket.length > 0) sample.push(bucket.shift()!)
    i++
  }
  return sample
}

function renderContentItemPreview(ci: ProposedContentItem, result: DryRunResult): string[] {
  const out: string[] = []
  const pubs = result.proposedPublications.filter(p => p.contentTempId === ci.tempId)
  const metrics = result.proposedMetrics.filter(m => m.contentTempId === ci.tempId)
  const materials = result.proposedMaterials.filter(m => m.contentTempId === ci.tempId)
  out.push(`  · "${ci.title}"${ci.legacyCode ? ` [${ci.legacyCode}]` : ''} — ${ci.plannedPublishDate ?? 'без даты'} — confidence ${ci.dedupConfidence} — File Code: ${ci.fileCodeStatus}`)
  out.push(`    Источники (${ci.sources.length}): ${ci.sources.map(s => `${s.file}/${s.sheet}:${s.row}`).join('; ')}`)
  out.push(`    → Publications (${pubs.length}): ${pubs.map(p => `${p.platform}${p.url ? '[url]' : ''}`).join(', ') || '—'}`)
  out.push(`    → Metrics (${metrics.length}): ${metrics.map(m => `${m.platform}/${m.metricType}=${m.value}@${m.capturedAt}`).join(', ') || '—'}`)
  out.push(`    → Materials (${materials.length}): ${materials.map(m => m.materialType).join(', ') || '—'}`)
  return out
}
