// Миграция уже импортированных исторических проектов монтажа (76 строк, см.
// scripts/import-montage-projects) под новую схему раздела "Монтаж" — БЕЗ
// повторного обращения к исходной Google-таблице, всё нужное уже в базе.
// Общее ядро для dry-run.ts/apply.ts — оба обязаны считать один и тот же план
// по одной и той же логике, иначе apply мог бы применить не то, что показал
// dry-run (тот же принцип, что и в остальных scripts/*).
//
// Три независимых поля, каждое со своей идемпотентной проверкой "уже сделано
// для этой строки" — повторный запуск apply.ts после частичного сбоя не
// портит уже обновлённые строки и не задваивает работу:
//
// 1. Статус — ТОЛЬКО сверка, без изменений. MontageStatus сократили с 14 до
//    6 значений (см. schema.prisma), но реальные исторические проекты всегда
//    использовали только DELIVERED/IN_PROGRESS — оба пережили сокращение без
//    изменений (подтверждено прямым запросом к базе до `prisma db push
//    --accept-data-loss`). Отчёт всё равно явно показывает распределение
//    статусов (ТЗ: "распределение старых статусов, предлагаемые новые").
// 2. Тип контента — classifyMontageContentType(title) для строк с
//    contentType IS NULL, тот же классификатор, что и автосоздание проекта
//    из заказа (ensureMontageProjectForOrder, actions/montage.ts) — не
//    вторая эвристика (AGENTS.md, п.4: не дублировать логику).
// 3. Тип дней срока — если deadlineType = DURATION_DAYS, а turnaroundDayType
//    ещё не задан, бэкафилл 'CALENDAR': именно так исторически считался
//    дедлайн ДО появления рабочих дней в этой доработке (см.
//    computeMontageDeadline — раньше только календарные дни).

import { prisma } from '@/lib/prisma'
import { classifyMontageContentType } from '@/lib/montage-model'
import type { MontageStatus, MontageContentType, MontageTurnaroundDayType, MontageDeadlineType } from '@prisma/client'

export interface SourceRow {
  id: string
  title: string | null
  description: string | null
  status: MontageStatus
  contentType: MontageContentType | null
  customContentType: string | null
  deadlineType: MontageDeadlineType | null
  deadlineDate: Date | null
  turnaroundDayType: MontageTurnaroundDayType | null
  completedAt: Date | null
  deliveredAt: Date | null
}

export interface MigrationRowPlan {
  id: string
  title: string | null
  status: MontageStatus
  contentType: MontageContentType | null
  customContentType: string | null
  proposedContentType: MontageContentType | null
  proposedCustomContentType: string | null
  needsContentType: boolean
  deadlineType: MontageDeadlineType | null
  turnaroundDayType: MontageTurnaroundDayType | null
  needsTurnaroundDayType: boolean
  hasDeadline: boolean
  hasBothCompletionDates: boolean
  action: 'update' | 'skip'
}

export function planRow(row: SourceRow): MigrationRowPlan {
  const needsContentType = row.contentType === null
  const classification = classifyMontageContentType(row.title ?? row.description ?? '')
  const needsTurnaroundDayType = row.deadlineType === 'DURATION_DAYS' && row.turnaroundDayType === null

  return {
    id: row.id,
    title: row.title,
    status: row.status,
    contentType: row.contentType,
    customContentType: row.customContentType,
    proposedContentType: needsContentType ? classification.contentType : row.contentType,
    proposedCustomContentType: needsContentType ? classification.customContentType : row.customContentType,
    needsContentType,
    deadlineType: row.deadlineType,
    turnaroundDayType: row.turnaroundDayType,
    needsTurnaroundDayType,
    hasDeadline: !!row.deadlineDate,
    hasBothCompletionDates: !!(row.completedAt && row.deliveredAt),
    action: (needsContentType || needsTurnaroundDayType) ? 'update' : 'skip',
  }
}

export interface Plan {
  totalRows: number
  rows: MigrationRowPlan[]
  statusCounts: Record<string, number>
}

export async function buildPlan(): Promise<Plan> {
  const rows = await prisma.montageProject.findMany({
    where: { importSource: { not: null } },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true, title: true, description: true, status: true, contentType: true, customContentType: true,
      deadlineType: true, deadlineDate: true, turnaroundDayType: true, completedAt: true, deliveredAt: true,
    },
  })

  const statusCounts: Record<string, number> = {}
  for (const r of rows) statusCounts[r.status] = (statusCounts[r.status] ?? 0) + 1

  return { totalRows: rows.length, rows: rows.map(planRow), statusCounts }
}

export function summarizePlan(plan: Plan) {
  const contentTypeCounts: Partial<Record<MontageContentType, number>> = {}
  let toUpdateContentType = 0
  let toUpdateTurnaroundDayType = 0

  for (const r of plan.rows) {
    if (r.needsContentType && r.proposedContentType) {
      toUpdateContentType++
      contentTypeCounts[r.proposedContentType] = (contentTypeCounts[r.proposedContentType] ?? 0) + 1
    }
    if (r.needsTurnaroundDayType) toUpdateTurnaroundDayType++
  }

  return {
    totalRows: plan.totalRows,
    toUpdate: plan.rows.filter(r => r.action === 'update').length,
    alreadyDone: plan.rows.filter(r => r.action === 'skip').length,
    toUpdateContentType,
    toUpdateTurnaroundDayType,
    contentTypeCounts,
    statusCounts: plan.statusCounts,
    missingDeadlineCount: plan.rows.filter(r => !r.hasDeadline).length,
    bothCompletionDatesCount: plan.rows.filter(r => r.hasBothCompletionDates).length,
  }
}
