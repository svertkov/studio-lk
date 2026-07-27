// Применяет план из core.ts. Запуск:
//   set -a && source .env.local && set +a
//   npx tsx scripts/backfill-finance-comment/apply.ts
//
// Перед реальным запуском на проде — npm run db:backup / gh workflow run
// db-backup.yml (см. AGENTS.md, Data Safety), это единственная база (dev=prod).

import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { prisma } from '@/lib/prisma'
import { buildPlan } from './core'

interface ChangedRecord {
  id: string
  previousFinanceComment: string | null
  newFinanceComment: string
}

async function main() {
  const plan = await buildPlan()
  const toCopy = plan.rows.filter(r => r.action === 'copy_reason')

  if (toCopy.length === 0) {
    console.log('Нечего применять — все заказы уже перенесены. Запустите dry-run.ts для отчёта.')
    return
  }

  console.log(`Будет изменено заказов: ${toCopy.length}`)

  const changed: ChangedRecord[] = []
  for (const r of toCopy) {
    // findFirst перед update — сверяем, что financeComment всё ещё пуст на
    // момент записи (защита от гонки, см. AGENTS.md, Data Safety, п.2).
    const existing = await prisma.order.findFirst({ where: { id: r.id } })
    if (!existing || existing.financeComment !== r.previousFinanceComment) {
      console.log(`  · пропущено (изменилось за время миграции): ${r.id}`)
      continue
    }
    await prisma.order.update({ where: { id: existing.id }, data: { financeComment: r.proposedFinanceComment } })
    changed.push({ id: r.id, previousFinanceComment: r.previousFinanceComment, newFinanceComment: r.proposedFinanceComment })
  }

  const dir = join(__dirname, 'backups')
  mkdirSync(dir, { recursive: true })
  const filepath = join(dir, `apply-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  writeFileSync(filepath, JSON.stringify({
    createdAt: new Date().toISOString(),
    note: 'Order.financeComment, заполненные backfill-finance-comment/apply.ts из netProfitOverrideReason. Для отката — rollback.ts с этим файлом.',
    count: changed.length,
    records: changed,
  }, null, 2))

  console.log(`Изменено заказов: ${changed.length}`)
  console.log(`Манифест для отката сохранён: ${filepath}`)
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
