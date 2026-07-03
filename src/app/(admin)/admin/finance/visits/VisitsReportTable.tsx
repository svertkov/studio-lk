'use client'

import { useMemo, useState } from 'react'
import { format, parseISO, startOfMonth, endOfMonth, subMonths } from 'date-fns'
import { ru } from 'date-fns/locale'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { ArrowUp, ArrowDown, ArrowUpDown, Search, X } from 'lucide-react'
import type { RecentVisitDTO } from '@/lib/actions/finance'
import MetricCard from '@/components/ui/metric-card'
import VisitDetailModal from './VisitDetailModal'

type SortKey = 'date' | 'client' | 'room' | 'format' | 'hours' | 'gross' | 'net'
type Period = 'all' | 'month' | 'lastMonth'

const TEXT_SORT_KEYS: SortKey[] = ['client', 'room', 'format']
const PAGE_SIZE_OPTIONS = [25, 50, 100] as const

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'date', label: 'Дата' },
  { key: 'client', label: 'Клиент' },
  { key: 'room', label: 'Зал' },
  { key: 'format', label: 'Формат' },
  { key: 'hours', label: 'Часов' },
  { key: 'gross', label: 'Выручка' },
  { key: 'net', label: 'Чистая прибыль' },
]

const PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: 'all', label: 'Всё время' },
  { value: 'month', label: 'Текущий месяц' },
  { value: 'lastMonth', label: 'Прошлый месяц' },
]

function formatMoney(v: number | null) {
  if (v == null) return '—'
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(v)
}

interface Props {
  visits: RecentVisitDTO[]
  initialRoom?: string
  initialFormat?: string
}

export default function VisitsReportTable({ visits, initialRoom, initialFormat }: Props) {
  const [search, setSearch] = useState('')
  const [roomFilter, setRoomFilter] = useState(initialRoom ?? '')
  const [formatFilter, setFormatFilter] = useState(initialFormat ?? '')
  const [period, setPeriod] = useState<Period>('all')
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState<number>(50)
  const [selectedVisit, setSelectedVisit] = useState<RecentVisitDTO | null>(null)

  const roomOptions = useMemo(
    () => Array.from(new Set(visits.map(v => v.room).filter((r): r is string => !!r))).sort((a, b) => a.localeCompare(b, 'ru')),
    [visits],
  )
  const formatOptions = useMemo(
    () => Array.from(new Set(visits.map(v => v.format).filter((f): f is string => !!f))).sort((a, b) => a.localeCompare(b, 'ru')),
    [visits],
  )

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir(TEXT_SORT_KEYS.includes(key) ? 'asc' : 'desc')
    }
  }

  const filtered = useMemo(() => {
    const now = new Date()
    const monthStart = startOfMonth(now)
    const monthEnd = endOfMonth(now)
    const lastMonthStart = startOfMonth(subMonths(now, 1))
    const lastMonthEnd = endOfMonth(subMonths(now, 1))
    const q = search.trim().toLowerCase()

    return visits.filter(v => {
      if (roomFilter && v.room !== roomFilter) return false
      if (formatFilter && v.format !== formatFilter) return false
      if (period !== 'all') {
        if (!v.date) return false
        const d = parseISO(v.date)
        if (period === 'month' && (d < monthStart || d > monthEnd)) return false
        if (period === 'lastMonth' && (d < lastMonthStart || d > lastMonthEnd)) return false
      }
      if (q && !v.clientName.toLowerCase().includes(q) && !(v.comment ?? '').toLowerCase().includes(q)) return false
      return true
    })
  }, [visits, search, roomFilter, formatFilter, period])

  const totals = useMemo(() => ({
    count: filtered.length,
    gross: filtered.reduce((sum, v) => sum + (v.grossAmount ?? 0), 0),
    net: filtered.reduce((sum, v) => sum + (v.netAmount ?? 0), 0),
    hours: filtered.reduce((sum, v) => sum + (v.durationHours ?? 0), 0),
  }), [filtered])

  const sorted = useMemo(() => {
    const copy = [...filtered]
    copy.sort((a, b) => {
      let cmp = 0
      switch (sortKey) {
        case 'date': cmp = (a.date ? new Date(a.date).getTime() : 0) - (b.date ? new Date(b.date).getTime() : 0); break
        case 'client': cmp = a.clientName.localeCompare(b.clientName, 'ru'); break
        case 'room': cmp = (a.room ?? '').localeCompare(b.room ?? '', 'ru'); break
        case 'format': cmp = (a.format ?? '').localeCompare(b.format ?? '', 'ru'); break
        case 'hours': cmp = (a.durationHours ?? 0) - (b.durationHours ?? 0); break
        case 'gross': cmp = (a.grossAmount ?? 0) - (b.grossAmount ?? 0); break
        case 'net': cmp = (a.netAmount ?? 0) - (b.netAmount ?? 0); break
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
    return copy
  }, [filtered, sortKey, sortDir])

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize))
  const currentPage = Math.min(page, pageCount - 1)
  const paginated = sorted.slice(currentPage * pageSize, currentPage * pageSize + pageSize)

  const hasActiveFilters = !!search || !!roomFilter || !!formatFilter || period !== 'all'

  function resetFilters() {
    setSearch('')
    setRoomFilter('')
    setFormatFilter('')
    setPeriod('all')
    setPage(0)
  }

  function updateFilter(setter: (v: string) => void, value: string) {
    setter(value)
    setPage(0)
  }

  return (
    <div className="space-y-4">
      {/* Фильтры */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-56">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
          <input
            value={search}
            onChange={e => updateFilter(setSearch, e.target.value)}
            placeholder="Поиск по клиенту, примечаниям..."
            className="w-full bg-zinc-900 border border-zinc-800 text-zinc-200 placeholder-zinc-600 text-sm rounded-lg pl-9 pr-3 py-2.5 outline-none focus:border-zinc-600 transition-colors"
          />
        </div>

        <select
          value={period}
          onChange={e => updateFilter(v => setPeriod(v as Period), e.target.value)}
          className="bg-zinc-900 border border-zinc-800 text-zinc-300 text-sm rounded-lg px-3 py-2.5 outline-none focus:border-zinc-600 cursor-pointer"
        >
          {PERIOD_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>

        <select
          value={roomFilter}
          onChange={e => updateFilter(setRoomFilter, e.target.value)}
          className="bg-zinc-900 border border-zinc-800 text-zinc-300 text-sm rounded-lg px-3 py-2.5 outline-none focus:border-zinc-600 cursor-pointer"
        >
          <option value="">Все залы</option>
          {roomOptions.map(r => <option key={r} value={r}>{r}</option>)}
        </select>

        <select
          value={formatFilter}
          onChange={e => updateFilter(setFormatFilter, e.target.value)}
          className="bg-zinc-900 border border-zinc-800 text-zinc-300 text-sm rounded-lg px-3 py-2.5 outline-none focus:border-zinc-600 cursor-pointer"
        >
          <option value="">Все форматы</option>
          {formatOptions.map(f => <option key={f} value={f}>{f}</option>)}
        </select>

        {hasActiveFilters && (
          <button onClick={resetFilters} className="flex items-center gap-1 text-zinc-500 hover:text-zinc-300 text-sm transition-colors">
            <X className="w-3.5 h-3.5" />
            Сбросить
          </button>
        )}
      </div>

      {/* Итоги по отфильтрованным данным */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MetricCard padding="p-4" valueClassName="text-xl mt-1.5" label="Записей" value={String(totals.count)} />
        <MetricCard padding="p-4" valueClassName="text-xl mt-1.5" label="Выручка" value={formatMoney(totals.gross)} />
        <MetricCard padding="p-4" valueClassName="text-xl mt-1.5" label="Чистая прибыль" value={formatMoney(totals.net)} />
        <MetricCard padding="p-4" valueClassName="text-xl mt-1.5" label="Часов" value={totals.hours.toFixed(totals.hours % 1 === 0 ? 0 : 1)} />
      </div>

      {sorted.length === 0 ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-12 text-center">
          <p className="text-zinc-400">По этому фильтру записей нет</p>
        </div>
      ) : (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-zinc-800 hover:bg-transparent">
                  {COLUMNS.map(col => (
                    <TableHead key={col.key} className="text-zinc-400 text-xs uppercase tracking-wider">
                      <button
                        onClick={() => toggleSort(col.key)}
                        className={`flex items-center gap-1 hover:text-white transition-colors whitespace-nowrap ${sortKey === col.key ? 'text-white' : ''}`}
                      >
                        {col.label}
                        {sortKey === col.key ? (
                          sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                        ) : (
                          <ArrowUpDown className="w-3 h-3 opacity-30" />
                        )}
                      </button>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginated.map(v => (
                  <TableRow
                    key={v.id}
                    onClick={() => setSelectedVisit(v)}
                    className="border-zinc-800 hover:bg-zinc-800/50 cursor-pointer"
                  >
                    <TableCell className="text-zinc-300 whitespace-nowrap">
                      {v.date ? format(parseISO(v.date), 'd MMM yyyy', { locale: ru }) : '—'}
                    </TableCell>
                    <TableCell className="text-zinc-100">{v.clientName}</TableCell>
                    <TableCell className="text-zinc-400">{v.room ?? '—'}</TableCell>
                    <TableCell className="text-zinc-400">{v.format ?? '—'}</TableCell>
                    <TableCell className="text-zinc-400">{v.durationHours != null ? v.durationHours : '—'}</TableCell>
                    <TableCell className="text-zinc-300">{formatMoney(v.grossAmount)}</TableCell>
                    <TableCell className="text-white font-medium">{formatMoney(v.netAmount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Пагинация */}
          <div className="flex items-center justify-between px-4 py-3 border-t border-zinc-800 text-xs text-zinc-500">
            <div className="flex items-center gap-2">
              <span>Показывать по:</span>
              {PAGE_SIZE_OPTIONS.map(size => (
                <button
                  key={size}
                  onClick={() => { setPageSize(size); setPage(0) }}
                  className={`px-2 py-1 rounded transition-colors ${pageSize === size ? 'bg-zinc-700 text-white' : 'hover:text-zinc-300'}`}
                >
                  {size}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <span>
                {currentPage * pageSize + 1}–{Math.min((currentPage + 1) * pageSize, sorted.length)} из {sorted.length}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={currentPage === 0}
                  className="px-2 py-1 rounded hover:bg-zinc-800 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                >
                  Назад
                </button>
                <button
                  onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))}
                  disabled={currentPage >= pageCount - 1}
                  className="px-2 py-1 rounded hover:bg-zinc-800 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                >
                  Вперёд
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {selectedVisit && (
        <VisitDetailModal visit={selectedVisit} onOpenChange={open => { if (!open) setSelectedVisit(null) }} />
      )}
    </div>
  )
}
