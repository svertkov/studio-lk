// Предварительный анализ "повышения" исторических визитов до заказов — НИЧЕГО
// не пишет в базу. Запуск: npx tsx scripts/promote-visits-to-orders/dry-run.ts
// (не забыть подгрузить .env.local, см. README.md рядом).

import { prisma } from '@/lib/prisma'
import { buildPlan, summarizePlan } from './core'

function fmtDate(d: Date | null): string {
  if (!d) return '—'
  return d.toISOString().slice(0, 16).replace('T', ' ')
}

function fmtMoney(v: number | null): string {
  return v == null ? '—' : new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(v)
}

async function main() {
  const alreadyPromoted = await prisma.clientVisit.count({ where: { orderId: { not: null } } })
  const plan = await buildPlan()
  const counts = summarizePlan(plan)
  const distinctClients = new Set(plan.rows.map(r => r.order?.clientId).filter(Boolean)).size
  const createRows = plan.rows.filter(r => r.action === 'create')
  const withTimeKnown = createRows.filter(r => r.order!.plannedStartTime != null).length
  const withComment = createRows.filter(r => r.order!.comment != null).length

  console.log('='.repeat(70))
  console.log('DRY RUN — повышение исторических визитов до заказов')
  console.log('='.repeat(70))
  console.log(`Визитов в базе, ещё не повышенных: ${plan.totalVisits}`)
  console.log(`Визитов, уже повышенных ранее (пропускаются автоматически): ${alreadyPromoted}`)
  console.log()
  console.log(`Будет создано новых заказов:              ${counts.create}`)
  console.log(`Пропущено (нет даты вообще):               ${counts.skip_no_date}`)
  console.log(`Дублей заказов:                             0 (структурно исключены — см. ClientVisit.orderId)`)
  console.log()
  console.log(`Клиентов затронуто (уже сопоставлены):      ${distinctClients}`)
  console.log(`Клиентов НЕ сопоставлено:                   0 (все визиты уже привязаны к клиенту с прошлого импорта)`)
  console.log()
  console.log(`Временных интервалов распознано (start/end): ${withTimeKnown} из ${counts.create}`)
  console.log(`Оплат найдено (известна сумма):             ${counts.withAmount} из ${counts.create}`)
  console.log(`Комментариев перенесено:                    ${withComment} из ${counts.create}`)
  console.log(`Акций "−20% первый визит" распознано:        ${counts.promotionDetected}`)
  console.log()
  console.log(`Заказов создастся в статусе "Завершено":     ${counts.completed}`)
  console.log(`Заказов создастся в статусе "Записан" (нужна ручная проверка статуса — есть признак отмены/переноса в тексте): ${counts.booked}`)
  console.log()
  console.log(`Абонемент упомянут в тексте, НЕ создаётся автоматически (нужна ручная проверка): ${counts.needsSubscriptionReview}`)
  console.log('='.repeat(70))

  console.log()
  console.log('-'.repeat(70))
  console.log('Примеры "будет создано" (до 10 штук):')
  console.log('-'.repeat(70))
  for (const r of createRows.slice(0, 10)) {
    const o = r.order!
    console.log(`Визит ${r.visitId}`)
    console.log(`  клиент:        ${o.clientName}`)
    console.log(`  дата:          ${fmtDate(o.plannedStartTime ?? o.createdAt)}`)
    console.log(`  время:         ${o.plannedStartTime ? `${fmtDate(o.plannedStartTime)}–${fmtDate(o.plannedEndTime)}` : 'неизвестно'}`)
    console.log(`  стоимость:     ${fmtMoney(o.preliminaryAmount)} (${o.paymentStatus})`)
    console.log(`  комментарий:   ${o.comment ?? '—'}`)
    console.log(`  акция:         ${o.promotionType ?? '—'}`)
    console.log(`  статус:        ${o.status}${r.needsStatusReview ? '  [нужна ручная проверка]' : ''}`)
    console.log(`  уверенность:   ${r.needsStatusReview || r.needsSubscriptionReview ? 'требует внимания администратора' : 'высокая, готово к apply'}`)
    console.log()
  }

  const reviewRows = plan.rows.filter(r => r.needsStatusReview || r.needsSubscriptionReview)
  if (reviewRows.length > 0) {
    console.log('-'.repeat(70))
    console.log(`Требуют ручной проверки после создания (${reviewRows.length}):`)
    console.log('-'.repeat(70))
    for (const r of reviewRows) {
      const reasons = [
        r.needsStatusReview && 'в комментарии есть признак отмены/переноса — статус оставлен "Записан", не "Завершено"',
        r.needsSubscriptionReview && 'упомянут абонемент в тексте — НЕ связан с реальным абонементом автоматически',
      ].filter(Boolean).join('; ')
      console.log(`Визит ${r.visitId} · ${r.order?.clientName ?? '—'} · ${reasons}`)
    }
    console.log()
  }

  const skipped = plan.rows.filter(r => r.action === 'skip_no_date')
  if (skipped.length > 0) {
    console.log('-'.repeat(70))
    console.log(`Пропущено, нет даты вообще (${skipped.length}):`)
    console.log('-'.repeat(70))
    for (const r of skipped) console.log(`Визит ${r.visitId}`)
    console.log()
  }

  console.log('='.repeat(70))
  console.log(`Итого будет создано заказов при apply: ${counts.create}`)
  console.log(`Из них требуют ручной проверки после создания: ${reviewRows.length}`)
  console.log('='.repeat(70))
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
