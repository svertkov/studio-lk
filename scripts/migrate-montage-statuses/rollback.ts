// Откатывает apply.ts обратно к состоянию до миграции — восстанавливает
// contentType/customContentType/turnaroundDayType ровно такими, какими они
// были ДО применения (см. манифест apply.ts, поле "before"). Запуск:
//   npx tsx scripts/migrate-montage-statuses/rollback.ts scripts/migrate-montage-statuses/backups/apply-....json

import { readFileSync } from 'fs'
import { prisma } from '@/lib/prisma'
import type { MontageContentType, MontageTurnaroundDayType } from '@prisma/client'

interface BackupRecord {
  id: string
  title: string | null
  before: { contentType: MontageContentType | null; customContentType: string | null; turnaroundDayType: MontageTurnaroundDayType | null }
}

async function main() {
  const file = process.argv[2]
  if (!file) {
    console.error('Использование: npx tsx scripts/migrate-montage-statuses/rollback.ts <путь-к-apply-....json>')
    process.exit(1)
  }

  const data = JSON.parse(readFileSync(file, 'utf-8')) as { records: BackupRecord[] }
  console.log(`В манифесте записей: ${data.records.length}. Восстанавливаю contentType/customContentType/turnaroundDayType...`)

  let restored = 0
  for (const r of data.records) {
    await prisma.montageProject.update({
      where: { id: r.id },
      data: {
        contentType: r.before.contentType,
        customContentType: r.before.customContentType,
        turnaroundDayType: r.before.turnaroundDayType,
      },
    })
    restored++
  }

  console.log(`Восстановлено записей: ${restored}`)
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
