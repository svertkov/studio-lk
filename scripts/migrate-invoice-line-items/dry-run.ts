// Предварительный анализ миграции строк счёта для старых однострочных
// счетов (Document.type=INVOICE, ещё без InvoiceLineItem) — НИЧЕГО не пишет
// в базу. Запуск:
//   set -a && source .env.local && set +a
//   npx tsx scripts/migrate-invoice-line-items/dry-run.ts

import { buildPlan, summarizePlan } from './core'

function formatMoney(v: number | null): string {
  if (v == null) return '—'
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(v)
}

async function main() {
  const plan = await buildPlan()
  const summary = summarizePlan(plan)

  console.log('='.repeat(72))
  console.log('DRY RUN — миграция строк счёта для старых однострочных счетов')
  console.log('='.repeat(72))
  console.log(`Всего счетов (type=INVOICE):                     ${summary.totalRows}`)
  console.log(`Уже имеют строки (пропускается):                 ${summary.alreadyHasLineItems}`)
  console.log(`Без суммы — нечего переносить (пропускается):    ${summary.noAmount}`)
  console.log(`Будет создано строк:                             ${summary.toCreate}`)
  console.log('='.repeat(72))

  const toCreate = plan.rows.filter(r => r.action === 'create')
  console.log()
  console.log('-'.repeat(72))
  console.log(`Примеры (первые 20 из ${toCreate.length}):`)
  console.log('-'.repeat(72))
  for (const r of toCreate.slice(0, 20)) {
    console.log(`  · ${r.id} — "${r.proposedDescription}" × 1 = ${formatMoney(r.amount)}`)
  }

  console.log()
  console.log('='.repeat(72))
  console.log('Document.amount НЕ меняется — он и так уже верный. Создаётся только')
  console.log('объясняющая строка с migratedFromLegacyAmount=true, чтобы отличить')
  console.log('перенесённые строки от введённых вручную построчно.')
  console.log('='.repeat(72))
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
