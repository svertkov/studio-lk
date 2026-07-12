// "Повышение" исторических визитов (ClientVisit, из старого импорта Google-
// таблицы) до полноценных заказов (Order + ScheduleEvent), чтобы раздел
// "Заказы" показывал полную историю студии, а не только заказы, заведённые
// после запуска раздела (см. ORDERS_AUTO_IMPORT_LAUNCH_DATE, order-model.ts).
//
// Источник данных — то, что УЖЕ есть в базе (ClientVisit), Google-таблица
// повторно не запрашивается (решение владельца, 2026-07-12: 345 визитов уже
// были аккуратно импортированы и сопоставлены с клиентами в прошлый раз).
//
// Идемпотентность: buildPlan() запрашивает ТОЛЬКО ClientVisit с orderId IS
// NULL — уже повышенные визиты сюда просто не попадают при повторном запуске,
// без риска задвоить заказ.
//
// Общее ядро для dry-run.ts и apply.ts — оба обязаны считать один и тот же
// план по одной и той же логике (см. buildVisitPromotionPlan,
// src/lib/visit-promotion-model.ts), иначе apply мог бы создать не то, что
// показал dry-run.

import { prisma } from '@/lib/prisma'
import { buildVisitPromotionPlan, type VisitPromotionPlan } from '@/lib/visit-promotion-model'

export interface Plan {
  totalVisits: number
  rows: VisitPromotionPlan[]
}

export async function buildPlan(now: Date = new Date()): Promise<Plan> {
  const visits = await prisma.clientVisit.findMany({
    where: { orderId: null },
    orderBy: { date: 'asc' },
    include: {
      client: { select: { name: true, phone: true, telegram: true, email: true, companyName: true } },
    },
  })

  const rows = visits.map(v => buildVisitPromotionPlan(
    {
      id: v.id, clientId: v.clientId, date: v.date, startAt: v.startAt, endAt: v.endAt,
      room: v.room, format: v.format, durationHours: v.durationHours, grossAmount: v.grossAmount,
      comment: v.comment,
    },
    {
      name: v.client.name, phone: v.client.phone, telegram: v.client.telegram,
      email: v.client.email, companyName: v.client.companyName,
    },
    now,
  ))

  return { totalVisits: visits.length, rows }
}

export function summarizePlan(plan: Plan) {
  const counts = {
    create: 0,
    skip_no_date: 0,
    promotionDetected: 0,
    needsStatusReview: 0,
    needsSubscriptionReview: 0,
    withAmount: 0,
    withoutAmount: 0,
    completed: 0,
    booked: 0,
  }
  for (const r of plan.rows) {
    counts[r.action]++
    if (r.promotionDetected) counts.promotionDetected++
    if (r.needsStatusReview) counts.needsStatusReview++
    if (r.needsSubscriptionReview) counts.needsSubscriptionReview++
    if (r.order) {
      if (r.order.preliminaryAmount != null) counts.withAmount++
      else counts.withoutAmount++
      if (r.order.status === 'COMPLETED') counts.completed++
      if (r.order.status === 'BOOKED') counts.booked++
    }
  }
  return counts
}
