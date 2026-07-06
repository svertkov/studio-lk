'use client'

import { useMemo, useState } from 'react'
import { format, parseISO, startOfMonth, endOfMonth, subMonths } from 'date-fns'
import { ru } from 'date-fns/locale'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { ArrowUp, ArrowDown, ArrowUpDown, Search, X } from 'lucide-react'
import MetricCard, { METRIC_GRID_CLASSNAME } from '@/components/ui/metric-card'
import DonutChart from '@/components/ui/donut-chart'
import BarChart from '@/components/ui/bar-chart'
import type { ExpenseRowDTO, ExpensesSummary, CategoryTotalDTO, MonthlyExpenseDTO } from '@/lib/actions/expenses'
import { PLAN_FACT_STATUS_LABELS, PLAN_FACT_STATUS_COLORS, type PlanFactStatus } from '@/lib/expense-model'
import ExpenseDetailModal from './ExpenseDetailModal'

type SortKey = 'date' | 'title' | 'category' | 'planned' | 'actual' | 'remaining' | 'progress' | 'orderedBy' | 'paidBy' | 'receivedBy'
type Period = 'all' | 'month' | 'lastMonth'
type StatusFilter = 'all' | PlanFactStatus

const TEXT_SORT_KEYS: SortKey[] = ['title', 'category', 'orderedBy', 'paidBy', 'receivedBy']
const PAGE_SIZE_OPTIONS = [25, 50, 100] as const

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'date', label: 'Дата' },
  { key: 'title', label: 'Название' },
  { key: 'category', label: 'Категория' },
  { key: 'planned', label: 'План' },
  { key: 'actual', label: 'Факт' },
  { key: 'remaining', label: 'Остаток' },
  { key: 'progress', label: '% оплаты' },
  { key: 'paidBy', label: 'Кто оплатил' },
]

const PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: 'all', label: 'Всё время' },
  { value: 'month', label: 'Текущий месяц' },
  { value: 'lastMonth', label: 'Прошлый месяц' },
]

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'Любой статус оплаты' },
  { value: 'fully_paid', label: PLAN_FACT_STATUS_LABELS.fully_paid },
  { value: 'partially_paid', label: PLAN_FACT_STATUS_LABELS.partially_paid },
  { value: 'unpaid', label: PLAN_FACT_STATUS_LABELS.unpaid },
  { value: 'overpaid', label: PLAN_FACT_STATUS_LABELS.overpaid },
]

function formatMoney(v: number) {
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(v)
}

interface Props {
  expenses: ExpenseRowDTO[]
  summary: ExpensesSummary
  byCategory: CategoryTotalDTO[]
  byMonth: MonthlyExpenseDTO[]
  topExpenses: ExpenseRowDTO[]
  initialCategory?: string
  initialOutstandingOnly: boolean
}

export default function ExpensesAnalyticsView({
  expenses, summary, byCategory, byMonth, topExpenses, initialCategory, initialOutstandingOnly,
}: Props) {
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState(initialCategory ?? '')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [paidByFilter, setPaidByFilter] = useState('')
  const [period, setPeriod] = useState<Period>('all')
  const [outstandingOnly, setOutstandingOnly] = useState(initialOutstandingOnly)
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState<number>(50)
  const [selected, setSelected] = useState<ExpenseRowDTO | null>(null)

  const categoryOptions = useMemo(
    () => Array.from(new Set(expenses.map(e => e.category))).sort((a, b) => a.localeCompare(b, 'ru')),
    [expenses],
  )
  const paidByOptions = useMemo(
    () => Array.from(new Set(expenses.map(e => e.paidBy).filter((p): p is string => !!p))).sort((a, b) => a.localeCompare(b, 'ru')),
    [expenses],
  )

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir(TEXT_SORT_KEYS.includes(key) ? 'asc' : 'desc')
    }
  }

  const filtered = useMemo(() => {
    const now = new Date()
    const monthStart = startOfMonth(now)
    const monthEnd = endOfMonth(now)
    const lastMonthStart = startOfMonth(subMonths(now, 1))
    const lastMonthEnd = endOfMonth(subMonths(now, 1))
    const q = search.trim().toLowerCase()

    return expenses.filter(e => {
      if (categoryFilter && e.category !== categoryFilter) return false
      if (paidByFilter && e.paidBy !== paidByFilter) return false
      if (statusFilter !== 'all' && e.planFactStatus !== statusFilter) return false
      if (outstandingOnly && e.planFactStatus !== 'partially_paid' && e.planFactStatus !== 'unpaid') return false
      if (period !== 'all') {
        if (!e.date) return false
        const d = parseISO(e.date)
        if (period === 'month' && (d < monthStart || d > monthEnd)) return false
        if (period === 'lastMonth' && (d < lastMonthStart || d > lastMonthEnd)) return false
      }
      if (q && !e.title.toLowerCase().includes(q)) return false
      return true
    })
  }, [expenses, search, categoryFilter, paidByFilter, statusFilter, outstandingOnly, period])

  const filteredTotals = useMemo(() => ({
    count: filtered.length,
    planned: filtered.reduce((sum, e) => sum + e.plannedAmount, 0),
    actual: filtered.reduce((sum, e) => sum + e.actualAmount, 0),
  }), [filtered])

  const sorted = useMemo(() => {
    const copy = [...filtered]
    copy.sort((a, b) => {
      let cmp = 0
      switch (sortKey) {
        case 'date': cmp = (a.date ? new Date(a.date).getTime() : 0) - (b.date ? new Date(b.date).getTime() : 0); break
        case 'title': cmp = a.title.localeCompare(b.title, 'ru'); break
        case 'category': cmp = a.category.localeCompare(b.category, 'ru'); break
        case 'planned': cmp = a.plannedAmount - b.plannedAmount; break
        case 'actual': cmp = a.actualAmount - b.actualAmount; break
        case 'remaining': cmp = a.remainingAmount - b.remainingAmount; break
        case 'progress': cmp = a.paymentProgress - b.paymentProgress; break
        case 'orderedBy': cmp = (a.orderedBy ?? '').localeCompare(b.orderedBy ?? '', 'ru'); break
        case 'paidBy': cmp = (a.paidBy ?? '').localeCompare(b.paidBy ?? '', 'ru'); break
        case 'receivedBy': cmp = (a.receivedBy ?? '').localeCompare(b.receivedBy ?? '', 'ru'); break
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
    return copy
  }, [filtered, sortKey, sortDir])

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize))
  const currentPage = Math.min(page, pageCount - 1)
  const paginated = sorted.slice(currentPage * pageSize, currentPage * pageSize + pageSize)

  const hasActiveFilters = !!search || !!categoryFilter || !!paidByFilter || statusFilter !== 'all' || outstandingOnly || period !== 'all'

  function resetFilters() {
    setSearch('')
    setCategoryFilter('')
    setPaidByFilter('')
    setStatusFilter('all')
    setOutstandingOnly(false)
    setPeriod('all')
    setPage(0)
  }

  function updateFilter<T>(setter: (v: T) => void, value: T) {
    setter(value)
    setPage(0)
  }

  return (
    <div className="space-y-6">
      {/* KPI */}
      <div className={METRIC_GRID_CLASSNAME}>
        <MetricCard padding="p-4" valueClassName="text-xl mt-1.5" label="Расходы факт" value={formatMoney(summary.actualTotal)} />
        <MetricCard padding="p-4" valueClassName="text-xl mt-1.5" label="Расходы план" value={formatMoney(summary.plannedTotal)} />
        <MetricCard padding="p-4" valueClassName="text-xl mt-1.5" label="Остаток к оплате" value={formatMoney(summary.remainingTotal)} />
        <MetricCard padding="p-4" valueClassName="text-xl mt-1.5" label="Всего расходов" value={String(summary.expenseCount)} />
        <MetricCard padding="p-4" valueClassName="text-xl mt-1.5" label="Частично оплачено" value={String(summary.partialCount)} />
        <MetricCard padding="p-4" valueClassName="text-xl mt-1.5" label="Не оплачено" value={String(summary.unpaidCount)} />
        <MetricCard padding="p-4" valueClassName="text-xl mt-1.5" label="Крупнейшая категория" value={summary.topCategory?.name ?? '—'} />
        <MetricCard padding="p-4" valueClassName="text-xl mt-1.5" label="Средний расход" value={summary.avgExpense != null ? formatMoney(summary.avgExpense) : '—'} />
      </div>

      {/* Аналитика */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
          <h3 className="text-white font-semibold text-sm mb-4">Расходы по категориям (факт)</h3>
          <DonutChart
            emptyLabel="Нет данных"
            data={byCategory.map(c => ({ label: c.label, value: c.actualTotal, color: c.color }))}
          />
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
          <h3 className="text-white font-semibold text-sm mb-4">План / факт по месяцам</h3>
          <BarChart
            emptyLabel="Нет данных"
            data={byMonth.map(m => ({ label: m.label, planned: m.planned, actual: m.actual }))}
            formatValue={v => formatMoney(v)}
          />
        </div>
      </div>

      {/* Топ-5 */}
      {topExpenses.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-zinc-800">
            <h3 className="text-white font-semibold text-sm">Топ-5 крупнейших расходов (по плану, без аренды помещения)</h3>
          </div>
          <div className="divide-y divide-zinc-800/60">
            {topExpenses.map(e => (
              <button
                key={e.id}
                onClick={() => setSelected(e)}
                className="w-full flex items-center justify-between gap-4 px-6 py-2.5 text-left hover:bg-zinc-800/40 transition-colors"
              >
                <div className="min-w-0">
                  <p className="text-zinc-200 text-sm truncate">{e.title}</p>
                  <p className="text-zinc-500 text-xs mt-0.5">{e.category}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-white text-sm font-medium">{formatMoney(e.plannedAmount)}</p>
                  <p className="text-zinc-500 text-xs mt-0.5">план</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Фильтры */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-56">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
          <input
            value={search}
            onChange={e => updateFilter(setSearch, e.target.value)}
            placeholder="Поиск по названию..."
            className="w-full bg-zinc-900 border border-zinc-800 text-zinc-200 placeholder-zinc-600 text-sm rounded-lg pl-9 pr-3 py-2.5 outline-none focus:border-zinc-600 transition-colors"
          />
        </div>

        <select
          value={period}
          onChange={e => updateFilter(setPeriod, e.target.value as Period)}
          className="bg-zinc-900 border border-zinc-800 text-zinc-300 text-sm rounded-lg px-3 py-2.5 outline-none focus:border-zinc-600 cursor-pointer"
        >
          {PERIOD_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>

        <select
          value={categoryFilter}
          onChange={e => updateFilter(setCategoryFilter, e.target.value)}
          className="bg-zinc-900 border border-zinc-800 text-zinc-300 text-sm rounded-lg px-3 py-2.5 outline-none focus:border-zinc-600 cursor-pointer"
        >
          <option value="">Все категории</option>
          {categoryOptions.map(c => <option key={c} value={c}>{c}</option>)}
        </select>

        <select
          value={statusFilter}
          onChange={e => updateFilter(setStatusFilter, e.target.value as StatusFilter)}
          className="bg-zinc-900 border border-zinc-800 text-zinc-300 text-sm rounded-lg px-3 py-2.5 outline-none focus:border-zinc-600 cursor-pointer"
        >
          {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>

        <select
          value={paidByFilter}
          onChange={e => updateFilter(setPaidByFilter, e.target.value)}
          className="bg-zinc-900 border border-zinc-800 text-zinc-300 text-sm rounded-lg px-3 py-2.5 outline-none focus:border-zinc-600 cursor-pointer"
        >
          <option value="">Кто оплатил: любой</option>
          {paidByOptions.map(p => <option key={p} value={p}>{p}</option>)}
        </select>

        <button
          onClick={() => updateFilter(setOutstandingOnly, !outstandingOnly)}
          className={`px-3 py-2.5 rounded-lg text-sm transition-colors ${
            outstandingOnly ? 'bg-amber-950/40 border border-amber-700/60 text-amber-300' : 'bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-zinc-200'
          }`}
        >
          Только неоплаченные/частичные
        </button>

        {hasActiveFilters && (
          <button onClick={resetFilters} className="flex items-center gap-1 text-zinc-500 hover:text-zinc-300 text-sm transition-colors">
            <X className="w-3.5 h-3.5" />
            Сбросить
          </button>
        )}
      </div>

      {/* Итоги по отфильтрованным данным */}
      <div className={METRIC_GRID_CLASSNAME}>
        <MetricCard padding="p-4" valueClassName="text-xl mt-1.5" label="Расходов" value={String(filteredTotals.count)} />
        <MetricCard padding="p-4" valueClassName="text-xl mt-1.5" label="План (по фильтру)" value={formatMoney(filteredTotals.planned)} />
        <MetricCard padding="p-4" valueClassName="text-xl mt-1.5" label="Факт (по фильтру)" value={formatMoney(filteredTotals.actual)} />
      </div>

      {sorted.length === 0 ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-12 text-center">
          <p className="text-zinc-400">По этому фильтру расходов нет</p>
        </div>
      ) : (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-zinc-800 hover:bg-transparent">
                  {COLUMNS.map(col => (
                    <TableHead key={col.key} className="text-zinc-400 text-xs uppercase tracking-wider">
                      <button
                        onClick={() => toggleSort(col.key)}
                        className={`flex items-center gap-1 hover:text-white transition-colors whitespace-nowrap ${sortKey === col.key ? 'text-white' : ''}`}
                      >
                        {col.label}
                        {sortKey === col.key ? (
                          sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                        ) : (
                          <ArrowUpDown className="w-3 h-3 opacity-30" />
                        )}
                      </button>
                    </TableHead>
                  ))}
                  <TableHead className="text-zinc-400 text-xs uppercase tracking-wider">Статус</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginated.map(e => (
                  <TableRow
                    key={e.id}
                    onClick={() => setSelected(e)}
                    className={`border-zinc-800 hover:bg-zinc-800/50 cursor-pointer ${e.planFactStatus === 'overpaid' ? 'bg-red-950/20' : ''}`}
                  >
                    <TableCell className="text-zinc-300 whitespace-nowrap">
                      {e.date ? format(parseISO(e.date), 'd MMM yyyy', { locale: ru }) : '—'}
                    </TableCell>
                    <TableCell className="text-zinc-100 max-w-52 truncate">{e.title}</TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1.5 text-zinc-400 text-xs whitespace-nowrap">
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: e.categoryColor }} />
                        {e.category}
                      </span>
                    </TableCell>
                    <TableCell className="text-zinc-400 whitespace-nowrap">{formatMoney(e.plannedAmount)}</TableCell>
                    <TableCell className="text-zinc-300 whitespace-nowrap">{formatMoney(e.actualAmount)}</TableCell>
                    <TableCell className="text-white font-medium whitespace-nowrap">{formatMoney(e.remainingAmount)}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      <div className="flex items-center gap-2 w-24">
                        <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${e.planFactStatus === 'overpaid' ? 'bg-red-500' : 'bg-[#00c26b]'}`}
                            style={{ width: `${Math.min(100, e.paymentProgress)}%` }}
                          />
                        </div>
                        <span className="text-zinc-500 text-xs flex-shrink-0">{Math.round(e.paymentProgress)}%</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-zinc-400 whitespace-nowrap">{e.paidBy ?? '—'}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-xs whitespace-nowrap ${PLAN_FACT_STATUS_COLORS[e.planFactStatus]}`}>
                        {PLAN_FACT_STATUS_LABELS[e.planFactStatus]}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Пагинация */}
          <div className="flex items-center justify-between px-4 py-3 border-t border-zinc-800 text-xs text-zinc-500">
            <div className="flex items-center gap-2">
              <span>Показывать по:</span>
              {PAGE_SIZE_OPTIONS.map(size => (
                <button
                  key={size}
                  onClick={() => { setPageSize(size); setPage(0) }}
                  className={`px-2 py-1 rounded transition-colors ${pageSize === size ? 'bg-zinc-700 text-white' : 'hover:text-zinc-300'}`}
                >
                  {size}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <span>
                {currentPage * pageSize + 1}–{Math.min((currentPage + 1) * pageSize, sorted.length)} из {sorted.length}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={currentPage === 0}
                  className="px-2 py-1 rounded hover:bg-zinc-800 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                >
                  Назад
                </button>
                <button
                  onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))}
                  disabled={currentPage >= pageCount - 1}
                  className="px-2 py-1 rounded hover:bg-zinc-800 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                >
                  Вперёд
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {selected && (
        <ExpenseDetailModal expense={selected} onOpenChange={open => { if (!open) setSelected(null) }} />
      )}
    </div>
  )
}
