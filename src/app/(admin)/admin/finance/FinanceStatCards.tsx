'use client'

import { Wallet, ArrowDownCircle, ClipboardList, PiggyBank, Hourglass, TrendingUp, CreditCard } from 'lucide-react'
import MetricCard from '@/components/ui/metric-card'

interface Props {
  grossTotal: string
  actualExpensesTotal: string
  plannedExpensesTotal: string
  netProfit: string
  marginHint: string
  outstandingTotal: string
  outstandingHint: string
  totalVisitsHint: string
  avgCheck: string
  activeSubscriptions: string
  remainingHoursHint: string
}

// Иконки-компоненты нельзя передавать пропом из серверного page.tsx в клиентский
// MetricCard напрямую (RSC запрещает функции в пропсах через границу сервер→клиент,
// тот же класс бага, что чинили в DonutChart с getHref). Поэтому этот блок сам —
// клиентский компонент и импортирует иконки локально, принимая от страницы только
// уже отформатированные строки.
//
// "Чистая прибыль" здесь = выручка - фактически оплаченные расходы (реальное
// движение денег), поэтому карточка не кликабельна — это не строка из одной
// таблицы, а расчёт из двух разных разделов, отдельного экрана-расшифровки под
// неё пока нет. Прогнозная прибыль (с учётом ПЛАНОВЫХ расходов) — только в
// подписи под карточками на странице, во избежание путаницы с реальной прибылью.
export default function FinanceStatCards({
  grossTotal, actualExpensesTotal, plannedExpensesTotal, netProfit, marginHint,
  outstandingTotal, outstandingHint, totalVisitsHint, avgCheck, activeSubscriptions, remainingHoursHint,
}: Props) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
      <MetricCard icon={Wallet} label="Выручка" value={grossTotal} subtitle="за всё время" href="/admin/finance/visits" />
      <MetricCard icon={ArrowDownCircle} label="Расходы факт" value={actualExpensesTotal} subtitle="реально оплачено" href="/admin/finance/expenses" />
      <MetricCard icon={ClipboardList} label="Расходы план" value={plannedExpensesTotal} subtitle="все обязательства" href="/admin/finance/expenses" />
      <MetricCard icon={PiggyBank} label="Чистая прибыль" value={netProfit} subtitle={marginHint} />
      <MetricCard icon={Hourglass} label="Остаток к оплате" value={outstandingTotal} subtitle={outstandingHint} href="/admin/finance/expenses?filter=outstanding" />
      <MetricCard icon={TrendingUp} label="Средний чек" value={avgCheck} subtitle={totalVisitsHint} href="/admin/finance/visits" />
      <MetricCard
        icon={CreditCard} label="Активных абонементов" value={activeSubscriptions}
        subtitle={remainingHoursHint} href="/admin/finance/subscriptions"
      />
    </div>
  )
}
