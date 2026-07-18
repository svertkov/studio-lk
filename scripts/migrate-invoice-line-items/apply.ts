// Создаёт ровно одну строку InvoiceLineItem для каждого старого счёта
// (Document.type=INVOICE) без строк и с заполненной суммой: description =
// serviceDescription или запасной текст, quantity=1, unitPrice=текущий
// amount, vatRate=NOT_APPLICABLE, migratedFromLegacyAmount=true.
// Document.amount НЕ трогается — он и так уже верный, строка лишь объясняет
// задним числом уже существующую сумму. Запуск:
//   set -a && source .env.local && set +a
//   npx tsx scripts/migrate-invoice-line-items/apply.ts
//
// Идемпотентность: buildPlan() строит план заново от текущего состояния базы
// (lineItemsCount > 0 → skip) — уже перенесённые счета при повторном запуске
// просто не попадают в план как 'create'.
//
// Перед реальным запуском на проде — npm run db:backup (см. AGENTS.md, Data
// Safety and Audit Integrity), это единственная база (dev=prod).

import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { prisma } from '@/lib/prisma'
import { buildPlan } from './core'

interface CreatedRecord {
  lineItemId: string
  documentId: string
  description: string
  unitPrice: number
}

async function main() {
  const plan = await buildPlan()
  const toCreate = plan.rows.filter(r => r.action === 'create')

  if (toCreate.length === 0) {
    console.log('Нечего применять — нет старых счетов без строк и с заполненной суммой. Запустите dry-run.ts для отчёта.')
    return
  }

  console.log(`Будет создано строк: ${toCreate.length}`)
  console.log()

  const created: CreatedRecord[] = []
  let failed = 0

  for (const r of toCreate) {
    try {
      const lineItem = await prisma.invoiceLineItem.create({
        data: {
          documentId: r.id,
          sortOrder: 0,
          description: r.proposedDescription,
          quantity: 1,
          unit: 'SERVICE',
          unitPrice: r.amount as number,
          vatRate: 'NOT_APPLICABLE',
          migratedFromLegacyAmount: true,
        },
      })
      created.push({ lineItemId: lineItem.id, documentId: r.id, description: r.proposedDescription, unitPrice: r.amount as number })
    } catch (e) {
      failed++
      console.error(`Ошибка для счёта ${r.id}:`, e)
    }
  }

  const dir = join(__dirname, 'backups')
  mkdirSync(dir, { recursive: true })
  const filename = `apply-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  const filepath = join(dir, filename)
  writeFileSync(filepath, JSON.stringify({
    createdAt: new Date().toISOString(),
    note: 'Строки счёта (InvoiceLineItem), созданные migrate-invoice-line-items/apply.ts из старых однострочных счетов. Document.amount не менялся. Для отката — rollback.ts с этим файлом.',
    count: created.length,
    records: created,
  }, null, 2))

  console.log(`Создано строк: ${created.length}`)
  if (failed > 0) console.log(`Ошибок: ${failed} (см. вывод выше)`)
  console.log(`Манифест для отката сохранён: ${filepath}`)

  await prisma.auditLog.create({
    data: {
      userId: null,
      action: 'INVOICE_LINE_ITEMS_MIGRATED',
      entityType: 'Document',
      entityId: 'bulk',
      metadata: { created: created.length, failed, totalPlanned: toCreate.length },
    },
  })
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
