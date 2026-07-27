// Предварительный анализ переноса netProfitOverrideReason → financeComment —
// НИЧЕГО не пишет в базу. Запуск:
//   set -a && source .env.local && set +a
//   npx tsx scripts/backfill-finance-comment/dry-run.ts

import { buildPlan, summarizePlan } from './core'

async function main() {
  const plan = await buildPlan()
  const summary = summarizePlan(plan)

  console.log('='.repeat(72))
  console.log('DRY RUN — перенос netProfitOverrideReason в Order.financeComment')
  console.log('='.repeat(72))
  console.log(`Заказов с непустым netProfitOverrideReason: ${summary.totalRows}`)
  console.log(`Будет перенесено (financeComment пуст):     ${summary.toCopy}`)
  console.log(`Пропущено — reason пуст:                    ${summary.skippedNoReason}`)
  console.log(`Пропущено — financeComment уже заполнен:    ${summary.skippedAlreadyFilled}`)
  console.log('='.repeat(72))

  const toCopy = plan.rows.filter(r => r.action === 'copy_reason')
  for (const r of toCopy) {
    console.log(`  · ${r.id} → financeComment = ${JSON.stringify(r.proposedFinanceComment)}`)
  }

  console.log()
  console.log('netProfitOverrideReason НЕ удаляется/не очищается этим скриптом.')
  console.log('Запустите apply.ts, чтобы применить изменения.')
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
