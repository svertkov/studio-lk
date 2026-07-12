// Откатывает apply.ts: удаляет созданные Order/ScheduleEvent и возвращает
// ClientVisit.orderId в null — используя ТОЛЬКО id из манифеста apply.ts
// (не эвристику), поэтому откатывает ровно то, что было создано, и ничего
// больше. Запуск:
//   npx tsx scripts/promote-visits-to-orders/rollback.ts scripts/promote-visits-to-orders/backups/apply-....json

import { readFileSync } from 'fs'
import { prisma } from '@/lib/prisma'

interface CreatedRecord {
  visitId: string
  orderId: string
  scheduleEventId: string
}

async function main() {
  const file = process.argv[2]
  if (!file) {
    console.error('Использование: npx tsx scripts/promote-visits-to-orders/rollback.ts <путь-к-apply-....json>')
    process.exit(1)
  }

  const data = JSON.parse(readFileSync(file, 'utf-8')) as { records: CreatedRecord[] }
  console.log(`В манифесте записей: ${data.records.length}. Откатываю...`)

  let restored = 0
  for (const r of data.records) {
    await prisma.$transaction(async tx => {
      // ClientVisit сначала — иначе внешний ключ ClientVisit.orderId
      // указывал бы на уже удалённый Order на короткое время внутри транзакции.
      await tx.clientVisit.updateMany({ where: { id: r.visitId, orderId: r.orderId }, data: { orderId: null } })
      await tx.scheduleEvent.deleteMany({ where: { id: r.scheduleEventId, orderId: r.orderId } })
      await tx.order.deleteMany({ where: { id: r.orderId } })
    })
    restored++
  }

  console.log(`Откачено записей: ${restored}`)

  await prisma.auditLog.create({
    data: {
      userId: null,
      action: 'VISITS_PROMOTION_ROLLED_BACK',
      entityType: 'ClientVisit',
      entityId: 'bulk',
      metadata: { restored, manifestFile: file },
    },
  })
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
