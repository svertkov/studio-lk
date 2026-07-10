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
//
// Два отдельных ряда вместо одной auto-fit сетки на все семь карточек (ТЗ:
// "не размещать все карточки в одну тесную строку, не оставлять одну одинокую
// карточку на второй строке"): первый ряд — три приоритетных показателя
// (size="large"), второй — четыре вторичных (size="regular", тот же пресет
// MetricCard, но компактнее большого). На широком экране 3 и 4 колонки
// заполняют ряды равномерно; на планшете/ноутбуке оба ряда складываются по
// 2 карточки в строку — для второго ряда это ровно 2×2 без остатка, а третья
// (последняя) крупная карточка растягивается на всю ширину строки
// (sm:col-span-2 lg:col-span-1), чтобы не повисать одна в пустой строке.
export default function FinanceStatCards({
  grossTotal, actualExpensesTotal, plannedExpensesTotal, netProfit, marginHint,
  outstandingTotal, outstandingHint, totalVisitsHint, avgCheck, activeSubscriptions, remainingHoursHint,
}: Props) {
  return (
    <div className="space-y-3 sm:space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
        <MetricCard
          size="large" icon={Wallet} label="Выручка" value={grossTotal}
          subtitle="за всё время" href="/admin/finance/visits"
        />
        <MetricCard
          size="large" icon={ArrowDownCircle} label="Расходы факт" value={actualExpensesTotal}
          subtitle="реально оплачено" href="/admin/finance/expenses"
        />
        <MetricCard
          size="large" icon={PiggyBank} label="Чистая прибыль" value={netProfit}
          subtitle={marginHint} className="sm:col-span-2 lg:col-span-1"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <MetricCard
          size="regular" icon={ClipboardList} label="Расходы план" value={plannedExpensesTotal}
          subtitle="все обязательства" href="/admin/finance/expenses"
        />
        <MetricCard
          size="regular" icon={Hourglass} label="Остаток к оплате" value={outstandingTotal}
          subtitle={outstandingHint} href="/admin/finance/expenses?filter=outstanding"
        />
        <MetricCard
          size="regular" icon={TrendingUp} label="Средний чек" value={avgCheck}
          subtitle={totalVisitsHint} href="/admin/finance/visits"
        />
        <MetricCard
          size="regular" icon={CreditCard} label="Активных абонементов" value={activeSubscriptions}
          subtitle={remainingHoursHint} href="/admin/finance/subscriptions"
        />
      </div>
    </div>
  )
}
