// Предварительный анализ восстановления времени съёмок — НИЧЕГО не пишет в
// базу. Запуск: npx tsx scripts/backfill-visit-times/dry-run.ts (не забыть
// подгрузить .env.local, см. README.md рядом).

import { buildPlan, summarizePlan } from './core'

const ACTION_LABELS: Record<string, string> = {
  update: 'будет обновлено (время уверенно восстановлено)',
  skip_already_correct: 'уже стоит правильное время — пропущено',
  skip_already_set: 'время уже есть — пропущено',
  skip_no_time_in_sheet: 'в таблице нет диапазона времени — пропущено',
  skip_no_date: 'у визита нет даты — пропущено',
  skip_unmatched: 'строка не сопоставлена ни с одной записью в базе',
  skip_no_visit_data: 'строка не породила визит (как и при обычном импорте)',
  conflict_ambiguous_range: 'КОНФЛИКТ: несколько диапазонов времени в строке',
  conflict_time_differs: 'КОНФЛИКТ: время уже есть, но отличается от таблицы',
  conflict_duration_mismatch: 'КОНФЛИКТ: диапазон не согласуется с сохранённой длительностью',
}

function fmt(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toISOString()
}

async function main() {
  const plan = await buildPlan()
  const counts = summarizePlan(plan)

  console.log('='.repeat(70))
  console.log('DRY RUN — восстановление времени съёмок из Google-таблицы')
  console.log('='.repeat(70))
  console.log(`Всего строк в таблице: ${plan.totalSheetRows}`)
  console.log()
  for (const [action, count] of Object.entries(counts)) {
    if (count === 0) continue
    console.log(`  ${String(count).padStart(4)}  ${ACTION_LABELS[action] ?? action}`)
  }
  console.log()

  console.log('-'.repeat(70))
  console.log('Примеры "будет обновлено" (до 8 штук):')
  console.log('-'.repeat(70))
  for (const r of plan.rows.filter(r => r.action === 'update').slice(0, 8)) {
    console.log(`Строка ${r.sheetRow} · ${r.clientName}`)
    console.log(`  исходное значение:     "${r.rawDuration}"`)
    console.log(`  распознано:            ${r.timeRange?.startHour}:${String(r.timeRange?.startMinute).padStart(2, '0')}–${r.timeRange?.endHour}:${String(r.timeRange?.endMinute).padStart(2, '0')} (${r.timeRange?.rangeDurationHours} ч), уверенность: ${r.timeRange?.confidence}`)
    console.log(`  найдена запись в базе: ${r.matchedVisitId}`)
    console.log(`  новое startAt (UTC):   ${fmt(r.plannedStartAt)}`)
    console.log(`  новое endAt (UTC):     ${fmt(r.plannedEndAt)}`)
    console.log()
  }

  const conflictRows = plan.rows.filter(r => r.action.startsWith('conflict_'))
  if (conflictRows.length > 0) {
    console.log('-'.repeat(70))
    console.log(`Конфликты (${conflictRows.length}) — НЕ будут применены автоматически:`)
    console.log('-'.repeat(70))
    for (const r of conflictRows) {
      console.log(`Строка ${r.sheetRow} · ${r.clientName} · ${ACTION_LABELS[r.action]}`)
      console.log(`  исходное значение: "${r.rawDuration}"`)
      console.log(`  уже сохранено:     startAt=${fmt(r.existingStartAt)}, durationHours=${r.existingDurationHours ?? '—'}`)
      if (r.timeRange) {
        console.log(`  разбор диапазона:  ${r.timeRange.startHour}:${String(r.timeRange.startMinute).padStart(2, '0')}–${r.timeRange.endHour}:${String(r.timeRange.endMinute).padStart(2, '0')} (${r.timeRange.rangeDurationHours} ч)`)
      }
      console.log()
    }
  }

  const unmatchedRows = plan.rows.filter(r => r.action === 'skip_unmatched')
  if (unmatchedRows.length > 0) {
    console.log('-'.repeat(70))
    console.log(`Не сопоставлено с базой (${unmatchedRows.length}) — до 15 примеров:`)
    console.log('-'.repeat(70))
    for (const r of unmatchedRows.slice(0, 15)) {
      console.log(`Строка ${r.sheetRow} · ${r.clientName} · "${r.rawDuration}"`)
    }
    console.log()
  }

  console.log('='.repeat(70))
  console.log(`Итого будет обновлено при apply: ${counts.update}`)
  console.log(`Конфликтов, требующих ручной проверки: ${conflictRows.length}`)
  console.log(`Не сопоставлено: ${counts.skip_unmatched}`)
  console.log('='.repeat(70))
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
