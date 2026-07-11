'use client'

import { useMemo, useState, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import { format, parseISO, startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, subMonths, isWithinInterval } from 'date-fns'
import { ru } from 'date-fns/locale'
import {
  Search, Plus, Table2, ArrowUp, ArrowDown, ArrowUpDown, Cloud, CloudOff, Server, Clock,
} from 'lucide-react'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import GlowPill from '@/components/ui/glow-pill'
import type { OrderDTO } from '@/lib/actions/orders'
import {
  ORDER_BOARD_COLUMNS, ORDER_STATUS_LABELS, getOrderStatusConfig, getOrderStatusVars,
  ORDER_PAYMENT_STATUS_LABELS, ORDER_PAYMENT_STATUS_COLORS,
  orderTableDate, compareOrdersForTable, orderTableSearchHaystack,
  type OrderTableSortKey, type SortDirection,
} from '@/lib/order-model'
import {
  formatDurationMinutes, formatMakeupBadgeLabel, QUICK_COMMENT_TEMPLATES, hasQuickCommentTemplate,
} from '@/lib/schedule-model'
import { computeMaterialsCapsules, getVisibleShoots, getHiddenShootsCount } from '@/lib/client-shoots-model'
import { isValidHttpUrl } from '@/lib/url'
import { ROOM_DICTIONARY, FORMAT_DICTIONARY } from '@/lib/import/normalize'
import type { OrderStatus, OrderPaymentStatus } from '@prisma/client'
import OrderFormModal from '../crm/OrderFormModal'

const PROMO_TEMPLATE_TEXT = QUICK_COMMENT_TEMPLATES[0]?.text
const TABLE_DEFAULT_LIMIT = 25

type Period = 'ALL' | 'TODAY' | 'WEEK' | 'MONTH' | 'PREV_MONTH' | 'CUSTOM'
type TriFilter = 'ANY' | 'YES' | 'NO'

function formatMoney(v: number | null) {
  if (v == null) return null
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(v)
}

function formatDate(iso: string) {
  try { return format(parseISO(iso), 'd MMM yyyy', { locale: ru }) } catch { return '—' }
}

function formatTimeRange(startIso: string | null, endIso: string | null): string | null {
  if (!startIso || !endIso) return null
  const fmt = (v: string) => format(parseISO(v), 'HH:mm')
  return `${fmt(startIso)}–${fmt(endIso)}`
}

// Диапазон дат текущего периода — граница периода считается по
// orderTableDate заказа (плановая дата записи, иначе дата создания заявки),
// см. order-model.ts.
function periodRange(period: Period, customFrom: string, customTo: string): { start: Date; end: Date } | null {
  const now = new Date()
  switch (period) {
    case 'ALL': return null
    case 'TODAY': return { start: startOfDay(now), end: endOfDay(now) }
    case 'WEEK': return { start: startOfWeek(now, { weekStartsOn: 1 }), end: endOfWeek(now, { weekStartsOn: 1 }) }
    case 'MONTH': return { start: startOfMonth(now), end: endOfMonth(now) }
    case 'PREV_MONTH': {
      const prev = subMonths(now, 1)
      return { start: startOfMonth(prev), end: endOfMonth(prev) }
    }
    case 'CUSTOM': {
      if (!customFrom || !customTo) return null
      return { start: startOfDay(new Date(customFrom)), end: endOfDay(new Date(customTo)) }
    }
  }
}

// Вынесен на уровень модуля — иначе React считал бы кнопку сортировки новым
// типом компонента на каждый рендер родителя (см. тот же приём в
// ClientsSection.tsx: SortBtn).
function SortBtn({ k, label, sortKey, sortDir, onToggle }: {
  k: OrderTableSortKey; label: string; sortKey: OrderTableSortKey; sortDir: SortDirection; onToggle: (k: OrderTableSortKey) => void
}) {
  const isActive = sortKey === k
  return (
    <button type="button" onClick={() => onToggle(k)} className="flex items-center gap-1 hover:text-white transition-colors">
      {label}
      {isActive ? (
        sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
      ) : <ArrowUpDown className="w-3 h-3 opacity-30" />}
    </button>
  )
}

function StatusBadge({ status }: { status: OrderStatus }) {
  const config = getOrderStatusConfig(status)
  return (
    <span
      style={getOrderStatusVars(status) as CSSProperties}
      className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full border border-[color:var(--status-border)] bg-zinc-900/60 whitespace-nowrap"
    >
      <span className="w-1.5 h-1.5 rounded-full bg-[color:var(--status-color)] flex-shrink-0" />
      {config.label}
    </span>
  )
}

function MaterialsCell({ order }: { order: OrderDTO }) {
  const yandexUrl = isValidHttpUrl(order.yandexDiskUrl) ? order.yandexDiskUrl : null
  const nasUrl = isValidHttpUrl(order.nasBackupUrl) ? order.nasBackupUrl : null
  const state = computeMaterialsCapsules({
    yandexDiskUrl: yandexUrl,
    yandexDiskUrlExpiresAt: order.yandexDiskUrlExpiresAt ? new Date(order.yandexDiskUrlExpiresAt) : null,
    nasBackupUrl: nasUrl,
  })

  if (!state.yandex && !state.nas) {
    return <span className="text-zinc-600 text-xs">Нет материалов</span>
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      {state.yandex === 'active' && (
        <GlowPill as="a" href={yandexUrl!} color="green" icon={Cloud} onClick={e => e.stopPropagation()}
          title="Открыть материалы на Яндекс.Диске" ariaLabel="Открыть материалы на Яндекс.Диске">
          Яндекс.Диск
        </GlowPill>
      )}
      {state.yandex === 'expired' && (
        <GlowPill as="button" disabled color="zinc" icon={CloudOff}
          title="Срок хранения истёк" ariaLabel="Материалы на Яндекс.Диске недоступны — срок хранения истёк">
          Яндекс.Диск
        </GlowPill>
      )}
      {state.nas === 'active' && (
        <GlowPill as="a" href={nasUrl!} color="violet" icon={Server} onClick={e => e.stopPropagation()}
          title="Открыть резервную копию на NAS" ariaLabel="Открыть резервную копию на NAS">
          NAS
        </GlowPill>
      )}
    </div>
  )
}

function CommentCell({ order }: { order: OrderDTO }) {
  const hasPromo = !!order.comment && !!PROMO_TEMPLATE_TEXT && hasQuickCommentTemplate(order.comment, PROMO_TEMPLATE_TEXT)
  if (!order.comment && !hasPromo) return <span className="text-zinc-600 text-xs">—</span>
  return (
    <div className="min-w-0 max-w-[240px] space-y-1">
      {hasPromo && (
        <GlowPill color="green" title="Упомянуто в комментарии заказа">Первая запись −20%</GlowPill>
      )}
      {order.comment && (
        <p className="text-zinc-400 text-xs leading-snug line-clamp-2" title={order.comment}>{order.comment}</p>
      )}
    </div>
  )
}

interface Props {
  initialOrders: OrderDTO[]
}

export default function OrdersListView({ initialOrders }: Props) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [period, setPeriod] = useState<Period>('ALL')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [roomFilter, setRoomFilter] = useState('ALL')
  const [formatFilter, setFormatFilter] = useState('ALL')
  const [statusFilter, setStatusFilter] = useState<OrderStatus | 'ALL'>('ALL')
  const [paymentFilter, setPaymentFilter] = useState<OrderPaymentStatus | 'ALL'>('ALL')
  const [materialsFilter, setMaterialsFilter] = useState<TriFilter>('ANY')
  const [nasFilter, setNasFilter] = useState<TriFilter>('ANY')
  const [editingFilter, setEditingFilter] = useState<TriFilter>('ANY')
  const [makeupFilter, setMakeupFilter] = useState<TriFilter>('ANY')

  const [sortKey, setSortKey] = useState<OrderTableSortKey>('date')
  const [sortDir, setSortDir] = useState<SortDirection>('desc')
  const [expanded, setExpanded] = useState(false)

  const [editingOrder, setEditingOrder] = useState<OrderDTO | null>(null)
  const [creating, setCreating] = useState(false)

  function toggleSort(key: OrderTableSortKey) {
    if (key === sortKey) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir(key === 'client' ? 'asc' : 'desc') }
  }

  function cycleTri(v: TriFilter): TriFilter {
    return v === 'ANY' ? 'YES' : v === 'YES' ? 'NO' : 'ANY'
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const range = periodRange(period, customFrom, customTo)
    return initialOrders.filter(o => {
      if (q && !orderTableSearchHaystack(o).includes(q)) return false
      if (range && !isWithinInterval(new Date(orderTableDate(o)), range)) return false
      if (roomFilter !== 'ALL' && o.room !== roomFilter) return false
      if (formatFilter !== 'ALL' && o.serviceType !== formatFilter) return false
      if (statusFilter !== 'ALL' && o.status !== statusFilter) return false
      if (paymentFilter !== 'ALL' && o.paymentStatus !== paymentFilter) return false
      if (materialsFilter !== 'ANY' && o.hasMaterials !== (materialsFilter === 'YES')) return false
      if (nasFilter !== 'ANY' && !!o.nasBackupUrl !== (nasFilter === 'YES')) return false
      if (editingFilter !== 'ANY' && (o.editingRequired === true) !== (editingFilter === 'YES')) return false
      const hasMakeup = o.makeupDurationMinutes != null && o.makeupDurationMinutes > 0
      if (makeupFilter !== 'ANY' && hasMakeup !== (makeupFilter === 'YES')) return false
      return true
    })
  }, [initialOrders, search, period, customFrom, customTo, roomFilter, formatFilter, statusFilter, paymentFilter, materialsFilter, nasFilter, editingFilter, makeupFilter])

  const sorted = useMemo(
    () => [...filtered].sort((a, b) => compareOrdersForTable(a, b, sortKey, sortDir)),
    [filtered, sortKey, sortDir],
  )

  const visible = getVisibleShoots(sorted, expanded, TABLE_DEFAULT_LIMIT)
  const hiddenCount = getHiddenShootsCount(sorted.length, TABLE_DEFAULT_LIMIT)

  function resetFilters() {
    setSearch(''); setPeriod('ALL'); setCustomFrom(''); setCustomTo('')
    setRoomFilter('ALL'); setFormatFilter('ALL'); setStatusFilter('ALL'); setPaymentFilter('ALL')
    setMaterialsFilter('ANY'); setNasFilter('ANY'); setEditingFilter('ANY'); setMakeupFilter('ANY')
  }

  function handleChanged() {
    router.refresh()
  }

  const triLabel: Record<TriFilter, string> = { ANY: 'Любые', YES: 'Есть', NO: 'Нет' }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-56">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Клиент, телефон, Telegram, email, компания, комментарий..."
            className="w-full bg-zinc-900 border border-zinc-800 text-zinc-100 placeholder-zinc-600 rounded-lg pl-9 pr-3 py-2.5 text-sm outline-none focus:border-zinc-600 transition-colors"
          />
        </div>
        <select value={period} onChange={e => setPeriod(e.target.value as Period)}
          className="bg-zinc-900 border border-zinc-800 text-zinc-300 text-sm rounded-lg px-3 py-2.5 outline-none focus:border-zinc-600 cursor-pointer">
          <option value="ALL">Всё время</option>
          <option value="TODAY">Сегодня</option>
          <option value="WEEK">Текущая неделя</option>
          <option value="MONTH">Текущий месяц</option>
          <option value="PREV_MONTH">Предыдущий месяц</option>
          <option value="CUSTOM">Произвольный диапазон</option>
        </select>
        {period === 'CUSTOM' && (
          <>
            <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
              className="bg-zinc-900 border border-zinc-800 text-zinc-300 text-sm rounded-lg px-3 py-2.5 outline-none focus:border-zinc-600" />
            <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
              className="bg-zinc-900 border border-zinc-800 text-zinc-300 text-sm rounded-lg px-3 py-2.5 outline-none focus:border-zinc-600" />
          </>
        )}
        <select value={roomFilter} onChange={e => setRoomFilter(e.target.value)}
          className="bg-zinc-900 border border-zinc-800 text-zinc-300 text-sm rounded-lg px-3 py-2.5 outline-none focus:border-zinc-600 cursor-pointer">
          <option value="ALL">Все залы</option>
          {ROOM_DICTIONARY.map(r => <option key={r.canonical} value={r.canonical}>{r.canonical}</option>)}
        </select>
        <select value={formatFilter} onChange={e => setFormatFilter(e.target.value)}
          className="bg-zinc-900 border border-zinc-800 text-zinc-300 text-sm rounded-lg px-3 py-2.5 outline-none focus:border-zinc-600 cursor-pointer">
          <option value="ALL">Все форматы</option>
          {FORMAT_DICTIONARY.map(f => <option key={f.canonical} value={f.canonical}>{f.canonical}</option>)}
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as OrderStatus | 'ALL')}
          className="bg-zinc-900 border border-zinc-800 text-zinc-300 text-sm rounded-lg px-3 py-2.5 outline-none focus:border-zinc-600 cursor-pointer">
          <option value="ALL">Все статусы</option>
          {ORDER_BOARD_COLUMNS.map(s => <option key={s} value={s}>{ORDER_STATUS_LABELS[s]}</option>)}
        </select>
        <select value={paymentFilter} onChange={e => setPaymentFilter(e.target.value as OrderPaymentStatus | 'ALL')}
          className="bg-zinc-900 border border-zinc-800 text-zinc-300 text-sm rounded-lg px-3 py-2.5 outline-none focus:border-zinc-600 cursor-pointer">
          <option value="ALL">Любая оплата</option>
          {(Object.keys(ORDER_PAYMENT_STATUS_LABELS) as OrderPaymentStatus[]).map(s => (
            <option key={s} value={s}>{ORDER_PAYMENT_STATUS_LABELS[s]}</option>
          ))}
        </select>
        <button type="button" onClick={() => setCreating(true)}
          className="flex items-center gap-1.5 bg-[#00c26b] hover:bg-[#00b360] text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors flex-shrink-0 ml-auto">
          <Plus className="w-4 h-4" />
          Создать заказ
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {([
          ['Материалы', materialsFilter, setMaterialsFilter],
          ['NAS', nasFilter, setNasFilter],
          ['Монтаж', editingFilter, setEditingFilter],
          ['Гримёр', makeupFilter, setMakeupFilter],
        ] as const).map(([label, value, setValue]) => (
          <button
            key={label}
            type="button"
            onClick={() => setValue(cycleTri(value))}
            className={`text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors ${
              value === 'ANY'
                ? 'border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-700'
                : value === 'YES'
                  ? 'border-emerald-700 text-emerald-400 bg-emerald-950/30'
                  : 'border-red-900 text-red-400 bg-red-950/20'
            }`}
          >
            {label}: {triLabel[value]}
          </button>
        ))}
        {(search || period !== 'ALL' || roomFilter !== 'ALL' || formatFilter !== 'ALL' || statusFilter !== 'ALL' ||
          paymentFilter !== 'ALL' || materialsFilter !== 'ANY' || nasFilter !== 'ANY' || editingFilter !== 'ANY' || makeupFilter !== 'ANY') && (
          <button type="button" onClick={resetFilters} className="text-xs text-zinc-500 hover:text-white underline">
            Сбросить фильтры
          </button>
        )}
        <span className="text-zinc-500 text-xs ml-auto">Найдено: {sorted.length} заказов</span>
      </div>

      {sorted.length === 0 ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-14 text-center">
          <Table2 className="w-10 h-10 text-zinc-600 mx-auto mb-4" />
          <p className="text-zinc-300 font-medium">
            {initialOrders.length === 0 ? 'Заказы не найдены' : 'По этим фильтрам ничего не найдено'}
          </p>
          <p className="text-zinc-500 text-sm mt-1.5">
            {initialOrders.length === 0 ? 'Измените параметры фильтра или создайте новый заказ' : 'Попробуйте изменить или сбросить фильтры'}
          </p>
          <button type="button" onClick={() => setCreating(true)}
            className="mt-4 inline-flex items-center gap-1.5 bg-[#00c26b] hover:bg-[#00b360] text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors">
            <Plus className="w-4 h-4" />
            Создать заказ
          </button>
        </div>
      ) : (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-zinc-800 hover:bg-transparent">
                  <TableHead className="text-zinc-400 text-xs uppercase tracking-wider whitespace-nowrap">
                    <SortBtn k="date" label="Дата и время" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
                  </TableHead>
                  <TableHead className="text-zinc-400 text-xs uppercase tracking-wider">
                    <SortBtn k="client" label="Клиент" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
                  </TableHead>
                  <TableHead className="text-zinc-400 text-xs uppercase tracking-wider">Зал</TableHead>
                  <TableHead className="text-zinc-400 text-xs uppercase tracking-wider">Формат</TableHead>
                  <TableHead className="text-zinc-400 text-xs uppercase tracking-wider whitespace-nowrap">
                    <SortBtn k="duration" label="Продолж-ть" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
                  </TableHead>
                  <TableHead className="text-zinc-400 text-xs uppercase tracking-wider">
                    <SortBtn k="amount" label="Стоимость" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
                  </TableHead>
                  <TableHead className="text-zinc-400 text-xs uppercase tracking-wider">Оплата</TableHead>
                  <TableHead className="text-zinc-400 text-xs uppercase tracking-wider">
                    <SortBtn k="status" label="Статус" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
                  </TableHead>
                  <TableHead className="text-zinc-400 text-xs uppercase tracking-wider">Материалы</TableHead>
                  <TableHead className="text-zinc-400 text-xs uppercase tracking-wider">Комментарий</TableHead>
                  <TableHead className="text-zinc-400 text-xs uppercase tracking-wider" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map(order => {
                  const dateIso = orderTableDate(order)
                  const timeRange = formatTimeRange(order.plannedStartTime, order.plannedEndTime)
                  const amount = formatMoney(order.preliminaryAmount)
                  const hasMakeup = order.makeupDurationMinutes != null && order.makeupDurationMinutes > 0
                  return (
                    <TableRow
                      key={order.id}
                      onClick={() => setEditingOrder(order)}
                      className="border-zinc-800 hover:bg-zinc-800/50 cursor-pointer"
                    >
                      <TableCell className="whitespace-nowrap">
                        <p className="text-zinc-200 text-sm">{formatDate(dateIso)}</p>
                        {timeRange && <p className="text-zinc-500 text-xs mt-0.5">{timeRange}</p>}
                      </TableCell>
                      <TableCell className="text-zinc-100 max-w-[180px]">
                        <p className="truncate">{order.clientName || order.title || 'Клиент не привязан'}</p>
                        {order.companyName && <p className="text-zinc-500 text-xs truncate">{order.companyName}</p>}
                      </TableCell>
                      <TableCell className="text-zinc-400 whitespace-nowrap">{order.room ?? '—'}</TableCell>
                      <TableCell className="text-zinc-400 whitespace-nowrap">{order.serviceType ?? '—'}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        <p className="text-zinc-300 text-sm">{order.durationMinutes != null ? formatDurationMinutes(order.durationMinutes) : '—'}</p>
                        {hasMakeup && (
                          <p className="text-zinc-500 text-xs mt-0.5 flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {formatMakeupBadgeLabel(order.makeupDurationMinutes!)}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-zinc-200 text-sm whitespace-nowrap">
                        {order.paymentStatus === 'SUBSCRIPTION' ? 'Абонемент' : amount ?? 'Нет данных'}
                      </TableCell>
                      <TableCell>
                        <span className={`text-xs font-medium whitespace-nowrap ${ORDER_PAYMENT_STATUS_COLORS[order.paymentStatus]}`}>
                          {ORDER_PAYMENT_STATUS_LABELS[order.paymentStatus]}
                        </span>
                      </TableCell>
                      <TableCell><StatusBadge status={order.status} /></TableCell>
                      <TableCell onClick={e => e.stopPropagation()}><MaterialsCell order={order} /></TableCell>
                      <TableCell><CommentCell order={order} /></TableCell>
                      <TableCell>
                        <button
                          type="button"
                          onClick={e => { e.stopPropagation(); setEditingOrder(order) }}
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
          {hiddenCount > 0 && (
            <div className="px-4 py-3 border-t border-zinc-800 text-center">
              <button type="button" onClick={() => setExpanded(true)} className="text-sm text-zinc-400 hover:text-white underline">
                Показать ещё {hiddenCount}
              </button>
            </div>
          )}
        </div>
      )}

      {creating && (
        <OrderFormModal order={null} onOpenChange={setCreating} onSaved={handleChanged} />
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
