'use client'

import { format, parseISO } from 'date-fns'
import { ru } from 'date-fns/locale'
import { CalendarClock, UserX } from 'lucide-react'
import type { OrderDTO } from '@/lib/actions/orders'
import { ORDER_PAYMENT_STATUS_LABELS, ORDER_PAYMENT_STATUS_COLORS, ORDER_SOURCE_LABELS } from '@/lib/order-model'

interface Props {
  order: OrderDTO
  onClick: () => void
}

function formatMoney(v: number | null) {
  if (v == null) return null
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(v)
}

export default function OrderCard({ order, onClick }: Props) {
  const name = order.clientName || order.title || 'Без имени'
  const subLine = [order.serviceType, order.room].filter(Boolean).join(' · ')
  const when = order.plannedStartTime && order.plannedEndTime
    ? `${format(parseISO(order.plannedStartTime), 'd MMMM', { locale: ru })}, ${format(parseISO(order.plannedStartTime), 'HH:mm')}–${format(parseISO(order.plannedEndTime), 'HH:mm')}`
    : null
  const amount = formatMoney(order.preliminaryAmount)

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left bg-zinc-900 border border-zinc-800 hover:border-zinc-700 rounded-lg p-3.5 space-y-1.5 transition-colors"
    >
      <p className="text-zinc-100 text-sm font-medium truncate">{name}</p>
      {subLine && <p className="text-zinc-400 text-xs truncate">{subLine}</p>}
      {when && (
        <p className="text-zinc-400 text-xs flex items-center gap-1.5">
          <CalendarClock className="w-3.5 h-3.5 flex-shrink-0" />
          {when}
        </p>
      )}
      <div className="flex items-center justify-between gap-2 pt-0.5">
        <span className={`text-xs font-medium ${ORDER_PAYMENT_STATUS_COLORS[order.paymentStatus]}`}>
          {amount ? `${amount} · ` : ''}{ORDER_PAYMENT_STATUS_LABELS[order.paymentStatus]}
        </span>
      </div>
      {(order.source === 'GOOGLE_CALENDAR' || !order.clientId) && (
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          {order.source === 'GOOGLE_CALENDAR' && (
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-full border border-blue-800 text-blue-400 bg-blue-950/30">
              {ORDER_SOURCE_LABELS.GOOGLE_CALENDAR}
            </span>
          )}
          {!order.clientId && (
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-full border border-amber-800 text-amber-400 bg-amber-950/30 flex items-center gap-1">
              <UserX className="w-3 h-3" />
              Клиент не привязан
            </span>
          )}
        </div>
      )}
    </button>
  )
}
