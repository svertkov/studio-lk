// Откатывает apply.ts. Запуск:
//   npx tsx scripts/backfill-finance-comment/rollback.ts scripts/backfill-finance-comment/backups/apply-....json

import { readFileSync } from 'fs'
import { prisma } from '@/lib/prisma'

interface BackupRecord {
  id: string
  previousFinanceComment: string | null
  newFinanceComment: string
}

async function main() {
  const file = process.argv[2]
  if (!file) {
    console.error('Использование: npx tsx scripts/backfill-finance-comment/rollback.ts <путь-к-apply-....json>')
    process.exit(1)
  }

  const data = JSON.parse(readFileSync(file, 'utf-8')) as { records: BackupRecord[] }
  let restored = 0
  let skipped = 0
  for (const r of data.records) {
    const existing = await prisma.order.findFirst({ where: { id: r.id } })
    if (!existing || existing.financeComment !== r.newFinanceComment) {
      console.log(`  · пропущено (изменено после миграции): ${r.id}`)
      skipped++
      continue
    }
    await prisma.order.update({ where: { id: existing.id }, data: { financeComment: r.previousFinanceComment } })
    restored++
  }
  console.log(`Восстановлено: ${restored}, пропущено: ${skipped}`)
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
