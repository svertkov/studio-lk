import Link from 'next/link'
import { ChevronRight, Clapperboard } from 'lucide-react'
import type { CombinedFinanceSummary } from '@/lib/finance-model'

function formatMoney(v: number) {
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(v)
}

function formatDate(v: string) {
  return new Date(v).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
}

interface Props {
  combined: CombinedFinanceSummary
}

// Компактная разбивка "Съёмки / Монтаж" под основными KPI-карточками — не
// дублирует таблицу проектов монтажа (она уже есть на /admin/editing),
// только показывает вклад источника в уже посчитанные (combined) итоги.
export default function MontageFinanceBreakdown({ combined }: Props) {
  const rows = [
    { label: 'Выручка', shoots: combined.shootsRevenue, montage: combined.montageRevenue },
    { label: 'Расходы (факт)', shoots: combined.shootsActualExpenses, montage: combined.montageActualExpenses },
    { label: 'Прибыль', shoots: combined.shootsRevenue - combined.shootsActualExpenses, montage: combined.montageRevenue - combined.montageActualExpenses },
  ]

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
      <div className="flex items-center gap-2 mb-3">
        <Clapperboard className="w-4 h-4 text-zinc-500 flex-shrink-0" />
        <h3 className="text-white font-semibold text-sm">Съёмки и монтаж по отдельности</h3>
      </div>
      <div className="space-y-1.5">
        {rows.map(r => (
          <div key={r.label} className="flex items-center justify-between gap-3 text-xs">
            <span className="text-zinc-500 w-28 flex-shrink-0">{r.label}</span>
            <span className="text-zinc-300 flex-1 truncate">
              Съёмки {formatMoney(r.shoots)} · Монтаж {formatMoney(r.montage)}
            </span>
          </div>
        ))}
      </div>
      {combined.montageOutstanding > 0 && (
        <p className="text-zinc-500 text-xs mt-2">
          Студия должна монтажёрам: {formatMoney(combined.montageOutstanding)}
        </p>
      )}
      {combined.montageReportingSince && (
        <p className="text-zinc-600 text-xs mt-1">
          Монтаж учитывается с {formatDate(combined.montageReportingSince)}
        </p>
      )}
      <Link href="/admin/editing" className="flex items-center gap-1 text-[#00c26b] hover:underline text-xs mt-3 w-fit">
        Подробнее по монтажу
        <ChevronRight className="w-3 h-3" />
      </Link>
    </div>
  )
}
