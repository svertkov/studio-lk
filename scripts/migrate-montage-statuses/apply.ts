// Применяет план из core.ts: classifyMontageContentType для проектов с
// contentType IS NULL + бэкафилл turnaroundDayType='CALENDAR' там, где
// deadlineType=DURATION_DAYS и тип дней ещё не задан. Статус НЕ меняется —
// см. комментарий в core.ts (все текущие значения уже валидны в новом enum).
// Запуск:
//   set -a && source .env.local && set +a
//   npx tsx scripts/migrate-montage-statuses/apply.ts
//
// Идемпотентность: buildPlan() строит план заново от текущего состояния базы
// (contentType/turnaroundDayType IS NULL) — уже обновлённые строки при
// повторном запуске просто не попадают в план как 'update'.

import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { prisma } from '@/lib/prisma'
import { buildPlan } from './core'
import type { MontageContentType, MontageTurnaroundDayType } from '@prisma/client'

interface UpdatedRecord {
  id: string
  title: string | null
  before: { contentType: MontageContentType | null; customContentType: string | null; turnaroundDayType: MontageTurnaroundDayType | null }
  after: { contentType: MontageContentType | null; customContentType: string | null; turnaroundDayType: MontageTurnaroundDayType | null }
}

async function main() {
  const plan = await buildPlan()
  const toUpdate = plan.rows.filter(r => r.action === 'update')

  if (toUpdate.length === 0) {
    console.log('Нечего применять — нет строк со статусом "update". Запустите dry-run.ts, чтобы посмотреть текущий план.')
    return
  }

  console.log(`Будет обновлено проектов: ${toUpdate.length}`)
  console.log()

  const updated: UpdatedRecord[] = []
  let failed = 0

  for (const r of toUpdate) {
    try {
      await prisma.montageProject.update({
        where: { id: r.id },
        data: {
          ...(r.needsContentType ? { contentType: r.proposedContentType, customContentType: r.proposedCustomContentType } : {}),
          ...(r.needsTurnaroundDayType ? { turnaroundDayType: 'CALENDAR' as const } : {}),
        },
      })

      updated.push({
        id: r.id,
        title: r.title,
        before: { contentType: r.contentType, customContentType: r.customContentType, turnaroundDayType: r.turnaroundDayType },
        after: {
          contentType: r.needsContentType ? r.proposedContentType : r.contentType,
          customContentType: r.needsContentType ? r.proposedCustomContentType : r.customContentType,
          turnaroundDayType: r.needsTurnaroundDayType ? 'CALENDAR' : r.turnaroundDayType,
        },
      })
    } catch (e) {
      failed++
      console.error(`Ошибка для проекта ${r.id} ("${r.title}"):`, e)
    }
  }

  const dir = join(__dirname, 'backups')
  mkdirSync(dir, { recursive: true })
  const filename = `apply-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  const filepath = join(dir, filename)
  writeFileSync(filepath, JSON.stringify({
    createdAt: new Date().toISOString(),
    note: 'Проекты монтажа, изменённые migrate-montage-statuses/apply.ts (contentType/customContentType/turnaroundDayType). Для отката — rollback.ts с этим файлом.',
    count: updated.length,
    records: updated,
  }, null, 2))

  console.log(`Обновлено: ${updated.length}`)
  if (failed > 0) console.log(`Ошибок: ${failed} (см. вывод выше)`)
  console.log(`Манифест для отката сохранён: ${filepath}`)

  await prisma.auditLog.create({
    data: {
      userId: null,
      action: 'MONTAGE_PROJECTS_MIGRATED',
      entityType: 'MontageProject',
      entityId: 'bulk',
      metadata: { updated: updated.length, failed, totalPlanned: toUpdate.length },
    },
  })
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
