// Откатывает apply.ts — удаляет строки счёта, созданные этой миграцией
// (см. манифест apply.ts). Document.amount apply.ts не менял, поэтому его не
// нужно восстанавливать отдельно. Запуск:
//   npx tsx scripts/migrate-invoice-line-items/rollback.ts scripts/migrate-invoice-line-items/backups/apply-....json
//
// Перед удалением каждая запись сверяется по id + migratedFromLegacyAmount=true
// (findFirst), а не удаляется по слепому id из файла — если строку успели
// вручную отредактировать через WorkDocumentsSection, она уже не помечена как
// перенесённая и откат её не тронет (см. AGENTS.md, п.2 Data Safety).

import { readFileSync } from 'fs'
import { prisma } from '@/lib/prisma'

interface BackupRecord {
  lineItemId: string
  documentId: string
}

async function main() {
  const file = process.argv[2]
  if (!file) {
    console.error('Использование: npx tsx scripts/migrate-invoice-line-items/rollback.ts <путь-к-apply-....json>')
    process.exit(1)
  }

  const data = JSON.parse(readFileSync(file, 'utf-8')) as { records: BackupRecord[] }
  console.log(`В манифесте записей: ${data.records.length}. Удаляю перенесённые строки счёта...`)

  let removed = 0
  let skipped = 0
  for (const r of data.records) {
    const existing = await prisma.invoiceLineItem.findFirst({ where: { id: r.lineItemId, migratedFromLegacyAmount: true } })
    if (!existing) {
      console.log(`  · пропущено (уже удалено или изменено вручную): ${r.lineItemId}`)
      skipped++
      continue
    }
    await prisma.invoiceLineItem.delete({ where: { id: existing.id } })
    removed++
  }

  console.log(`Удалено строк: ${removed}`)
  if (skipped > 0) console.log(`Пропущено: ${skipped}`)
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
