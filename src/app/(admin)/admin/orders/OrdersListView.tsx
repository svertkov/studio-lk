'use client'

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import { format, parseISO, startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, subMonths, isWithinInterval } from 'date-fns'
import { ru } from 'date-fns/locale'
import { Search, Plus, Table2, ArrowUp, ArrowDown, ArrowUpDown, Cloud, CloudOff, Server } from 'lucide-react'
import GlowPill from '@/components/ui/glow-pill'
import type { OrderDTO } from '@/lib/actions/orders'
import {
  ORDER_BOARD_COLUMNS, ORDER_STATUS_LABELS, getOrderStatusConfig, getOrderStatusVars,
  ORDER_PAYMENT_STATUS_LABELS, ORDER_PAYMENT_STATUS_COLORS,
  orderTableDate, compareOrdersForTable, orderTableSearchHaystack,
  orderShootDisplay, orderDurationSecondaryLabel,
  getOrdersTableTier, type OrdersTableTier,
  groupOrdersByMonth, getHiddenMonthsCount, pluralizeOrdersCount,
  ORDERS_MONTHS_INITIAL_VISIBLE, ORDERS_MONTHS_REVEAL_STEP,
  type OrderTableSortKey, type SortDirection,
} from '@/lib/order-model'
import { getOrderPaymentSummary } from '@/lib/payment-model'
import { formatDurationMinutes } from '@/lib/schedule-model'
import { computeMaterialsCapsules } from '@/lib/client-shoots-model'
import { isValidHttpUrl } from '@/lib/url'
import { ROOM_DICTIONARY, FORMAT_DICTIONARY } from '@/lib/import/normalize'
import { getOrderPromotion, getVisibleOrderComment, PROMOTION_PILL_LABEL } from '@/lib/promotion-model'
import type { OrderStatus, OrderPaymentStatus } from '@prisma/client'
import OrderFormModal from '../crm/OrderFormModal'
import OrderCard from '../crm/OrderCard'

type Period = 'ALL' | 'TODAY' | 'WEEK' | 'MONTH' | 'PREV_MONTH' | 'CUSTOM'
type TriFilter = 'ANY' | 'YES' | 'NO'

// Единая сетка колонок для заголовка и строк — CSS Grid, не HTML-таблица (та
// же техника, что и в "Истории съёмок" на карточке клиента, см.
// ClientTabs.tsx: SHOOTS_GRID_COLS). 8 колонок в 'full' (обычный десктоп,
// включая 1280px — см. getOrdersTableTier в order-model.ts), 7 в 'compact'
// (без "Комментарий" — узкое окно ноутбука/планшет). minmax(px, fr) не даёт
// колонке сжаться меньше указанного и одновременно съедает лишнее место через
// fr, поэтому сумма минимумов — единственное, что может вызвать overflow, и
// она подобрана и проверена вживую с запасом под 1280px (см. комментарий у
// getOrdersTableTier).
const FULL_GRID_COLS =
  'grid-cols-[minmax(100px,0.85fr)_minmax(100px,1fr)_minmax(110px,1.05fr)_minmax(80px,0.65fr)_minmax(100px,0.85fr)_minmax(126px,0.75fr)_minmax(110px,0.95fr)_minmax(110px,1.3fr)]'
const COMPACT_GRID_COLS =
  'grid-cols-[minmax(100px,0.95fr)_minmax(100px,1.1fr)_minmax(110px,1.15fr)_minmax(80px,0.7fr)_minmax(100px,0.95fr)_minmax(126px,0.85fr)_minmax(110px,1.05fr)]'

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
        sortDir === 'asc' ? <ArrowUp className="w-3 h-3 flex-shrink-0" /> : <ArrowDown className="w-3 h-3 flex-shrink-0" />
      ) : <ArrowUpDown className="w-3 h-3 opacity-30 flex-shrink-0" />}
    </button>
  )
}

function StatusBadge({ status }: { status: OrderStatus }) {
  const config = getOrderStatusConfig(status)
  return (
    <span
      style={getOrderStatusVars(status) as CSSProperties}
      className="inline-flex max-w-full items-center gap-1.5 text-zinc-300 text-xs font-medium px-2 py-0.5 rounded-full border border-[color:var(--status-border)] bg-zinc-900/60"
    >
      <span className="w-1.5 h-1.5 rounded-full bg-[color:var(--status-color)] flex-shrink-0" />
      <span className="truncate">{config.label}</span>
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

  // flex-wrap — плашки идут в ряд, если хватает ширины колонки, и переносятся
  // друг под друга, если нет (см. ТЗ п.6) — сама колонка при этом не
  // расширяется, потому что у ячейки задан min-w-0 (см. Cell ниже).
  return (
    <div className="flex flex-wrap items-center gap-1 min-w-0">
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

// Комментарий — максимум одна строка на десктопе (ТЗ п.7): промо-плашка
// (если есть) и текст комментария в одной flex-строке, у текста truncate —
// ни плашка, ни длинный текст не могут расширить саму колонку, потому что
// родительская ячейка имеет min-w-0. Полный текст — через нативный title
// (тот же приём tooltip, что и в остальной таблице/carточке клиента) и целиком
// в карточке заказа.
function CommentCell({ order }: { order: OrderDTO }) {
  // Акция и обычный комментарий больше не дублируются: капсула читает
  // структурированную/распознанную акцию (getOrderPromotion), а текст рядом —
  // уже ОЧИЩЕННЫЙ от акционной фразы комментарий (getVisibleOrderComment).
  // Раньше здесь рендерился один и тот же order.comment целиком рядом с
  // капсулой — если акция определялась текстом внутри него, полная фраза
  // "Акция! 20% скидка..." показывалась second раз рядом с капсулой И
  // выталкивала её за пределы ячейки (см. src/lib/promotion-model.ts).
  const promotion = getOrderPromotion(order)
  const visibleComment = getVisibleOrderComment(order)
  if (!visibleComment && !promotion) return <span className="text-zinc-600 text-xs">—</span>
  return (
    <div className="flex items-center gap-1.5 min-w-0" title={visibleComment ?? undefined}>
      {promotion && (
        <GlowPill color="green" className="flex-shrink-0" title="Акция «−20% первый визит»">{PROMOTION_PILL_LABEL[promotion]}</GlowPill>
      )}
      {visibleComment && <span className="text-zinc-400 text-xs truncate min-w-0">{visibleComment}</span>}
    </div>
  )
}

// Общий контракт ячейки: min-w-0 обязателен на КАЖДОЙ — без него браузер
// считает intrinsic-ширину содержимого (длинный текст, несколько плашек) как
// нижнюю границу трека CSS Grid и раздвигает колонки вместо того, чтобы дать
// сработать truncate/ellipsis/flex-wrap внутри (ТЗ п.12 — самая частая причина
// horizontal overflow в таблицах на CSS Grid).
function Cell({ children, className = '', onClick }: {
  children: React.ReactNode; className?: string; onClick?: (e: React.MouseEvent) => void
}) {
  return <div role="cell" onClick={onClick} className={`min-w-0 px-2.5 py-2.5 ${className}`}>{children}</div>
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
  // Раздел "Заказы" — полный исторический архив студии (может быть несколько
  // сотен заказов за всё время, см. scripts/promote-visits-to-orders), поэтому
  // список группируется по календарному месяцу и рендерится не целиком сразу,
  // а по несколько последних месяцев — остальные подгружаются по кнопке
  // "Показать более ранние месяцы" (см. groupOrdersByMonth, order-model.ts).
  const [visibleMonthsCount, setVisibleMonthsCount] = useState(ORDERS_MONTHS_INITIAL_VISIBLE)

  const [editingOrder, setEditingOrder] = useState<OrderDTO | null>(null)
  const [creating, setCreating] = useState(false)

  // Уровень таблицы решается по РЕАЛЬНО измеренной ширине контейнера, не по
  // viewport (левое меню платформы фиксировано и не сворачивается — см.
  // комментарий у getOrdersTableTier в order-model.ts). 1200 — разумное
  // начальное предположение (полный десктопный вид) до первого замера, чтобы
  // не мигать мобильной вёрсткой на старте.
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(1200)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver(entries => {
      const width = entries[0]?.contentRect.width
      if (width) setContainerWidth(width)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  const tier: OrdersTableTier = getOrdersTableTier(containerWidth)

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
      if (paymentFilter !== 'ALL' && getOrderPaymentSummary(o).paymentStatus !== paymentFilter) return false
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

  // Группировка — уже по ПОЛНОСТЬЮ отфильтрованному/отсортированному набору
  // (поиск и фильтры действуют по всей истории, не только по показанным
  // месяцам) — прогрессивно рендерится только несколько последних месяцев.
  const monthGroups = useMemo(() => groupOrdersByMonth(sorted), [sorted])
  const visibleMonthGroups = monthGroups.slice(0, visibleMonthsCount)
  const hiddenMonthsCount = getHiddenMonthsCount(monthGroups.length, visibleMonthsCount)


  const hasActiveFilters = !!search || period !== 'ALL' || roomFilter !== 'ALL' || formatFilter !== 'ALL' || statusFilter !== 'ALL' ||
    paymentFilter !== 'ALL' || materialsFilter !== 'ANY' || nasFilter !== 'ANY' || editingFilter !== 'ANY' || makeupFilter !== 'ANY'

  function resetFilters() {
    setSearch(''); setPeriod('ALL'); setCustomFrom(''); setCustomTo('')
    setRoomFilter('ALL'); setFormatFilter('ALL'); setStatusFilter('ALL'); setPaymentFilter('ALL')
    setMaterialsFilter('ANY'); setNasFilter('ANY'); setEditingFilter('ANY'); setMakeupFilter('ANY')
  }

  function handleChanged() {
    router.refresh()
  }

  function openOrder(order: OrderDTO) {
    setEditingOrder(order)
  }

  const triLabel: Record<TriFilter, string> = { ANY: 'Любые', YES: 'Есть', NO: 'Нет' }

  return (
    <div className="space-y-4">
      {/* Фильтры — первый ряд: поиск + основные select'ы, кнопка создания
          справа. flex-wrap сам переносит их на вторую строку на узком
          ноутбуке (ТЗ п.15), явных media query для этого не нужно. */}
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Клиент, телефон, Telegram, email, компания..."
            className="w-full bg-zinc-900 border border-zinc-800 text-zinc-100 placeholder-zinc-600 rounded-lg pl-9 pr-3 py-2.5 text-sm outline-none focus:border-zinc-600 transition-colors"
          />
        </div>
        <select value={period} onChange={e => setPeriod(e.target.value as Period)}
          className="flex-shrink-0 bg-zinc-900 border border-zinc-800 text-zinc-300 text-sm rounded-lg px-3 py-2.5 outline-none focus:border-zinc-600 cursor-pointer">
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
              className="flex-shrink-0 bg-zinc-900 border border-zinc-800 text-zinc-300 text-sm rounded-lg px-3 py-2.5 outline-none focus:border-zinc-600" />
            <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
              className="flex-shrink-0 bg-zinc-900 border border-zinc-800 text-zinc-300 text-sm rounded-lg px-3 py-2.5 outline-none focus:border-zinc-600" />
          </>
        )}
        <select value={roomFilter} onChange={e => setRoomFilter(e.target.value)}
          className="flex-shrink-0 bg-zinc-900 border border-zinc-800 text-zinc-300 text-sm rounded-lg px-3 py-2.5 outline-none focus:border-zinc-600 cursor-pointer">
          <option value="ALL">Все залы</option>
          {ROOM_DICTIONARY.map(r => <option key={r.canonical} value={r.canonical}>{r.canonical}</option>)}
        </select>
        <select value={formatFilter} onChange={e => setFormatFilter(e.target.value)}
          className="flex-shrink-0 bg-zinc-900 border border-zinc-800 text-zinc-300 text-sm rounded-lg px-3 py-2.5 outline-none focus:border-zinc-600 cursor-pointer">
          <option value="ALL">Все форматы</option>
          {FORMAT_DICTIONARY.map(f => <option key={f.canonical} value={f.canonical}>{f.canonical}</option>)}
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as OrderStatus | 'ALL')}
          className="flex-shrink-0 bg-zinc-900 border border-zinc-800 text-zinc-300 text-sm rounded-lg px-3 py-2.5 outline-none focus:border-zinc-600 cursor-pointer">
          <option value="ALL">Все статусы</option>
          {ORDER_BOARD_COLUMNS.map(s => <option key={s} value={s}>{ORDER_STATUS_LABELS[s]}</option>)}
        </select>
        <select value={paymentFilter} onChange={e => setPaymentFilter(e.target.value as OrderPaymentStatus | 'ALL')}
          className="flex-shrink-0 bg-zinc-900 border border-zinc-800 text-zinc-300 text-sm rounded-lg px-3 py-2.5 outline-none focus:border-zinc-600 cursor-pointer">
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

      {/* Второй ряд — второстепенные тумблер-фильтры + сброс + счётчик. */}
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
        {hasActiveFilters && (
          <button type="button" onClick={resetFilters} className="text-xs text-zinc-500 hover:text-white underline">
            Сбросить фильтры
          </button>
        )}
        <span className="text-zinc-500 text-xs ml-auto flex-shrink-0">Найдено: {sorted.length} заказов</span>
      </div>

      {/* containerRef живёт на ОДНОМ всегда отрендеренном узле-обёртке —
          не на условно рендерящихся ветках ниже (пустое состояние / мобильный
          список / десктопная таблица). ResizeObserver подписывается на DOM-узел
          один раз при монтировании (см. эффект выше); если бы ref прыгал между
          разными элементами при смене tier, обсервер продолжил бы слушать уже
          отмонтированный старый узел и переставал бы обновлять containerWidth. */}
      <div ref={containerRef} className="w-full min-w-0">
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
      ) : tier === 'mobile' ? (
        // Мобильный/узкий вид — переиспользует ту же карточку заказа, что и
        // канбан CRM (OrderCard), а не отдельную мобильную вёрстку с нуля
        // (ТЗ п.18: "используй существующий мобильный паттерн проекта").
        // Группировка по месяцам сохраняется и здесь — просто без табличной сетки.
        <div className="space-y-4">
          {visibleMonthGroups.map(group => (
            <div key={group.key} className="space-y-2.5">
              <p className="text-zinc-400 text-xs font-semibold uppercase tracking-wide px-0.5">
                {group.label} · {pluralizeOrdersCount(group.orders.length)}
              </p>
              {group.orders.map(order => (
                <OrderCard key={order.id} order={order} onClick={() => openOrder(order)} />
              ))}
            </div>
          ))}
          {hiddenMonthsCount > 0 && (
            <button type="button" onClick={() => setVisibleMonthsCount(c => c + ORDERS_MONTHS_REVEAL_STEP)}
              className="w-full text-center text-sm text-zinc-400 hover:text-white underline py-2">
              Показать более ранние месяцы ({hiddenMonthsCount})
            </button>
          )}
        </div>
      ) : (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          {/* width:100% + min-w-0 — сетка никогда не задаёт контейнеру
              собственную минимальную ширину больше, чем у него есть (ТЗ п.12).
              overflow-x-auto оставлен подстраховкой на случай непредвиденно
              длинного контента, но при верных minmax-порогах не должен
              когда-либо реально включаться на проверяемых разрешениях. */}
          <div className="w-full min-w-0 overflow-x-auto">
            <div role="table" aria-label="Заказы" className="w-full min-w-0">
              <div role="row" className={`grid ${tier === 'compact' ? COMPACT_GRID_COLS : FULL_GRID_COLS} gap-x-3 border-b border-zinc-800 bg-zinc-800/40`}>
                <div role="columnheader" className="min-w-0 px-2.5 py-2.5 text-zinc-400 text-xs uppercase tracking-wider">
                  <SortBtn k="date" label="Дата" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
                </div>
                <div role="columnheader" className="min-w-0 px-2.5 py-2.5 text-zinc-400 text-xs uppercase tracking-wider">
                  <SortBtn k="client" label="Клиент" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
                </div>
                <div role="columnheader" className="min-w-0 px-2.5 py-2.5 text-zinc-400 text-xs uppercase tracking-wider">Съёмка</div>
                <div role="columnheader" className="min-w-0 px-2.5 py-2.5 text-zinc-400 text-xs uppercase tracking-wider">
                  <SortBtn k="duration" label="Длит-ть" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
                </div>
                <div role="columnheader" className="min-w-0 px-2.5 py-2.5 text-zinc-400 text-xs uppercase tracking-wider">
                  <SortBtn k="amount" label="Оплата" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
                </div>
                <div role="columnheader" className="min-w-0 px-2.5 py-2.5 text-zinc-400 text-xs uppercase tracking-wider">
                  <SortBtn k="status" label="Статус" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
                </div>
                <div role="columnheader" className="min-w-0 px-2.5 py-2.5 text-zinc-400 text-xs uppercase tracking-wider">Материалы</div>
                {tier === 'full' && (
                  <div role="columnheader" className="min-w-0 px-2.5 py-2.5 text-zinc-400 text-xs uppercase tracking-wider">Комментарий</div>
                )}
              </div>

              {visibleMonthGroups.map(group => (
                <div key={group.key}>
                  <div className="px-3 py-2 bg-zinc-800/60 border-b border-t border-zinc-800/80 first:border-t-0">
                    <span className="text-zinc-300 text-xs font-semibold uppercase tracking-wide">{group.label}</span>
                    <span className="text-zinc-500 text-xs ml-2">{pluralizeOrdersCount(group.orders.length)}</span>
                  </div>
                  <div role="rowgroup">
                    {group.orders.map(order => {
                      const dateIso = orderTableDate(order)
                      const timeRange = formatTimeRange(order.plannedStartTime, order.plannedEndTime)
                      const shoot = orderShootDisplay(order)
                      const makeupLabel = orderDurationSecondaryLabel(order)
                      const payment = getOrderPaymentSummary(order)
                      const rowLabel = `Открыть заказ: ${order.clientName || order.title || 'клиент не привязан'}, ${formatDate(dateIso)}`
                      return (
                        <div
                          key={order.id}
                          role="row"
                          tabIndex={0}
                          aria-label={rowLabel}
                          onClick={() => openOrder(order)}
                          onKeyDown={e => {
                            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openOrder(order) }
                          }}
                          className={`grid ${tier === 'compact' ? COMPACT_GRID_COLS : FULL_GRID_COLS} gap-x-3 items-center border-b border-zinc-800/60 last:border-b-0 cursor-pointer transition-colors hover:bg-white/[0.04] focus:outline-none focus-visible:bg-white/[0.05] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#00c26b] focus-visible:-outline-offset-1`}
                        >
                          <Cell>
                            <p className="text-zinc-200 text-sm truncate">{formatDate(dateIso)}</p>
                            {timeRange && <p className="text-zinc-500 text-xs mt-0.5 truncate">{timeRange}</p>}
                          </Cell>
                          <Cell>
                            <p className="text-zinc-100 text-sm truncate">{order.clientName || order.title || 'Клиент не привязан'}</p>
                            {order.companyName && <p className="text-zinc-500 text-xs mt-0.5 truncate">{order.companyName}</p>}
                          </Cell>
                          <Cell>
                            <p className="text-zinc-200 text-sm truncate" title={shoot.format}>{shoot.format}</p>
                            {shoot.room && <p className="text-zinc-500 text-xs mt-0.5 truncate">{shoot.room}</p>}
                          </Cell>
                          <Cell>
                            <p className="text-zinc-300 text-sm truncate">{order.durationMinutes != null ? formatDurationMinutes(order.durationMinutes) : '—'}</p>
                            {makeupLabel && <p className="text-zinc-500 text-xs mt-0.5 truncate" title={makeupLabel}>{makeupLabel}</p>}
                          </Cell>
                          <Cell>
                            <p className="text-zinc-200 text-sm truncate">{payment.displayPrimary}</p>
                            <p className={`text-xs mt-0.5 truncate ${ORDER_PAYMENT_STATUS_COLORS[payment.paymentStatus]}`}>{payment.displaySecondary}</p>
                          </Cell>
                          <Cell><StatusBadge status={order.status} /></Cell>
                          <Cell onClick={e => e.stopPropagation()}><MaterialsCell order={order} /></Cell>
                          {tier === 'full' && <Cell><CommentCell order={order} /></Cell>}
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
          {hiddenMonthsCount > 0 && (
            <div className="px-4 py-3 border-t border-zinc-800 text-center">
              <button type="button" onClick={() => setVisibleMonthsCount(c => c + ORDERS_MONTHS_REVEAL_STEP)} className="text-sm text-zinc-400 hover:text-white underline">
                Показать более ранние месяцы ({hiddenMonthsCount})
              </button>
            </div>
          )}
        </div>
      )}
      </div>

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
