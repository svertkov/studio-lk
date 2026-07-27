// Одноразовая миграция под доработку финансового блока карточки заказа:
// раньше "причина" ручного переопределения прибыли жила в
// Order.netProfitOverrideReason (заполнялась только через старый модальный
// диалог NetProfitOverrideDialog, удалён), теперь у заказа есть отдельное
// самостоятельное поле Order.financeComment ("Комментарий к прибыли"),
// которое не привязано к акту переопределения и не сбрасывается автоматически.
// Эта миграция переносит уже накопленный текст reason в financeComment для
// существующих заказов, где комментарий ещё пуст.
//
// netProfitManualAmount (само число прибыли) НЕ трогаем и не мигрируем —
// оно уже хранится в правильном месте и с правильной семантикой (null =
// "не указана", число = введённое администратором значение) без каких-либо
// изменений от этой доработки.
//
// Идемпотентно: buildPlan() каждый раз считает план заново от текущего
// состояния базы — заказы, где financeComment уже заполнен (этой миграцией
// или вручную), при повторном запуске попадают в skip.

import { prisma } from '@/lib/prisma'

export interface SourceRow {
  id: string
  netProfitOverrideReason: string | null
  financeComment: string | null
}

export type SkipReason = 'no_reason' | 'comment_already_filled'

export interface MigrationRowPlan {
  id: string
  previousFinanceComment: string | null
  proposedFinanceComment: string
  action: 'copy_reason' | 'skip'
  skipReason: SkipReason | null
}

export function planRow(row: SourceRow): MigrationRowPlan {
  const reason = (row.netProfitOverrideReason ?? '').trim()
  const comment = (row.financeComment ?? '').trim()

  if (!reason) {
    return { id: row.id, previousFinanceComment: row.financeComment, proposedFinanceComment: row.financeComment ?? '', action: 'skip', skipReason: 'no_reason' }
  }
  if (comment) {
    return { id: row.id, previousFinanceComment: row.financeComment, proposedFinanceComment: row.financeComment ?? '', action: 'skip', skipReason: 'comment_already_filled' }
  }
  return { id: row.id, previousFinanceComment: row.financeComment, proposedFinanceComment: reason, action: 'copy_reason', skipReason: null }
}

export interface Plan {
  totalRows: number
  rows: MigrationRowPlan[]
}

export async function buildPlan(): Promise<Plan> {
  const rows = await prisma.order.findMany({
    where: { netProfitOverrideReason: { not: null } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, netProfitOverrideReason: true, financeComment: true },
  })
  return { totalRows: rows.length, rows: rows.map(planRow) }
}

export function summarizePlan(plan: Plan) {
  return {
    totalRows: plan.totalRows,
    toCopy: plan.rows.filter(r => r.action === 'copy_reason').length,
    skippedNoReason: plan.rows.filter(r => r.skipReason === 'no_reason').length,
    skippedAlreadyFilled: plan.rows.filter(r => r.skipReason === 'comment_already_filled').length,
  }
}
