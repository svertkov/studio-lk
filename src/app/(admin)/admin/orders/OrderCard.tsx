'use client'

import type { CSSProperties } from 'react'
import { format, parseISO } from 'date-fns'
import { ru } from 'date-fns/locale'
import { CalendarClock, UserX } from 'lucide-react'
import type { DraggableAttributes, DraggableSyntheticListeners } from '@dnd-kit/core'
import type { OrderDTO } from '@/lib/actions/orders'
import { ORDER_PAYMENT_STATUS_LABELS, ORDER_PAYMENT_STATUS_COLORS, ORDER_SOURCE_LABELS, getOrderStatusVars } from '@/lib/order-model'

interface Props {
  order: OrderDTO
  onClick: () => void
  // Проп геттера drag-хендлера из dnd-kit useDraggable — необязательные,
  // чтобы карточку можно было рендерить и вне контекста канбана (сейчас
  // не используется где-то ещё, но так карточка не завязана жёстко на DnD).
  dragAttributes?: DraggableAttributes
  dragListeners?: DraggableSyntheticListeners
  // true — карточка отрисована в DragOverlay (её "приподняли"): используем
  // усиленный акцент вместо hover, т.к. настоящего hover там не бывает.
  elevated?: boolean
}

function formatMoney(v: number | null) {
  if (v == null) return null
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(v)
}

// Статичные Tailwind-классы, общие для всех статусов — конкретный цвет
// приходит через CSS-переменные --status-* (см. getOrderStatusVars), которые
// выставляются в style на самом элементе. Так JIT-компилятору не нужно видеть
// шаблонные строки вида `border-blue-500` — сами классы неизменны.
const CARD_REST = 'border-[color:var(--status-border)] shadow-[0_0_16px_-2px_var(--status-glow)] hover:border-[color:var(--status-border-strong)] hover:shadow-[0_0_26px_-2px_var(--status-glow-strong)] hover:bg-zinc-800/60'
const CARD_ELEVATED = 'border-[color:var(--status-border-strong)] shadow-[0_0_36px_2px_var(--status-glow-strong)]'

export default function OrderCard({ order, onClick, dragAttributes, dragListeners, elevated }: Props) {
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
      {...dragAttributes}
      {...dragListeners}
      style={getOrderStatusVars(order.status) as CSSProperties}
      className={`w-full text-left bg-zinc-900 border border-l-[3px] border-l-[color:var(--status-color)] rounded-lg p-3.5 space-y-1.5 transition-all duration-150 ease-out touch-none ${elevated ? CARD_ELEVATED : CARD_REST}`}
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
