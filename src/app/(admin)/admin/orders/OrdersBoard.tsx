'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Search, ShoppingBag } from 'lucide-react'
import { updateOrderStatus, type OrderDTO } from '@/lib/actions/orders'
import { ORDER_BOARD_COLUMNS, ORDER_STATUS_LABELS, type OrderStatus } from '@/lib/order-model'
import OrderCard from './OrderCard'
import OrderFormModal from './OrderFormModal'

interface Props {
  initialOrders: OrderDTO[]
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

  const byStatus = useMemo(() => {
    const map = new Map<OrderStatus, OrderDTO[]>()
    for (const s of ORDER_BOARD_COLUMNS) map.set(s, [])
    for (const o of filtered) {
      if (map.has(o.status)) map.get(o.status)!.push(o)
    }
    return map
  }, [filtered])

  function handleChanged() {
    router.refresh()
  }

  async function handleStatusChange(order: OrderDTO, status: OrderStatus) {
    setPendingStatus(prev => ({ ...prev, [order.id]: status }))
    const result = await updateOrderStatus(order.id, status)
    if (!result.ok) {
      setPendingStatus(prev => { const next = { ...prev }; delete next[order.id]; return next })
    } else {
      router.refresh()
    }
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
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="flex items-center gap-1.5 bg-[#00c26b] hover:bg-[#00b360] text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors flex-shrink-0"
        >
          <Plus className="w-4 h-4" />
          Создать заказ
        </button>
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
        <div className="flex gap-4 overflow-x-auto pb-2">
          {ORDER_BOARD_COLUMNS.map(columnStatus => {
            const columnOrders = byStatus.get(columnStatus) ?? []
            return (
              <div key={columnStatus} className="w-72 flex-shrink-0 flex flex-col bg-zinc-950/40 border border-zinc-800/80 rounded-xl">
                <div className="px-3.5 py-3 border-b border-zinc-800/80 flex items-center justify-between">
                  <h3 className="text-zinc-200 text-sm font-semibold">{ORDER_STATUS_LABELS[columnStatus]}</h3>
                  <span className="text-zinc-500 text-xs">{columnOrders.length}</span>
                </div>
                <div className="flex-1 min-h-[120px] max-h-[calc(100vh-320px)] overflow-y-auto p-2.5 space-y-2.5">
                  {columnOrders.length === 0 ? (
                    <p className="text-zinc-600 text-xs text-center py-6">Пусто</p>
                  ) : (
                    columnOrders.map(order => (
                      <div key={order.id} className="space-y-1.5">
                        <OrderCard order={order} onClick={() => setEditingOrder(order)} />
                        <select
                          value={order.status}
                          onChange={e => handleStatusChange(order, e.target.value as OrderStatus)}
                          onClick={e => e.stopPropagation()}
                          className="w-full bg-zinc-800 border border-zinc-700 text-zinc-400 rounded-lg px-2 py-1 text-[11px] outline-none focus:border-[#00c26b] cursor-pointer"
                        >
                          {ORDER_BOARD_COLUMNS.map(s => (
                            <option key={s} value={s}>{ORDER_STATUS_LABELS[s]}</option>
                          ))}
                        </select>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )
          })}
        </div>
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
    </div>
  )
}
