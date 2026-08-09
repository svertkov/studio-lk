// Человекочитаемый рендер DryRunResult (ТЗ п.29) — только форматирование,
// никакой бизнес-логики.

import type { DryRunResult, ExceptionCategory } from './types'

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

  out.push('--- 10. EXCEPTIONS ----------------------------------------------------------')
  const byCategory = new Map<ExceptionCategory, number>()
  for (const e of result.exceptions) byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + 1)
  for (const [cat, count] of byCategory) out.push(`  ${EXCEPTION_LABELS[cat]}: ${count}`)
  out.push(`  Всего: ${result.exceptions.length}`)
  out.push('')

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
