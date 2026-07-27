// Предварительный анализ объединения description/notes для ScheduleEvent —
// НИЧЕГО не пишет в базу. Запуск:
//   set -a && source .env.local && set +a
//   npx tsx scripts/merge-schedule-comments/dry-run.ts

import { buildPlan, summarizePlan } from './core'

function preview(text: string, max = 60): string {
  const flat = text.replace(/\n/g, ' ⏎ ')
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

async function main() {
  const plan = await buildPlan()
  const summary = summarizePlan(plan)

  console.log('='.repeat(72))
  console.log('DRY RUN — объединение description (Google Calendar) в notes (комментарий)')
  console.log('='.repeat(72))
  console.log(`Всего записей ScheduleEvent:                     ${summary.totalRows}`)
  console.log(`notes := description (notes был пуст):           ${summary.setFromDescription}`)
  console.log(`notes := notes + "\\n\\n" + description (оба заполнены, различаются): ${summary.appendDescription}`)
  console.log(`Пропущено — description пуст:                    ${summary.skippedNoDescription}`)
  console.log(`Пропущено — уже объединено (description ⊂ notes):${summary.skippedAlreadyMerged}`)
  console.log(`Пропущено — тексты идентичны:                    ${summary.skippedIdentical}`)
  console.log('='.repeat(72))

  const toChange = plan.rows.filter(r => r.action !== 'skip')
  console.log()
  console.log('-'.repeat(72))
  console.log(`Примеры изменений (первые 20 из ${toChange.length}):`)
  console.log('-'.repeat(72))
  for (const r of toChange.slice(0, 20)) {
    console.log(`  · ${r.id} [${r.action}]`)
    console.log(`      было:  ${preview(r.previousNotes ?? '(пусто)')}`)
    console.log(`      стало: ${preview(r.proposedNotes)}`)
  }

  console.log()
  console.log('='.repeat(72))
  console.log('description НЕ удаляется этим скриптом (остаётся техническим снэпшотом).')
  console.log('Запустите apply.ts, чтобы применить изменения.')
  console.log('='.repeat(72))
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
