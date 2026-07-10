// Откатывает apply.ts обратно к состоянию из бэкапа. Запуск:
//   npx tsx scripts/backfill-visit-times/rollback.ts scripts/backfill-visit-times/backups/backup-....json
// Восстанавливает startAt/endAt/durationHours визитов из файла бэкапа ровно
// такими, какими они были до apply (только для id, перечисленных в бэкапе).

import { readFileSync } from 'fs'
import { prisma } from '@/lib/prisma'

interface BackupVisit {
  id: string
  date: string | null
  startAt: string | null
  endAt: string | null
  durationHours: number | null
}

async function main() {
  const file = process.argv[2]
  if (!file) {
    console.error('Использование: npx tsx scripts/backfill-visit-times/rollback.ts <путь-к-backup.json>')
    process.exit(1)
  }

  const data = JSON.parse(readFileSync(file, 'utf-8')) as { visits: BackupVisit[] }
  console.log(`В бэкапе записей: ${data.visits.length}. Восстанавливаю startAt/endAt...`)

  let restored = 0
  for (const v of data.visits) {
    await prisma.clientVisit.update({
      where: { id: v.id },
      data: { startAt: v.startAt ? new Date(v.startAt) : null, endAt: v.endAt ? new Date(v.endAt) : null },
    })
    restored++
  }

  console.log(`Восстановлено записей: ${restored}`)
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
