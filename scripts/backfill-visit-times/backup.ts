// Резервная копия ЗАТРАГИВАЕМЫХ визитов перед apply — экспорт в JSON.
// Запуск: npx tsx scripts/backfill-visit-times/backup.ts
// Пишет файл scripts/backfill-visit-times/backups/backup-<ts>.json со списком
// id визитов, которые apply собирается обновить, и их текущим (старым)
// состоянием startAt/endAt/durationHours — этого достаточно для отката,
// так как apply трогает ТОЛЬКО startAt/endAt и ТОЛЬКО там, где они были null.

import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { prisma } from '@/lib/prisma'
import { buildPlan } from './core'

async function main() {
  const plan = await buildPlan()
  const toUpdateIds = plan.rows.filter(r => r.action === 'update').map(r => r.matchedVisitId!).filter(Boolean)

  if (toUpdateIds.length === 0) {
    console.log('Нечего резервировать — нет строк со статусом "update".')
    return
  }

  const visits = await prisma.clientVisit.findMany({
    where: { id: { in: toUpdateIds } },
    select: { id: true, clientId: true, date: true, startAt: true, endAt: true, durationHours: true },
  })

  const dir = join(__dirname, 'backups')
  mkdirSync(dir, { recursive: true })
  const filename = `backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  const filepath = join(dir, filename)

  writeFileSync(filepath, JSON.stringify({
    createdAt: new Date().toISOString(),
    note: 'Состояние ClientVisit ДО применения backfill-visit-times/apply.ts. Для отката — см. rollback.ts.',
    count: visits.length,
    visits,
  }, null, 2))

  console.log(`Резервная копия сохранена: ${filepath}`)
  console.log(`Записей в бэкапе: ${visits.length}`)
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
