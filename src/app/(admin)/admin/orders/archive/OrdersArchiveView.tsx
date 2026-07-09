'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { format, parseISO } from 'date-fns'
import { ru } from 'date-fns/locale'
import { ArrowLeft, Search, Archive, Paperclip } from 'lucide-react'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import type { OrderDTO } from '@/lib/actions/orders'

type Tab = 'ALL' | 'COMPLETED' | 'CANCELLED'

const TABS: { value: Tab; label: string }[] = [
  { value: 'ALL', label: 'Все' },
  { value: 'COMPLETED', label: 'Завершённые' },
  { value: 'CANCELLED', label: 'Отказы' },
]

const FINAL_STATUS_BADGE: Record<'COMPLETED' | 'CANCELLED', string> = {
  COMPLETED: 'bg-green-950/40 border border-green-800 text-green-400',
  CANCELLED: 'bg-red-950/40 border border-red-900 text-red-300',
}

const FINAL_STATUS_LABEL: Record<'COMPLETED' | 'CANCELLED', string> = {
  COMPLETED: 'Завершено',
  CANCELLED: 'Отказ',
}

function formatMoney(v: number | null) {
  if (v == null) return '—'
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(v)
}

function formatDate(iso: string | null) {
  if (!iso) return '—'
  try { return format(parseISO(iso), 'd MMM yyyy', { locale: ru }) } catch { return '—' }
}

// Дата "заказа/съёмки" для колонки — если у заказа была запланирована
// студийная запись, показываем её дату, иначе дату создания заявки (у чисто
// отменённых на этапе "Заявка" заказов своей записи в расписании может не быть).
function orderDate(order: OrderDTO): string | null {
  return order.plannedStartTime ?? order.createdAt
}

// Дата, когда заказ пришёл к финальному статусу — единственное из двух полей
// действительно заполнено (см. isOrderReadyForArchive/updateOrderStatus:
// completedAt только для COMPLETED, rejectedAt только для CANCELLED).
function finalStatusDate(order: OrderDTO): string | null {
  return order.status === 'COMPLETED' ? order.completedAt : order.rejectedAt
}

// Одна строка поиска сразу по всем полям, которые просил спек: клиент,
// телефон, название/описание, зал, сумма — дата ищется отдельно как
// отформатированная строка, чтобы можно было ввести "6 июл" и найти нужный день.
function searchHaystack(order: OrderDTO): string {
  return [
    order.clientName, order.clientPhone, order.title, order.serviceType, order.comment,
    order.room, order.preliminaryAmount?.toString(), formatDate(orderDate(order)),
  ].filter(Boolean).join(' ').toLowerCase()
}

interface Props {
  initialOrders: OrderDTO[]
}

export default function OrdersArchiveView({ initialOrders }: Props) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('ALL')
  const [search, setSearch] = useState('')
  const [openOrder, setOpenOrder] = useState<OrderDTO | null>(null)
  // Динамический импорт формы заказа не нужен — она и так уже клиентский
  // компонент, но подключаем её лениво через state, чтобы не тянуть лишний
  // код в бандл архива, если карточку никто не открыл.
  const [OrderFormModal, setOrderFormModal] = useState<typeof import('../OrderFormModal').default | null>(null)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return initialOrders
      .filter(o => tab === 'ALL' || o.status === tab)
      .filter(o => !q || searchHaystack(o).includes(q))
      // Сначала самые новые архивные заказы — по archivedAt (все строки здесь
      // архивные, значит archivedAt у них всегда проставлен, см. archiveEligibleOrders).
      .sort((a, b) => new Date(b.archivedAt ?? 0).getTime() - new Date(a.archivedAt ?? 0).getTime())
  }, [initialOrders, tab, search])

  const counts = useMemo(() => ({
    ALL: initialOrders.length,
    COMPLETED: initialOrders.filter(o => o.status === 'COMPLETED').length,
    CANCELLED: initialOrders.filter(o => o.status === 'CANCELLED').length,
  }), [initialOrders])

  async function openCard(order: OrderDTO) {
    if (!OrderFormModal) {
      const mod = await import('../OrderFormModal')
      setOrderFormModal(() => mod.default)
    }
    setOpenOrder(order)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white">Архив заказов</h1>
          <p className="text-zinc-400 text-sm mt-1">Здесь хранятся завершённые заказы и отказы старше 7 дней.</p>
        </div>
        <Link
          href="/admin/orders"
          className="flex items-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 text-sm font-semibold px-4 py-2 rounded-lg transition-colors flex-shrink-0"
        >
          <ArrowLeft className="w-4 h-4" />
          К активным заказам
        </Link>
      </div>

      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-1.5 bg-zinc-900 border border-zinc-800 rounded-lg p-1">
          {TABS.map(t => (
            <button
              key={t.value}
              type="button"
              onClick={() => setTab(t.value)}
              className={`px-3.5 py-1.5 rounded-md text-sm font-medium transition-colors ${
                tab === t.value ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {t.label} <span className="text-zinc-500">· {counts[t.value]}</span>
            </button>
          ))}
        </div>
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Клиент, телефон, зал, сумма, дата..."
            className="w-full bg-zinc-900 border border-zinc-800 text-zinc-100 placeholder-zinc-600 rounded-lg pl-9 pr-3 py-2 text-sm outline-none focus:border-zinc-600 transition-colors"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-14 text-center">
          <Archive className="w-10 h-10 text-zinc-600 mx-auto mb-4" />
          <p className="text-zinc-300 font-medium">
            {initialOrders.length === 0 ? 'Архив пуст' : 'По этому фильтру ничего не найдено'}
          </p>
        </div>
      ) : (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-zinc-800 hover:bg-transparent">
                  <TableHead className="text-zinc-400 text-xs uppercase tracking-wider whitespace-nowrap">Дата заказа / съёмки</TableHead>
                  <TableHead className="text-zinc-400 text-xs uppercase tracking-wider">Клиент</TableHead>
                  <TableHead className="text-zinc-400 text-xs uppercase tracking-wider whitespace-nowrap">Тип заказа</TableHead>
                  <TableHead className="text-zinc-400 text-xs uppercase tracking-wider">Зал</TableHead>
                  <TableHead className="text-zinc-400 text-xs uppercase tracking-wider">Сумма</TableHead>
                  <TableHead className="text-zinc-400 text-xs uppercase tracking-wider whitespace-nowrap">Финальный статус</TableHead>
                  <TableHead className="text-zinc-400 text-xs uppercase tracking-wider whitespace-nowrap">Дата завершения / отказа</TableHead>
                  <TableHead className="text-zinc-400 text-xs uppercase tracking-wider">Причина отказа</TableHead>
                  <TableHead className="text-zinc-400 text-xs uppercase tracking-wider">Материалы</TableHead>
                  <TableHead className="text-zinc-400 text-xs uppercase tracking-wider" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(order => {
                  const finalStatus = order.status as 'COMPLETED' | 'CANCELLED'
                  return (
                    <TableRow key={order.id} className="border-zinc-800 hover:bg-zinc-800/50">
                      <TableCell className="text-zinc-300 whitespace-nowrap">{formatDate(orderDate(order))}</TableCell>
                      <TableCell className="text-zinc-100">{order.clientName || order.title || 'Без имени'}</TableCell>
                      <TableCell className="text-zinc-400">{order.serviceType ?? '—'}</TableCell>
                      <TableCell className="text-zinc-400">{order.room ?? '—'}</TableCell>
                      <TableCell className="text-zinc-300 whitespace-nowrap">{formatMoney(order.preliminaryAmount)}</TableCell>
                      <TableCell>
                        <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${FINAL_STATUS_BADGE[finalStatus]}`}>
                          {FINAL_STATUS_LABEL[finalStatus]}
                        </span>
                      </TableCell>
                      <TableCell className="text-zinc-400 whitespace-nowrap">{formatDate(finalStatusDate(order))}</TableCell>
                      <TableCell className="text-zinc-500 max-w-[200px] truncate">
                        {order.status === 'CANCELLED' ? (order.comment || '—') : '—'}
                      </TableCell>
                      <TableCell>
                        {order.hasMaterials ? (
                          <span className="inline-flex items-center gap-1 text-emerald-400 text-xs">
                            <Paperclip className="w-3.5 h-3.5" /> Есть
                          </span>
                        ) : (
                          <span className="text-zinc-600 text-xs">Нет</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <button
                          type="button"
                          onClick={() => openCard(order)}
                          className="text-xs font-semibold text-zinc-200 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap"
                        >
                          Открыть
                        </button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {openOrder && OrderFormModal && (
        <OrderFormModal
          order={openOrder}
          onOpenChange={open => { if (!open) setOpenOrder(null) }}
          onSaved={() => { setOpenOrder(null); router.refresh() }}
        />
      )}
    </div>
  )
}
