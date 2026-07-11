'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Plus, Search, ShoppingBag, Archive } from 'lucide-react'
import {
  DndContext, DragOverlay, PointerSensor, closestCenter, useSensor, useSensors, useDraggable, useDroppable,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core'
import type { CSSProperties } from 'react'
import { updateOrderStatus, type OrderDTO } from '@/lib/actions/orders'
import { ORDER_BOARD_COLUMNS, ORDER_STATUS_LABELS, getOrderStatusConfig, getOrderStatusVars, sortOrdersForColumn, type OrderStatus, type OrderStatusConfig } from '@/lib/order-model'
import OrderCard from './OrderCard'
import OrderFormModal from './OrderFormModal'

interface Props {
  initialOrders: OrderDTO[]
}

function isOrderStatus(value: string): value is OrderStatus {
  return (ORDER_BOARD_COLUMNS as string[]).includes(value)
}

export default function OrdersBoard({ initialOrders }: Props) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [editingOrder, setEditingOrder] = useState<OrderDTO | null>(null)
  const [creating, setCreating] = useState(false)
  // Оптимистичная подмена статуса поверх серверных данных — не копируем
  // initialOrders в состояние (нет эффекта, синхронизирующего пропс), просто
  // накладываем ожидающие изменения поверх свежих данных при каждом рендере.
  // Как только router.refresh() привозит статус, совпадающий с ожидаемым,
  // подмена сама перестаёт что-либо менять — отдельный сброс не нужен.
  const [pendingStatus, setPendingStatus] = useState<Record<string, OrderStatus>>({})
  const [activeOrderId, setActiveOrderId] = useState<string | null>(null)
  const [dragError, setDragError] = useState<string | null>(null)

  // Порог в 8px до начала настоящего drag — иначе обычный клик по карточке
  // (открыть форму заказа) или по селекту статуса воспринимался бы как
  // попытка перетаскивания.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  const orders = useMemo(
    () => initialOrders.map(o => (pendingStatus[o.id] && pendingStatus[o.id] !== o.status ? { ...o, status: pendingStatus[o.id] } : o)),
    [initialOrders, pendingStatus],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return orders
    return orders.filter(o =>
      (o.clientName ?? '').toLowerCase().includes(q) ||
      (o.title ?? '').toLowerCase().includes(q) ||
      (o.clientPhone ?? '').toLowerCase().includes(q),
    )
  }, [orders, search])

  // Группировка по колонке + сортировка внутри каждой колонки по своему
  // правилу (см. sortOrdersForColumn в order-model.ts) — пересчитывается
  // при каждом изменении данных, поэтому ручная позиция сброса карточки
  // внутри колонки не имеет значения: итоговое место всегда определяет сортировка.
  const byStatus = useMemo(() => {
    const map = new Map<OrderStatus, OrderDTO[]>()
    for (const s of ORDER_BOARD_COLUMNS) map.set(s, [])
    for (const o of filtered) {
      if (map.has(o.status)) map.get(o.status)!.push(o)
    }
    for (const s of ORDER_BOARD_COLUMNS) map.set(s, sortOrdersForColumn(s, map.get(s)!))
    return map
  }, [filtered])

  const activeOrder = activeOrderId ? orders.find(o => o.id === activeOrderId) ?? null : null

  function handleChanged() {
    router.refresh()
  }

  async function handleStatusChange(order: OrderDTO, status: OrderStatus) {
    if (order.status === status) return
    setPendingStatus(prev => ({ ...prev, [order.id]: status }))
    const result = await updateOrderStatus(order.id, status)
    if (!result.ok) {
      // Откатываем карточку в прежний столбец — снятие подмены возвращает
      // отображаемый статус к тому, что реально хранится в данных.
      setPendingStatus(prev => { const next = { ...prev }; delete next[order.id]; return next })
      setDragError(result.error || 'Не удалось сохранить статус — заявка возвращена в прежний столбец')
      setTimeout(() => setDragError(null), 4500)
    } else {
      router.refresh()
    }
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveOrderId(String(event.active.id))
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveOrderId(null)
    const { active, over } = event
    if (!over) return
    const targetStatus = String(over.id)
    if (!isOrderStatus(targetStatus)) return
    const order = orders.find(o => o.id === String(active.id))
    if (!order) return
    void handleStatusChange(order, targetStatus)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Поиск по имени, телефону, заявке..."
            className="w-full bg-zinc-900 border border-zinc-800 text-zinc-100 placeholder-zinc-600 rounded-lg pl-9 pr-3 py-2 text-sm outline-none focus:border-[#00c26b] transition-colors"
          />
        </div>
        <div className="flex items-center gap-2.5 flex-shrink-0">
          <Link
            href="/admin/crm/archive"
            className="flex items-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
          >
            <Archive className="w-4 h-4" />
            Архив
          </Link>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex items-center gap-1.5 bg-[#00c26b] hover:bg-[#00b360] text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            Создать заказ
          </button>
        </div>
      </div>

      {orders.length === 0 ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-14 text-center">
          <ShoppingBag className="w-10 h-10 text-zinc-600 mx-auto mb-4" />
          <p className="text-zinc-300 font-medium">Пока нет заказов</p>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="mt-4 inline-flex items-center gap-1.5 bg-[#00c26b] hover:bg-[#00b360] text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            Создать заказ
          </button>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setActiveOrderId(null)}
        >
          <div className="flex gap-4 overflow-x-auto pb-2">
            {ORDER_BOARD_COLUMNS.map(columnStatus => (
              // «Отказы» — отдельный, неуспешный финал воронки: небольшой
              // дополнительный отступ отделяет его от последовательности
              // «Заявка → ... → Завершено», не ломая общую сетку столбцов.
              <div key={columnStatus} className={columnStatus === 'CANCELLED' ? 'ml-3' : undefined}>
                <OrderColumn
                  status={columnStatus}
                  orders={byStatus.get(columnStatus) ?? []}
                  onCardClick={setEditingOrder}
                  onStatusSelect={handleStatusChange}
                />
              </div>
            ))}
          </div>
          <DragOverlay dropAnimation={{ duration: 150, easing: 'ease' }}>
            {activeOrder ? (
              <div className="w-72 scale-[1.02]">
                <OrderCard order={activeOrder} onClick={() => {}} elevated />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      {creating && (
        <OrderFormModal
          order={null}
          onOpenChange={setCreating}
          onSaved={handleChanged}
        />
      )}
      {editingOrder && (
        <OrderFormModal
          order={editingOrder}
          onOpenChange={open => { if (!open) setEditingOrder(null) }}
          onSaved={handleChanged}
        />
      )}

      {dragError && (
        <div className="fixed bottom-4 right-4 z-[60] max-w-sm bg-red-950/95 border border-red-800 text-red-200 text-sm px-4 py-3 rounded-lg shadow-lg shadow-black/40">
          {dragError}
        </div>
      )}
    </div>
  )
}

interface OrderColumnProps {
  status: OrderStatus
  orders: OrderDTO[]
  onCardClick: (order: OrderDTO) => void
  onStatusSelect: (order: OrderDTO, status: OrderStatus) => void
}

// Статичные Tailwind-классы для столбца — сам цвет приходит через CSS-
// переменные --status-* (см. getOrderStatusVars), выставленные в style.
// before: рисует цветную линию сверху столбца — вместе с последовательностью
// холодный-синий → тёплый-зелёный по всем столбцам это и даёт ощущение
// "движения по этапам слева направо" (см. Задачу 5 в исходном ТЗ).
//
// «Монтаж» — единственный статус с featuredColumnGlow(Strong) в конфиге:
// у него вместо обычной однослойной тени используется готовая двухслойная
// (внешний glow + inset), собранная в самой CSS-переменной, поэтому здесь
// достаточно просто сослаться на var(--status-featured-glow) без доп. логики.
function getColumnClassName(config: OrderStatusConfig, isOver: boolean): string {
  const border = isOver ? 'border-[color:var(--status-border-strong)]' : 'border-[color:var(--status-border)]'
  const bg = isOver ? 'bg-zinc-900/70' : 'bg-zinc-950/40'
  const shadow = config.featuredColumnGlow
    ? (isOver ? 'shadow-[var(--status-featured-glow-strong)]' : 'shadow-[var(--status-featured-glow)]')
    : (isOver ? 'shadow-[0_0_40px_-4px_var(--status-glow-strong)]' : 'shadow-[0_0_26px_-8px_var(--status-glow)]')
  const topBar =
    "before:content-[''] before:absolute before:inset-x-0 before:top-0 before:h-[3px] before:bg-[color:var(--status-color)] before:z-10" +
    (isOver ? '' : ' before:opacity-80')
  return `${border} ${bg} ${shadow} ${topBar}`
}

// Дроппабл-зона колонки — при isOver (перетаскиваемая карточка зависла над
// столбцом) граница/glow/фон переходят в усиленный вариант той же CSS-
// переменной, поэтому подсветка всегда в цвет самого этапа, а не бренд-зелёная.
function OrderColumn({ status, orders, onCardClick, onStatusSelect }: OrderColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: status })
  const config = getOrderStatusConfig(status)
  const isEmpty = orders.length === 0

  return (
    <div
      ref={setNodeRef}
      style={getOrderStatusVars(status) as CSSProperties}
      className={`w-72 flex-shrink-0 flex flex-col relative overflow-hidden rounded-xl border bg-[image:linear-gradient(180deg,var(--status-bg)_0%,rgba(255,255,255,0.012)_45%,transparent_100%)] transition-all duration-150 ease-out ${getColumnClassName(config, isOver)}`}
    >
      <div
        className="px-3.5 py-3 border-b border-zinc-800/80 flex items-center justify-between relative z-10"
        style={{ background: config.headerBackground, borderBottomColor: config.headerBorderColor }}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <span
            className="w-1.5 h-5 rounded-full flex-shrink-0 bg-[color:var(--status-color)] shadow-[0_0_10px_var(--status-glow-strong)]"
          />
          <h3 className="text-zinc-100 text-sm font-semibold truncate">{config.label}</h3>
        </div>
        <span className="text-zinc-300 text-xs flex-shrink-0 px-2 py-0.5 rounded-full border border-[color:var(--status-border)] bg-zinc-900/60">
          {orders.length}
        </span>
      </div>
      <div className="flex-1 min-h-[120px] max-h-[calc(100vh-320px)] overflow-y-auto p-2.5 space-y-2.5 relative z-10">
        {isEmpty ? (
          <p className={`text-xs text-center py-6 transition-colors ${isOver ? 'text-[color:var(--status-color)] font-medium' : 'text-zinc-600'}`}>
            {isOver ? `Отпустите, чтобы переместить в «${config.label}»` : 'Пусто'}
          </p>
        ) : (
          orders.map(order => (
            <DraggableOrderCard
              key={order.id}
              order={order}
              onClick={() => onCardClick(order)}
              onStatusSelect={onStatusSelect}
            />
          ))
        )}
      </div>
    </div>
  )
}

interface DraggableOrderCardProps {
  order: OrderDTO
  onClick: () => void
  onStatusSelect: (order: OrderDTO, status: OrderStatus) => void
}

// Слушатели/атрибуты dnd-kit передаются только в OrderCard (см. пропы ниже),
// а не на всю обёртку — поэтому клик по селекту статуса рядом с карточкой
// никогда не воспринимается как начало перетаскивания.
function DraggableOrderCard({ order, onClick, onStatusSelect }: DraggableOrderCardProps) {
  // Позицию во время перетаскивания показывает DragOverlay (см. OrdersBoard) —
  // сам исходный узел transform не получает, только тускнеет. Если применить
  // transform ещё и здесь, карточка задвоится: одна копия поедет за курсором
  // в оверлее, вторая — здесь же, трансформом поверх исходного места.
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: order.id })

  return (
    <div ref={setNodeRef} className={`space-y-1.5 ${isDragging ? 'opacity-40' : ''}`}>
      <OrderCard order={order} onClick={onClick} dragAttributes={attributes} dragListeners={listeners} />
      <select
        value={order.status}
        onChange={e => onStatusSelect(order, e.target.value as OrderStatus)}
        onClick={e => e.stopPropagation()}
        className="w-full bg-zinc-800 border border-zinc-700 text-zinc-400 rounded-lg px-2 py-1 text-[11px] outline-none focus:border-[#00c26b] cursor-pointer"
      >
        {ORDER_BOARD_COLUMNS.map(s => (
          <option key={s} value={s}>{ORDER_STATUS_LABELS[s]}</option>
        ))}
      </select>
    </div>
  )
}
