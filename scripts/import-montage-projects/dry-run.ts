// Предварительный анализ импорта исторических проектов монтажа — НИЧЕГО не
// пишет в базу. Запуск:
//   set -a && source .env.local && set +a
//   npx tsx scripts/import-montage-projects/dry-run.ts

import { buildPlan, collectDistinctEditors } from './core'

function fmtDate(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : '—'
}
function fmtMoney(v: number | null): string {
  return v == null ? '—' : new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(v)
}

async function main() {
  const plan = await buildPlan()
  const create = plan.rows.filter(r => r.action === 'create')
  const alreadyImported = plan.rows.filter(r => r.action === 'skip_already_imported')
  const needsClientReview = create.filter(r => r.needsClientReview)

  const delivered = create.filter(r => r.status === 'DELIVERED')
  const inProgress = create.filter(r => r.status === 'IN_PROGRESS')
  const unknownStatus = create.filter(r => r.status === null)
  const withSourceUrl = create.filter(r => r.sourceUrl)
  const withDeadline = create.filter(r => r.deadlineDate)
  const withClientAmount = create.filter(r => r.clientAmount != null)
  const withEditorAmount = create.filter(r => r.editorAmount != null)
  const negativeProfit = create.filter(r => r.computedProfit != null && r.computedProfit < 0)
  const profitMismatches = create.filter(r => r.profitMismatch)
  const unpaid = create.filter(r => r.clientPaymentStatus !== 'PAID')

  const editors = collectDistinctEditors(create)
  const rawExecutorCount = new Set(create.map(r => r.executorPrimaryRaw).filter(Boolean)).size
  const withExtraExecutors = create.filter(r => r.executorExtraRaw.length > 0)

  const linkableToOrders = 0 // таблица не содержит ссылок на Order/CRM — см. core.ts

  console.log('='.repeat(72))
  console.log('DRY RUN — импорт исторических проектов монтажа из Google-таблицы')
  console.log('='.repeat(72))
  console.log(`Строк найдено (непустых):                    ${plan.totalRows}`)
  console.log(`Диапазон дат поступления:                    ${fmtDate(plan.earliestDate)} — ${fmtDate(plan.latestDate)}`)
  console.log(`Самая ранняя дата (станет "Отчётность с..."): ${fmtDate(plan.earliestDate)}`)
  console.log(`Самая поздняя дата:                           ${fmtDate(plan.latestDate)}`)
  console.log(`Уникальных статусов в таблице:                ${plan.distinctStatuses.join(', ') || '—'}`)
  console.log()
  console.log(`Будет создано проектов монтажа:               ${create.length}`)
  console.log(`  · "Сдан" (DELIVERED):                       ${delivered.length}`)
  console.log(`  · "В работе" (IN_PROGRESS):                 ${inProgress.length}`)
  console.log(`  · нераспознанный статус (не создастся):     ${unknownStatus.length}`)
  console.log(`  · из них БЕЗ привязки к клиенту (метка "!"): ${needsClientReview.length} — созданы с сырым именем из таблицы, администратор довяжет клиента вручную`)
  console.log(`Уже импортировано ранее (пропускается):       ${alreadyImported.length}`)
  console.log(`Дублей проектов:                              0 (структурно исключены — importExternalId уникален)`)
  console.log()
  console.log(`Исполнителей найдено (сырых написаний):       ${rawExecutorCount}`)
  console.log(`Уникальных монтажёров после нормализации:     ${editors.length}`)
  console.log(`Строк с доп. исполнителем в ячейке (/, ,, +): ${withExtraExecutors.length}`)
  console.log()
  console.log(`Со ссылкой на исходники:                      ${withSourceUrl.length} из ${create.length}`)
  console.log(`С дедлайном (срок сдачи):                     ${withDeadline.length} из ${create.length}`)
  console.log(`С суммой клиента:                             ${withClientAmount.length} из ${create.length}`)
  console.log(`С суммой подрядчика:                          ${withEditorAmount.length} из ${create.length}`)
  console.log(`Строк с отрицательной прибылью:                ${negativeProfit.length}`)
  console.log(`Расхождение "Прибыль" в таблице vs расчёт:     ${profitMismatches.length} (информационно, не блокирует импорт)`)
  console.log()
  console.log(`Проектов, привязываемых к существующему заказу: ${linkableToOrders} (таблица не содержит ссылок на Order/CRM — все проекты создаются самостоятельными)`)
  console.log('='.repeat(72))

  console.log()
  console.log('-'.repeat(72))
  console.log(`НЕОПЛАЧЕННЫЕ (статус "В работе" на момент импорта) — ${unpaid.length} шт.:`)
  console.log('-'.repeat(72))
  if (unpaid.length !== 3) {
    console.log(`⚠ Внимание: в постановке задачи упоминались 3 неоплаченных проекта (Rebelgroup, 2× Наталия/Нина),`)
    console.log(`  но по фактическому состоянию таблицы на статус "В работе" сейчас ${unpaid.length}. Показаны все ниже —`)
    console.log(`  правило применяется по реальным данным таблицы (data-driven), а не по хардкоду трёх имён.`)
  }
  for (const r of unpaid) {
    console.log(`Строка ${r.sheetRow} · ${fmtDate(r.sourceReceivedAt)} · ${r.clientRaw}`)
    console.log(`  проект:        ${r.title}`)
    console.log(`  статус:        ${r.statusRaw}`)
    console.log(`  сумма клиента: ${fmtMoney(r.clientAmount)} · сумма подрядчика: ${fmtMoney(r.editorAmount)}`)
    console.log(`  исполнитель:   ${r.executorPrimaryRaw || '—'}`)
    console.log(`  клиент в базе: ${r.clientMatch.clientName ?? '(не сопоставлен, создастся без привязки)'} (${r.clientMatch.kind})`)
    console.log()
  }

  if (needsClientReview.length > 0) {
    console.log('-'.repeat(72))
    console.log(`БЕЗ ПРИВЯЗКИ К КЛИЕНТУ (${needsClientReview.length}) — создаются с меткой "!", клиент довязывается вручную позже:`)
    console.log('-'.repeat(72))
    for (const r of needsClientReview) {
      const suggestion = r.clientMatch.suggestion ? ` · похоже на "${r.clientMatch.suggestion.name}" (не применено автоматически, слишком неуверенно)` : ' · совпадений в базе не найдено вовсе'
      console.log(`Строка ${r.sheetRow} · ${fmtDate(r.sourceReceivedAt)} · заказчик в таблице: "${r.clientRaw}"${suggestion}`)
      console.log(`  проект: ${r.title} · сумма клиента: ${fmtMoney(r.clientAmount)}`)
    }
    console.log()
  }

  if (unknownStatus.length > 0) {
    console.log('-'.repeat(72))
    console.log(`Нераспознанный статус (${unknownStatus.length}) — НЕ будут импортированы, нужна проверка:`)
    console.log('-'.repeat(72))
    for (const r of unknownStatus) console.log(`Строка ${r.sheetRow} · "${r.statusRaw}" · ${r.clientRaw} · ${r.title}`)
    console.log()
  }

  if (profitMismatches.length > 0) {
    console.log('-'.repeat(72))
    console.log(`Расхождение "Прибыль" из таблицы и расчёта (клиент − подрядчик), ${profitMismatches.length} шт. (информационно):`)
    console.log('-'.repeat(72))
    for (const r of profitMismatches) {
      console.log(`Строка ${r.sheetRow} · ${r.clientRaw} · таблица: ${fmtMoney(r.sheetStatedProfit)} · расчёт: ${fmtMoney(r.computedProfit)}`)
    }
    console.log()
  }

  console.log('-'.repeat(72))
  console.log(`Монтажёры, которые будут созданы (${editors.length}):`)
  console.log('-'.repeat(72))
  for (const e of editors) {
    const count = create.filter(r => r.executorKey === e.key).length
    console.log(`${e.displayName} — ${count} ${count === 1 ? 'проект' : 'проекта(ов)'}`)
  }

  console.log()
  console.log('-'.repeat(72))
  console.log('Примеры "будет создано" (первые 5):')
  console.log('-'.repeat(72))
  for (const r of create.slice(0, 5)) {
    console.log(`Строка ${r.sheetRow} · ${r.clientMatch.clientName ?? `${r.clientRaw} (!)`} · ${r.title}`)
    console.log(`  дата поступления: ${fmtDate(r.sourceReceivedAt)} · дедлайн: ${fmtDate(r.deadlineDate)}`)
    console.log(`  статус: ${r.status} · оплата клиента: ${r.clientPaymentStatus} · оплата монтажёру: ${r.editorPaymentStatus}`)
    console.log(`  клиент: ${fmtMoney(r.clientAmount)} · монтажёр: ${fmtMoney(r.editorAmount)} · прибыль: ${fmtMoney(r.computedProfit)}`)
    console.log(`  исполнитель: ${r.executorPrimaryRaw}${r.executorExtraRaw.length > 0 ? ` (+ ${r.executorExtraRaw.join(', ')})` : ''}`)
    console.log()
  }

  console.log('='.repeat(72))
  console.log(`Итого при apply: создастся проектов ${create.length} (из них без привязки к клиенту ${needsClientReview.length}), монтажёров ${editors.length}`)
  console.log(`Пропусков: нераспознанный статус ${unknownStatus.length}, уже импортировано ${alreadyImported.length}`)
  console.log('='.repeat(72))
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
