import type { VisitStats } from '@/lib/visit-stats'
import type { ExpensesSummary } from '@/lib/actions/expenses'
import type { MontageDashboardStats } from '@/lib/montage-model'

// Единая точка сборки страницы "Финансы" из трёх независимых, никогда не
// пересекавшихся источников денег: студийные визиты (ClientVisit, бухгалтерский
// импорт), обязательства (Expense) и монтаж (MontageProject, свой P&L уже
// считает computeMontageDashboardStats). Ни один рубль не учитывается в двух
// источниках одновременно — clientAmount/editorAmount монтажа никогда не
// копируются в Order/ClientVisit (см. AGENTS.md, ensureMontageProjectForOrder).
// Карточки страницы читают только поля этого объекта — арифметика не
// повторяется в UI (см. AGENTS.md, правило про общий финансовый helper).
export interface CombinedFinanceSummary {
  totalRevenue: number
  shootsRevenue: number
  montageRevenue: number
  montageRevenuePaid: number
  montageRevenueOutstanding: number

  actualExpensesTotal: number
  shootsActualExpenses: number
  montageActualExpenses: number

  plannedExpensesTotal: number
  shootsPlannedExpenses: number
  montagePlannedExpenses: number

  outstandingTotal: number
  shootsOutstanding: number
  montageOutstanding: number

  netProfit: number
  projectedProfit: number
  margin: number | null

  montageReportingSince: string | null
}

export function computeCombinedFinanceSummary(
  visits: Pick<VisitStats, 'grossTotal'>,
  expenses: Pick<ExpensesSummary, 'actualTotal' | 'plannedTotal' | 'remainingTotal'>,
  montage: MontageDashboardStats,
): CombinedFinanceSummary {
  const shootsRevenue = visits.grossTotal ?? 0
  const montageRevenue = montage.revenueTotal
  const totalRevenue = shootsRevenue + montageRevenue

  const shootsActualExpenses = expenses.actualTotal
  const montageActualExpenses = montage.expensesPaid
  const actualExpensesTotal = shootsActualExpenses + montageActualExpenses

  const shootsPlannedExpenses = expenses.plannedTotal
  const montagePlannedExpenses = montage.expensesTotal
  const plannedExpensesTotal = shootsPlannedExpenses + montagePlannedExpenses

  const shootsOutstanding = expenses.remainingTotal
  const montageOutstanding = montage.studioDebt
  const outstandingTotal = shootsOutstanding + montageOutstanding

  // Та же гибридная конвенция, что уже была на странице "Финансы" до монтажа:
  // "чистая прибыль" = вся начисленная выручка минус ФАКТИЧЕСКИ оплаченные
  // расходы (реальное движение денег), а не два начисленных или два кассовых
  // числа — см. исходный комментарий в page.tsx. Монтаж встраивается той же
  // логикой (revenueTotal начислен, expensesPaid кассовый), не изобретает свою.
  const netProfit = totalRevenue - actualExpensesTotal
  const projectedProfit = totalRevenue - plannedExpensesTotal
  const margin = totalRevenue > 0 ? netProfit / totalRevenue : null

  return {
    totalRevenue, shootsRevenue, montageRevenue,
    montageRevenuePaid: montage.revenuePaid, montageRevenueOutstanding: montage.clientDebt,
    actualExpensesTotal, shootsActualExpenses, montageActualExpenses,
    plannedExpensesTotal, shootsPlannedExpenses, montagePlannedExpenses,
    outstandingTotal, shootsOutstanding, montageOutstanding,
    netProfit, projectedProfit, margin,
    montageReportingSince: montage.reportingSince,
  }
}
