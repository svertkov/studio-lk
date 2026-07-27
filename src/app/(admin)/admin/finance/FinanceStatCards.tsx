'use client'

import { Wallet, ArrowDownCircle, ClipboardList, PiggyBank, Hourglass, TrendingUp, CreditCard } from 'lucide-react'
import MetricCard from '@/components/ui/metric-card'

interface Props {
  grossTotal: string
  actualExpensesTotal: string
  plannedExpensesTotal: string
  ordersProfitTotal: string
  ordersProfitNegative: boolean
  ordersProfitHint: string
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
// 2026-07-27: "Выручка" и "Чистая прибыль" переведены с формулы "визиты минус
// фактические расходы" (computeCombinedFinanceSummary) на сумму по заказам
// (Order.preliminaryAmount/estimatedPrice и полностью ручной
// Order.netProfitManualAmount, см. getOrdersFinanceSummary в actions/orders.ts)
// — единственный показатель прибыли на дашборде, без конкурирующей формулы
// (см. AGENTS.md/ТЗ доработки финансового блока заказа). Обе карточки не
// кликабельны — это агрегат по всем заказам, отдельного экрана-разбивки под
// него пока нет (тот же случай, что уже был у "Чистая прибыль" раньше).
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
  grossTotal, actualExpensesTotal, plannedExpensesTotal, ordersProfitTotal, ordersProfitNegative, ordersProfitHint,
  outstandingTotal, outstandingHint, totalVisitsHint, avgCheck, activeSubscriptions, remainingHoursHint,
}: Props) {
  return (
    <div className="space-y-3 sm:space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
        <MetricCard
          size="large" icon={Wallet} label="Выручка" value={grossTotal}
          subtitle="по заказам, за всё время"
        />
        <MetricCard
          size="large" icon={ArrowDownCircle} label="Расходы факт" value={actualExpensesTotal}
          subtitle="реально оплачено" href="/admin/finance/expenses"
        />
        <MetricCard
          size="large" icon={PiggyBank} label="Прибыль по заказам" value={ordersProfitTotal}
          subtitle={ordersProfitHint} className="sm:col-span-2 lg:col-span-1"
          valueColorClassName={ordersProfitNegative ? 'text-red-400' : undefined}
          title="Сумма прибыли, вручную указанной в карточках заказов"
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
