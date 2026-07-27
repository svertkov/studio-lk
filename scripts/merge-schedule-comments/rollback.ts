// Откатывает apply.ts — восстанавливает ScheduleEvent.notes по манифесту
// (previousNotes). Запуск:
//   npx tsx scripts/merge-schedule-comments/rollback.ts scripts/merge-schedule-comments/backups/apply-....json
//
// Перед восстановлением каждая запись сверяется по id + текущему notes
// (findFirst) — если notes уже отличается от newNotes из манифеста (админ
// успел отредактировать карточку после миграции), запись пропускается, а не
// затирается вслепую (см. AGENTS.md, п.2 Data Safety).

import { readFileSync } from 'fs'
import { prisma } from '@/lib/prisma'

interface BackupRecord {
  id: string
  previousNotes: string | null
  newNotes: string
}

async function main() {
  const file = process.argv[2]
  if (!file) {
    console.error('Использование: npx tsx scripts/merge-schedule-comments/rollback.ts <путь-к-apply-....json>')
    process.exit(1)
  }

  const data = JSON.parse(readFileSync(file, 'utf-8')) as { records: BackupRecord[] }
  console.log(`В манифесте записей: ${data.records.length}. Восстанавливаю previousNotes...`)

  let restored = 0
  let skipped = 0
  for (const r of data.records) {
    const existing = await prisma.scheduleEvent.findFirst({ where: { id: r.id } })
    if (!existing || existing.notes !== r.newNotes) {
      console.log(`  · пропущено (изменено после миграции или запись удалена): ${r.id}`)
      skipped++
      continue
    }
    await prisma.scheduleEvent.update({ where: { id: existing.id }, data: { notes: r.previousNotes } })
    restored++
  }

  console.log(`Восстановлено записей: ${restored}`)
  if (skipped > 0) console.log(`Пропущено: ${skipped}`)
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
