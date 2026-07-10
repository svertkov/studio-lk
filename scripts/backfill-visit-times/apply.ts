// Применяет восстановленное время к базе — ТОЛЬКО для строк со статусом
// 'update' (уверенно сопоставлено, время отсутствовало, конфликтов нет).
// Запуск: npx tsx scripts/backfill-visit-times/apply.ts
// Требует, чтобы backup.ts уже был запущен (напоминание ниже, не блокирует).
//
// Идемпотентность: каждое обновление — updateMany с условием startAt: null
// в самом where, а не просто update по id. Это значит, что даже если apply
// запустят повторно (или два раза подряд), строка, которую уже обновили,
// во второй раз просто не попадёт под условие и останется как есть — никакого
// дубля или перезаписи более точного значения менее точным.

import { prisma } from '@/lib/prisma'
import { buildPlan } from './core'

async function main() {
  const plan = await buildPlan()
  const toUpdate = plan.rows.filter(r => r.action === 'update')

  if (toUpdate.length === 0) {
    console.log('Нечего применять — нет строк со статусом "update". Запустите dry-run.ts, чтобы посмотреть текущий план.')
    return
  }

  console.log(`Будет обновлено записей: ${toUpdate.length}`)
  console.log('Не забудьте, что backup.ts должен был отработать до этого запуска.')
  console.log()

  let updated = 0
  let alreadyGone = 0

  for (const r of toUpdate) {
    const result = await prisma.clientVisit.updateMany({
      where: { id: r.matchedVisitId!, startAt: null },
      data: { startAt: new Date(r.plannedStartAt!), endAt: new Date(r.plannedEndAt!) },
    })
    if (result.count > 0) updated++
    else alreadyGone++
  }

  console.log(`Обновлено: ${updated}`)
  if (alreadyGone > 0) {
    console.log(`Пропущено (время уже было выставлено между dry-run и apply, повторный запуск это ожидаемо): ${alreadyGone}`)
  }

  await prisma.auditLog.create({
    data: {
      userId: null,
      action: 'VISIT_TIMES_BACKFILLED',
      entityType: 'ClientVisit',
      entityId: 'bulk',
      metadata: { updated, alreadyGone, totalPlannedForUpdate: toUpdate.length },
    },
  })
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
