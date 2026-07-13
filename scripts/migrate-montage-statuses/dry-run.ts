// Предварительный анализ миграции статусов/типа контента для уже
// импортированных исторических проектов монтажа — НИЧЕГО не пишет в базу.
// Запуск:
//   set -a && source .env.local && set +a
//   npx tsx scripts/migrate-montage-statuses/dry-run.ts

import { buildPlan, summarizePlan } from './core'
import { MONTAGE_CONTENT_TYPE_LABELS, MONTAGE_STATUS_LABELS } from '@/lib/montage-model'
import type { MontageContentType, MontageStatus } from '@prisma/client'

async function main() {
  const plan = await buildPlan()
  const summary = summarizePlan(plan)

  console.log('='.repeat(72))
  console.log('DRY RUN — миграция статусов/типа контента исторических проектов монтажа')
  console.log('='.repeat(72))
  console.log(`Всего исторических проектов:                    ${summary.totalRows}`)
  console.log()

  console.log('Распределение ТЕКУЩИХ статусов (только сверка, БЕЗ изменений):')
  for (const [status, count] of Object.entries(summary.statusCounts)) {
    const label = MONTAGE_STATUS_LABELS[status as MontageStatus] ?? status
    console.log(`  · ${status.padEnd(14)} (${label}) — ${count}`)
  }
  console.log('  Все текущие значения уже входят в новый MontageStatus (6 значений) — маппинг не требуется,')
  console.log('  сокращение enum с 14 до 6 значений выполнено прошлым шагом (prisma db push) без потери данных.')
  console.log()

  console.log(`Будет обновлено проектов:                       ${summary.toUpdate} из ${summary.totalRows}`)
  console.log(`  · классификация типа контента:                ${summary.toUpdateContentType}`)
  console.log(`  · бэкафилл "тип дней" срока (CALENDAR):        ${summary.toUpdateTurnaroundDayType}`)
  console.log(`Уже в целевом состоянии (пропускается):          ${summary.alreadyDone}`)
  console.log()

  console.log('Предлагаемое распределение типа контента (по всем проектам, включая уже классифицированные):')
  const allCounts: Partial<Record<MontageContentType, number>> = { ...summary.contentTypeCounts }
  for (const r of plan.rows) {
    if (!r.needsContentType && r.contentType) allCounts[r.contentType] = (allCounts[r.contentType] ?? 0) + 1
  }
  for (const [type, count] of Object.entries(allCounts)) {
    const label = MONTAGE_CONTENT_TYPE_LABELS[type as MontageContentType] ?? type
    console.log(`  · ${type.padEnd(14)} (${label}) — ${count}`)
  }
  console.log()

  console.log(`Проектов без дедлайна (deadlineDate не задан):   ${summary.missingDeadlineCount} (не блокирует — просто нет данных в исходной таблице)`)
  console.log(`Проектов с ОБЕИМИ датами завершения одновременно: ${summary.bothCompletionDatesCount} (completedAt и deliveredAt — информационно, конфликтом не является)`)
  console.log('='.repeat(72))

  const other = plan.rows.filter(r => r.needsContentType && r.proposedContentType === 'OTHER')
  console.log()
  console.log('-'.repeat(72))
  console.log(`Уйдёт в "Прочее" (${other.length}) — исходный текст не теряется, попадает в customContentType:`)
  console.log('-'.repeat(72))
  for (const r of other) console.log(`  · "${r.title}" → "${r.proposedCustomContentType}"`)

  const classified = plan.rows.filter(r => r.needsContentType && r.proposedContentType !== 'OTHER')
  console.log()
  console.log('-'.repeat(72))
  console.log(`Примеры уверенной классификации (первые 15 из ${classified.length}):`)
  console.log('-'.repeat(72))
  for (const r of classified.slice(0, 15)) {
    console.log(`  · "${r.title}" → ${MONTAGE_CONTENT_TYPE_LABELS[r.proposedContentType!]}`)
  }

  const turnaround = plan.rows.filter(r => r.needsTurnaroundDayType)
  if (turnaround.length > 0) {
    console.log()
    console.log('-'.repeat(72))
    console.log(`Бэкафилл "тип дней" срока → CALENDAR (${turnaround.length}):`)
    console.log('-'.repeat(72))
    for (const r of turnaround) console.log(`  · "${r.title}"`)
  }

  console.log()
  console.log('='.repeat(72))
  console.log(`Итого при apply: обновится проектов ${summary.toUpdate} из ${summary.totalRows}.`)
  console.log('Ничего, кроме contentType/customContentType/turnaroundDayType, не меняется — суммы, исполнители,')
  console.log('ссылки, описания, статусы и даты остаются как есть.')
  console.log('='.repeat(72))
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
