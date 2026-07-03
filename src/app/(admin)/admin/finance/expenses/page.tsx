import Link from 'next/link'
import { ArrowLeft, ArrowDownCircle } from 'lucide-react'
import { getAllExpenses, getExpensesSummary, getExpensesByCategory, getExpensesByMonth, getTopExpenses } from '@/lib/actions/expenses'
import ExpensesAnalyticsView from './ExpensesAnalyticsView'

interface Props {
  searchParams: Promise<{ category?: string; filter?: string }>
}

export default async function ExpensesPage({ searchParams }: Props) {
  const { category, filter } = await searchParams
  const [expensesResult, summaryResult, byCategoryResult, byMonthResult, topResult] = await Promise.all([
    getAllExpenses(),
    getExpensesSummary(),
    getExpensesByCategory(),
    getExpensesByMonth(),
    getTopExpenses(5),
  ])

  return (
    <div className="p-8 space-y-6">
      <div>
        <Link href="/admin/finance" className="inline-flex items-center gap-1.5 text-zinc-400 hover:text-white text-sm transition-colors">
          <ArrowLeft className="w-4 h-4" />
          Финансы
        </Link>
        <div className="flex items-center justify-between mt-3">
          <div>
            <h1 className="text-2xl font-bold text-white">Расходы</h1>
            <p className="text-zinc-400 text-sm mt-1">
              План и факт по обязательствам студии · {expensesResult.data.length} записей всего
            </p>
          </div>
          <div className="w-12 h-12 bg-zinc-800 rounded-lg flex items-center justify-center flex-shrink-0">
            <ArrowDownCircle className="w-6 h-6 text-zinc-300" />
          </div>
        </div>
      </div>

      <ExpensesAnalyticsView
        expenses={expensesResult.data}
        summary={summaryResult.data}
        byCategory={byCategoryResult.data}
        byMonth={byMonthResult.data}
        topExpenses={topResult.data}
        initialCategory={category}
        initialOutstandingOnly={filter === 'outstanding'}
      />
    </div>
  )
}
