'use server'

import { prisma } from '@/lib/prisma'
import { computeExpenseDerived, type PlanFactStatus } from '@/lib/expense-model'

// ============================================================
// СВОДКА ПО РАСХОДАМ (для карточек дашборда "Финансы" и верхних KPI страницы расходов)
// ============================================================

export interface ExpensesSummary {
  plannedTotal: number
  actualTotal: number
  remainingTotal: number
  expenseCount: number
  partialCount: number
  unpaidCount: number
  avgExpense: number | null
  topCategory: { name: string; total: number } | null
}

const EMPTY_SUMMARY: ExpensesSummary = {
  plannedTotal: 0, actualTotal: 0, remainingTotal: 0, expenseCount: 0,
  partialCount: 0, unpaidCount: 0, avgExpense: null, topCategory: null,
}

export async function getExpensesSummary(): Promise<
  { ok: true; data: ExpensesSummary } | { ok: false; data: ExpensesSummary; error: string }
> {
  try {
    const rows = await prisma.expense.findMany({
      select: { plannedAmount: true, actualAmount: true, category: { select: { name: true } } },
    })

    let plannedTotal = 0
    let actualTotal = 0
    let partialCount = 0
    let unpaidCount = 0
    const byCategory = new Map<string, number>()

    for (const r of rows) {
      const { planFactStatus } = computeExpenseDerived(r.plannedAmount, r.actualAmount)
      const planned = r.plannedAmount ?? r.actualAmount ?? 0
      const actual = r.actualAmount ?? 0
      plannedTotal += planned
      actualTotal += actual
      if (planFactStatus === 'partially_paid') partialCount++
      if (planFactStatus === 'unpaid') unpaidCount++

      const catName = r.category?.name ?? 'Прочее'
      byCategory.set(catName, (byCategory.get(catName) ?? 0) + actual)
    }

    let topCategory: ExpensesSummary['topCategory'] = null
    for (const [name, total] of byCategory) {
      if (!topCategory || total > topCategory.total) topCategory = { name, total }
    }

    return {
      ok: true,
      data: {
        plannedTotal,
        actualTotal,
        remainingTotal: plannedTotal - actualTotal,
        expenseCount: rows.length,
        partialCount,
        unpaidCount,
        avgExpense: rows.length > 0 ? actualTotal / rows.length : null,
        topCategory,
      },
    }
  } catch (e) {
    console.error('[getExpensesSummary]', e)
    return { ok: false, data: EMPTY_SUMMARY, error: 'Не удалось загрузить сводку по расходам' }
  }
}

// ============================================================
// ПОЛНЫЙ СПИСОК РАСХОДОВ — для таблицы на странице /admin/finance/expenses
// ============================================================

export interface ExpenseRowDTO {
  id: string
  date: string | null
  title: string
  category: string
  categoryColor: string
  plannedAmount: number
  actualAmount: number
  remainingAmount: number
  paymentProgress: number
  planFactStatus: PlanFactStatus
  rawStatus: string | null
  orderedBy: string | null
  paidBy: string | null
  receivedBy: string | null
  comment: string | null
}

function toExpenseRowDTO(r: {
  id: string; date: Date | null; title: string; plannedAmount: number | null; actualAmount: number | null
  rawStatus: string | null; orderedBy: string | null; paidBy: string | null; receivedBy: string | null; comment: string | null
  category: { name: string; color: string } | null
}): ExpenseRowDTO {
  const { remainingAmount, paymentProgress, planFactStatus } = computeExpenseDerived(r.plannedAmount, r.actualAmount)
  return {
    id: r.id,
    date: r.date ? r.date.toISOString() : null,
    title: r.title,
    category: r.category?.name ?? 'Прочее',
    categoryColor: r.category?.color ?? '#71717a',
    plannedAmount: r.plannedAmount ?? r.actualAmount ?? 0,
    actualAmount: r.actualAmount ?? 0,
    remainingAmount,
    paymentProgress,
    planFactStatus,
    rawStatus: r.rawStatus,
    orderedBy: r.orderedBy,
    paidBy: r.paidBy,
    receivedBy: r.receivedBy,
    comment: r.comment,
  }
}

export async function getAllExpenses(): Promise<
  { ok: true; data: ExpenseRowDTO[] } | { ok: false; data: ExpenseRowDTO[]; error: string }
> {
  try {
    const rows = await prisma.expense.findMany({
      orderBy: { date: 'desc' },
      include: { category: { select: { name: true, color: true } } },
    })
    return { ok: true, data: rows.map(toExpenseRowDTO) }
  } catch (e) {
    console.error('[getAllExpenses]', e)
    return { ok: false, data: [], error: 'Не удалось загрузить расходы' }
  }
}

// ============================================================
// АНАЛИТИКА: по категориям, по месяцам (план/факт), топ-10
// ============================================================

export interface CategoryTotalDTO {
  label: string
  color: string
  actualTotal: number
  plannedTotal: number
  count: number
  percent: number
}

export async function getExpensesByCategory(): Promise<
  { ok: true; data: CategoryTotalDTO[] } | { ok: false; data: CategoryTotalDTO[]; error: string }
> {
  try {
    const rows = await prisma.expense.findMany({
      select: { plannedAmount: true, actualAmount: true, category: { select: { name: true, color: true } } },
    })
    const map = new Map<string, { color: string; actualTotal: number; plannedTotal: number; count: number }>()
    for (const r of rows) {
      const name = r.category?.name ?? 'Прочее'
      const entry = map.get(name) ?? { color: r.category?.color ?? '#71717a', actualTotal: 0, plannedTotal: 0, count: 0 }
      entry.actualTotal += r.actualAmount ?? 0
      entry.plannedTotal += r.plannedAmount ?? r.actualAmount ?? 0
      entry.count += 1
      map.set(name, entry)
    }
    const grandTotal = Array.from(map.values()).reduce((s, e) => s + e.actualTotal, 0)
    const data = Array.from(map.entries())
      .map(([label, e]) => ({
        label, color: e.color, actualTotal: e.actualTotal, plannedTotal: e.plannedTotal, count: e.count,
        percent: grandTotal > 0 ? (e.actualTotal / grandTotal) * 100 : 0,
      }))
      .sort((a, b) => b.actualTotal - a.actualTotal)
    return { ok: true, data }
  } catch (e) {
    console.error('[getExpensesByCategory]', e)
    return { ok: false, data: [], error: 'Не удалось загрузить расходы по категориям' }
  }
}

export interface MonthlyExpenseDTO {
  month: string // "2026-06"
  label: string // "июн 2026"
  planned: number
  actual: number
}

const MONTH_LABELS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']

export async function getExpensesByMonth(): Promise<
  { ok: true; data: MonthlyExpenseDTO[] } | { ok: false; data: MonthlyExpenseDTO[]; error: string }
> {
  try {
    const rows = await prisma.expense.findMany({ where: { date: { not: null } }, select: { date: true, plannedAmount: true, actualAmount: true } })
    const map = new Map<string, { planned: number; actual: number }>()
    for (const r of rows) {
      const d = r.date as Date
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
      const entry = map.get(key) ?? { planned: 0, actual: 0 }
      entry.planned += r.plannedAmount ?? r.actualAmount ?? 0
      entry.actual += r.actualAmount ?? 0
      map.set(key, entry)
    }
    const data = Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, v]) => {
        const [y, m] = month.split('-')
        return { month, label: `${MONTH_LABELS[parseInt(m, 10) - 1]} ${y}`, planned: v.planned, actual: v.actual }
      })
    return { ok: true, data }
  } catch (e) {
    console.error('[getExpensesByMonth]', e)
    return { ok: false, data: [], error: 'Не удалось загрузить расходы по месяцам' }
  }
}

// Аренда/коммуналка/охрана помещения — известный регулярный платёж, а не
// "крупный расход" в смысле, который тут интересен, поэтому не учитывается
// в топе. Совпадение по названию (а не по категории), потому что в реальной
// таблице такие строки разбросаны по двум категориям ("база помещения" и
// "фиксированный платёж" вперемешку с другими нерентными платежами).
function isPremisesRent(title: string): boolean {
  return title.toLowerCase().includes('помещен')
}

export async function getTopExpenses(limit = 5): Promise<
  { ok: true; data: ExpenseRowDTO[] } | { ok: false; data: ExpenseRowDTO[]; error: string }
> {
  try {
    // Сортируем по ПЛАНОВОЙ сумме (не факту) в коде, а не через Prisma orderBy —
    // NULL в actualAmount иначе считается "самым большим" при ORDER BY … DESC
    // (стандартное поведение SQL), из-за чего неоплаченные позиции ложно
    // попадали на верх списка "крупнейших".
    const rows = await prisma.expense.findMany({
      include: { category: { select: { name: true, color: true } } },
    })
    const data = rows
      .map(toExpenseRowDTO)
      .filter(e => !isPremisesRent(e.title))
      .sort((a, b) => b.plannedAmount - a.plannedAmount)
      .slice(0, limit)
    return { ok: true, data }
  } catch (e) {
    console.error('[getTopExpenses]', e)
    return { ok: false, data: [], error: 'Не удалось загрузить крупнейшие расходы' }
  }
}

// Обязательства с остатком к оплате (частично/не оплаченные) — для карточки
// "Остаток к оплате" на дашборде и превью-блока рядом с ней.
export async function getOutstandingLiabilities(): Promise<
  { ok: true; data: ExpenseRowDTO[] } | { ok: false; data: ExpenseRowDTO[]; error: string }
> {
  try {
    const rows = await prisma.expense.findMany({
      orderBy: { date: 'desc' },
      include: { category: { select: { name: true, color: true } } },
    })
    const data = rows
      .map(toExpenseRowDTO)
      .filter(r => r.planFactStatus === 'partially_paid' || r.planFactStatus === 'unpaid')
      .sort((a, b) => b.remainingAmount - a.remainingAmount)
    return { ok: true, data }
  } catch (e) {
    console.error('[getOutstandingLiabilities]', e)
    return { ok: false, data: [], error: 'Не удалось загрузить обязательства к оплате' }
  }
}
