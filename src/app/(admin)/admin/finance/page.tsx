import Link from 'next/link'
import { CreditCard, ChevronRight, Info, Hourglass } from 'lucide-react'
import { getFinanceSummary, getSubscriptionsSummary } from '@/lib/actions/finance'
import { getExpensesSummary, getExpensesByCategory, getOutstandingLiabilities } from '@/lib/actions/expenses'
import DonutChart from '@/components/ui/donut-chart'
import FinanceStatCards from './FinanceStatCards'
import BookingIssuesBlock from '../dashboard/BookingIssuesBlock'

const CHART_COLORS = ['#00c26b', '#3b82f6', '#f59e0b', '#a855f7', '#ef4444', '#14b8a6']
const LOW_HOURS_THRESHOLD = 2

function formatMoney(v: number | null) {
  if (v == null) return '—'
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(v)
}

function formatDate(v: string | null) {
  if (!v) return '—'
  return new Date(v).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
}

function subscriptionWord(n: number) {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'абонемент'
  if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return 'абонемента'
  return 'абонементов'
}

export default async function FinancePage() {
  const [summaryResult, subsResult, expensesResult, expensesByCategoryResult, outstandingResult] = await Promise.all([
    getFinanceSummary(),
    getSubscriptionsSummary(),
    getExpensesSummary(),
    getExpensesByCategory(),
    getOutstandingLiabilities(),
  ])
  const stats = summaryResult.data
  const subs = subsResult.data
  const expenses = expensesResult.data
  const expensesByCategory = expensesByCategoryResult.data
  const outstanding = outstandingResult.data.slice(0, 5)

  // Чистая прибыль — от ФАКТИЧЕСКИ оплаченных расходов (реальное движение денег).
  // Прогнозная прибыль (с учётом ещё не оплаченных обязательств) — только в подписи,
  // чтобы не перепутать с реальной прибылью.
  const grossTotal = stats.grossTotal ?? 0
  const netProfit = grossTotal - expenses.actualTotal
  const projectedProfit = grossTotal - expenses.plannedTotal
  const margin = grossTotal > 0 ? (netProfit / grossTotal) * 100 : null

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Финансы</h1>
        <p className="text-zinc-400 text-sm mt-1">Выручка, расходы, абонементы и записи, требующие действия</p>
      </div>

      <FinanceStatCards
        grossTotal={formatMoney(grossTotal)}
        actualExpensesTotal={formatMoney(expenses.actualTotal)}
        plannedExpensesTotal={formatMoney(expenses.plannedTotal)}
        netProfit={formatMoney(netProfit)}
        marginHint={margin != null ? `маржа ${margin.toFixed(0)}%` : 'по факт. расходам'}
        outstandingTotal={formatMoney(expenses.remainingTotal)}
        outstandingHint={expenses.partialCount + expenses.unpaidCount > 0 ? `${expenses.partialCount + expenses.unpaidCount} обязательств` : 'всё оплачено'}
        totalVisitsHint={`${stats.totalVisits} визитов`}
        avgCheck={formatMoney(stats.avgCheck)}
        activeSubscriptions={String(subs.activeCount)}
        remainingHoursHint={`осталось ${subs.remainingHoursTotal % 1 === 0 ? subs.remainingHoursTotal.toFixed(0) : subs.remainingHoursTotal.toFixed(1)} ч`}
      />

      <div className="flex items-start gap-2 text-zinc-600 text-xs px-1">
        <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
        <p>
          Прогнозная прибыль (с учётом всех плановых расходов, даже ещё не оплаченных): {formatMoney(projectedProfit)}.
          {' '}Средний чек = сумма выручки / количество визитов с указанной суммой оплаты.
        </p>
      </div>

      {subs.soonToExpireCount > 0 && (
        <Link
          href="/admin/finance/subscriptions?filter=low"
          className="flex items-center gap-3 bg-amber-950/20 hover:bg-amber-950/30 border border-amber-600/40 rounded-xl px-4 py-3 transition-colors"
        >
          <CreditCard className="w-4 h-4 text-amber-400 flex-shrink-0" />
          <p className="text-amber-200 text-sm flex-1">
            {subs.soonToExpireCount} {subscriptionWord(subs.soonToExpireCount)} заканчивается (осталось ≤ {LOW_HOURS_THRESHOLD} ч) — стоит предупредить клиентов заранее.
          </p>
          <ChevronRight className="w-4 h-4 text-amber-400/70 flex-shrink-0" />
        </Link>
      )}

      {/* Сделки, требующие действия — та же логика, что и на дашборде: прошедшие
          студийные записи без материалов/оплаты, ничего нового не выдумываем */}
      <BookingIssuesBlock />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
          <h3 className="text-white font-semibold text-sm mb-4">Выручка по залам</h3>
          <DonutChart
            emptyLabel="Нет данных о залах"
            data={stats.byRoom.map((r, i) => ({ label: r.label, value: r.percent, color: CHART_COLORS[i % CHART_COLORS.length] }))}
            hrefBase="/admin/finance/visits?room="
          />
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
          <h3 className="text-white font-semibold text-sm mb-4">Выручка по форматам</h3>
          <DonutChart
            emptyLabel="Нет данных о форматах"
            data={stats.byFormat.map((f, i) => ({ label: f.label, value: f.percent, color: CHART_COLORS[i % CHART_COLORS.length] }))}
            hrefBase="/admin/finance/visits?format="
          />
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
          <h3 className="text-white font-semibold text-sm mb-4">Расходы по категориям</h3>
          <DonutChart
            emptyLabel="Нет данных о расходах"
            data={expensesByCategory.map(c => ({ label: c.label, value: c.actualTotal, color: c.color }))}
            hrefBase="/admin/finance/expenses?category="
          />
        </div>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-zinc-800 flex items-center gap-2">
          <Hourglass className="w-4 h-4 text-zinc-500 flex-shrink-0" />
          <h3 className="text-white font-semibold text-sm">Обязательства, требующие оплаты</h3>
        </div>
        {outstanding.length === 0 ? (
          <p className="text-zinc-500 text-sm text-center py-8">Все расходы оплачены полностью</p>
        ) : (
          <div className="divide-y divide-zinc-800/60">
            {outstanding.map(e => (
              <div key={e.id} className="flex items-center justify-between gap-4 px-6 py-3">
                <div className="min-w-0">
                  <p className="text-zinc-200 text-sm truncate">{e.title}</p>
                  <p className="text-zinc-500 text-xs mt-0.5">{formatDate(e.date)} · {e.category}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-white text-sm font-medium">{formatMoney(e.remainingAmount)}</p>
                  <p className="text-zinc-500 text-xs mt-0.5">осталось из {formatMoney(e.plannedAmount)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="px-6 py-4 border-t border-zinc-800">
          <Link
            href="/admin/finance/expenses"
            className="flex items-center justify-center gap-1.5 w-full bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm font-medium py-2.5 rounded-lg transition-colors"
          >
            Смотреть все расходы
            <ChevronRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </div>
  )
}
