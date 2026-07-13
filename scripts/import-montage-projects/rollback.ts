// Откатывает apply.ts: удаляет ТОЛЬКО созданные им MontageProject (по id из
// манифеста, не по эвристике). EditorProfile, созданные при apply, НЕ
// удаляются — к моменту отката администратор мог уже вручную дополнить их
// (телефон, специализация и т.д.), удаление задним числом стёрло бы эту
// правку; профиль без единого проекта безвреден и не показывается нигде как
// ошибка. Запуск:
//   npx tsx scripts/import-montage-projects/rollback.ts scripts/import-montage-projects/backups/apply-....json

import { readFileSync } from 'fs'
import { prisma } from '@/lib/prisma'

interface CreatedRecord {
  sheetRow: number
  montageProjectId: string
  fingerprint: string
}

async function main() {
  const file = process.argv[2]
  if (!file) {
    console.error('Использование: npx tsx scripts/import-montage-projects/rollback.ts <путь-к-apply-....json>')
    process.exit(1)
  }

  const data = JSON.parse(readFileSync(file, 'utf-8')) as { records: CreatedRecord[] }
  console.log(`В манифесте записей: ${data.records.length}. Откатываю...`)

  const result = await prisma.montageProject.deleteMany({
    where: { id: { in: data.records.map(r => r.montageProjectId) } },
  })

  console.log(`Удалено проектов монтажа: ${result.count}`)

  await prisma.auditLog.create({
    data: {
      userId: null,
      action: 'MONTAGE_PROJECTS_IMPORT_ROLLED_BACK',
      entityType: 'MontageProject',
      entityId: 'bulk',
      metadata: { restored: result.count, manifestFile: file },
    },
  })
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
