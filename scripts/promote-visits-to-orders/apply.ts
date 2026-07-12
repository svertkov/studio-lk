// Создаёt Order + ScheduleEvent для каждого визита со статусом 'create' в
// плане и проставляет ClientVisit.orderId — ТОЛЬКО так подтверждается, что
// визит повышен (см. core.ts: buildPlan запрашивает orderId IS NULL).
// Запуск: npx tsx scripts/promote-visits-to-orders/apply.ts
//
// Идемпотентность: каждый визит обрабатывается в СВОЕЙ отдельной транзакции
// (Order + ScheduleEvent + проставление ClientVisit.orderId атомарны вместе),
// а не одной гигантской транзакцией на все 345 — если скрипт прервётся
// посередине, уже обработанные визиты остаются корректно повышенными и не
// попадут под повторную обработку при следующем запуске (buildPlan их больше
// не найдёт), а необработанные обработаются в следующий раз.
//
// Каждое создание записывается в JSON-манифест (scripts/promote-visits-to-orders/
// backups/apply-<timestamp>.json) — единственный надёжный источник для
// rollback.ts (перечисляет реально созданные id, а не то, что ПЛАНИРОВАЛОСЬ
// создать).

import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { prisma } from '@/lib/prisma'
import { buildPlan } from './core'

interface CreatedRecord {
  visitId: string
  orderId: string
  scheduleEventId: string
}

async function main() {
  const plan = await buildPlan()
  const toCreate = plan.rows.filter(r => r.action === 'create')

  if (toCreate.length === 0) {
    console.log('Нечего применять — нет визитов со статусом "create". Запустите dry-run.ts, чтобы посмотреть текущий план.')
    return
  }

  console.log(`Будет создано заказов: ${toCreate.length}`)
  console.log()

  const created: CreatedRecord[] = []
  let failed = 0

  for (const r of toCreate) {
    const o = r.order!
    try {
      const result = await prisma.$transaction(async tx => {
        const order = await tx.order.create({
          data: {
            status: o.status,
            source: 'OTHER',
            title: o.clientName,
            clientId: o.clientId,
            clientName: o.clientName,
            clientPhone: o.clientPhone,
            clientTelegram: o.clientTelegram,
            clientEmail: o.clientEmail,
            companyName: o.companyName,
            serviceType: o.serviceType,
            room: o.room,
            plannedStartTime: o.plannedStartTime,
            plannedEndTime: o.plannedEndTime,
            durationMinutes: o.durationMinutes,
            preliminaryAmount: o.preliminaryAmount,
            paymentStatus: o.paymentStatus,
            paymentMethod: o.paymentMethod,
            comment: o.comment,
            promotionType: o.promotionType,
            createdAt: o.createdAt,
            statusUpdatedAt: o.statusUpdatedAt,
            completedAt: o.completedAt,
            isArchived: o.isArchived,
            archivedAt: o.archivedAt,
            archiveReason: o.archiveReason,
          },
        })

        const scheduleEvent = await tx.scheduleEvent.create({
          data: {
            orderId: order.id,
            clientId: o.clientId,
            title: o.clientName,
            startAt: o.plannedStartTime,
            endAt: o.plannedEndTime,
            room: o.room,
            format: o.serviceType,
            estimatedPrice: o.preliminaryAmount,
            paymentMethod: o.paymentMethod,
            notes: o.comment,
            promotionType: o.promotionType,
            eventType: 'STUDIO_BOOKING',
          },
        })

        // where.orderId: null в самом условии — как и в apply.ts из
        // backfill-visit-times: даже если этот визит каким-то образом успел
        // получить orderId между buildPlan() и этим моментом (гонка при
        // параллельном запуске), запись просто не совпадёт с условием и
        // ничего не перезапишет, а не создаст рассинхронизацию.
        const updated = await tx.clientVisit.updateMany({
          where: { id: r.visitId, orderId: null },
          data: { orderId: order.id },
        })
        if (updated.count === 0) {
          throw new Error(`ClientVisit ${r.visitId} уже был повышен параллельно — откатываю созданный заказ`)
        }

        return { orderId: order.id, scheduleEventId: scheduleEvent.id }
      })

      created.push({ visitId: r.visitId, orderId: result.orderId, scheduleEventId: result.scheduleEventId })
    } catch (e) {
      failed++
      console.error(`Ошибка для визита ${r.visitId}:`, e)
    }
  }

  const dir = join(__dirname, 'backups')
  mkdirSync(dir, { recursive: true })
  const filename = `apply-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  const filepath = join(dir, filename)
  writeFileSync(filepath, JSON.stringify({
    createdAt: new Date().toISOString(),
    note: 'Заказы, созданные promote-visits-to-orders/apply.ts. Для отката — rollback.ts с этим файлом.',
    count: created.length,
    records: created,
  }, null, 2))

  console.log(`Создано заказов: ${created.length}`)
  if (failed > 0) console.log(`Ошибок: ${failed} (см. вывод выше)`)
  console.log(`Манифест для отката сохранён: ${filepath}`)

  await prisma.auditLog.create({
    data: {
      userId: null,
      action: 'VISITS_PROMOTED_TO_ORDERS',
      entityType: 'ClientVisit',
      entityId: 'bulk',
      metadata: { created: created.length, failed, totalPlanned: toCreate.length, manifestFile: filename },
    },
  })
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
