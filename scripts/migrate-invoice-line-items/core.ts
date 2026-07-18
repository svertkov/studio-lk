// Миграция старых однострочных счетов (Document.type=INVOICE, ещё без
// InvoiceLineItem) под новую модель "строки счёта" (см. доработку карточки
// заказа: формат/финансы/автосохранение/строки счёта). Для каждого такого
// счёта создаёт РОВНО одну строку, переносящую уже существующие
// amount/serviceDescription — ничего не пересчитывает и не угадывает состав
// старого счёта построчно (это невозможно восстановить из одного числа).
//
// Document.amount НЕ трогается этим скриптом — он и так уже верный (это
// исходное число, из которого создаётся единственная строка). Строка лишь
// объясняет задним числом, откуда взялась уже существующая сумма —
// migratedFromLegacyAmount=true отличает её от строк, введённых вручную.
//
// Идемпотентно: buildPlan() каждый раз считает план заново от текущего
// состояния базы (lineItemsCount > 0 → skip) — счета, уже получившие строку
// (в первом запуске или вручную через WorkDocumentsSection), не попадают в
// план как 'create' при повторном запуске.

import { prisma } from '@/lib/prisma'

export const FALLBACK_DESCRIPTION = 'Услуга (перенесено из старой формы счёта)'

export interface SourceRow {
  id: string
  amount: number | null
  serviceDescription: string | null
  lineItemsCount: number
}

export interface MigrationRowPlan {
  id: string
  amount: number | null
  serviceDescription: string | null
  proposedDescription: string
  action: 'create' | 'skip'
  skipReason: 'has_line_items' | 'no_amount' | null
}

export function planRow(row: SourceRow): MigrationRowPlan {
  // У счёта уже есть строки (из прошлого запуска или введены вручную через
  // UI) — приоритет над проверкой суммы, повторный перенос не нужен и был бы
  // задвоением, даже если у счёта почему-то одновременно нет amount.
  if (row.lineItemsCount > 0) {
    return { id: row.id, amount: row.amount, serviceDescription: row.serviceDescription, proposedDescription: '', action: 'skip', skipReason: 'has_line_items' }
  }
  if (row.amount == null) {
    return { id: row.id, amount: row.amount, serviceDescription: row.serviceDescription, proposedDescription: '', action: 'skip', skipReason: 'no_amount' }
  }
  return {
    id: row.id,
    amount: row.amount,
    serviceDescription: row.serviceDescription,
    proposedDescription: row.serviceDescription?.trim() || FALLBACK_DESCRIPTION,
    action: 'create',
    skipReason: null,
  }
}

export interface Plan {
  totalRows: number
  rows: MigrationRowPlan[]
}

export async function buildPlan(): Promise<Plan> {
  const rows = await prisma.document.findMany({
    where: { type: 'INVOICE' },
    orderBy: { createdAt: 'asc' },
    select: { id: true, amount: true, serviceDescription: true, _count: { select: { lineItems: true } } },
  })
  return {
    totalRows: rows.length,
    rows: rows.map(r => planRow({ id: r.id, amount: r.amount, serviceDescription: r.serviceDescription, lineItemsCount: r._count.lineItems })),
  }
}

export function summarizePlan(plan: Plan) {
  return {
    totalRows: plan.totalRows,
    toCreate: plan.rows.filter(r => r.action === 'create').length,
    alreadyHasLineItems: plan.rows.filter(r => r.skipReason === 'has_line_items').length,
    noAmount: plan.rows.filter(r => r.skipReason === 'no_amount').length,
  }
}
