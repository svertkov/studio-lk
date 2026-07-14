'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search } from 'lucide-react'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import ToggleChip from '@/components/ui/toggle-chip'
import type { AppendixRowDTO } from '@/lib/actions/documents'

function formatDate(v: string) {
  return new Date(v).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
}

function formatMoney(v: number | null) {
  if (v == null) return '—'
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(v)
}

interface Props {
  appendices: AppendixRowDTO[]
}

// Поиск/фильтры — клиентский useMemo над уже загруженным массивом (тот же
// паттерн, что ClientsSection.tsx), без серверного query-параметра — при
// текущем объёме документов в реестре этого достаточно.
export default function AppendicesTable({ appendices }: Props) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [onlyOrders, setOnlyOrders] = useState(false)
  const [onlyMontage, setOnlyMontage] = useState(false)
  const [withoutOrder, setWithoutOrder] = useState(false)
  const [withoutMontage, setWithoutMontage] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return appendices.filter(a => {
      if (!showArchived && a.isArchived) return false
      if (onlyOrders && !a.orderId) return false
      if (onlyMontage && !a.montageProjectId) return false
      if (withoutOrder && a.orderId) return false
      if (withoutMontage && a.montageProjectId) return false
      if (dateFrom && a.issueDate.slice(0, 10) < dateFrom) return false
      if (dateTo && a.issueDate.slice(0, 10) > dateTo) return false
      if (q) {
        const haystack = [
          a.displayNumber, a.contractDisplayNumber, a.clientName,
          a.serviceDescription ?? '', a.comment ?? '', a.amount != null ? String(a.amount) : '',
        ].join(' ').toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })
  }, [appendices, search, onlyOrders, onlyMontage, withoutOrder, withoutMontage, showArchived, dateFrom, dateTo])

  function toggleExpanded(id: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const hasActiveFilters = search || onlyOrders || onlyMontage || withoutOrder || withoutMontage || showArchived || dateFrom || dateTo

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-56">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Поиск по номеру, договору, клиенту, сумме, описанию услуги..."
            className="w-full bg-zinc-900 border border-zinc-800 text-zinc-200 placeholder-zinc-600 text-sm rounded-lg pl-9 pr-3 py-2.5 outline-none focus:border-zinc-600 transition-colors"
          />
        </div>
        <input
          type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
          className="bg-zinc-900 border border-zinc-800 text-zinc-300 text-sm rounded-lg px-3 py-2.5 outline-none focus:border-zinc-600"
        />
        <span className="text-zinc-600 text-sm">—</span>
        <input
          type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
          className="bg-zinc-900 border border-zinc-800 text-zinc-300 text-sm rounded-lg px-3 py-2.5 outline-none focus:border-zinc-600"
        />
        {hasActiveFilters && (
          <button
            onClick={() => { setSearch(''); setOnlyOrders(false); setOnlyMontage(false); setWithoutOrder(false); setWithoutMontage(false); setShowArchived(false); setDateFrom(''); setDateTo('') }}
            className="text-zinc-500 hover:text-zinc-300 text-sm transition-colors"
          >
            Сбросить
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <ToggleChip checked={onlyOrders} onChange={setOnlyOrders}>Только съёмка</ToggleChip>
        <ToggleChip checked={onlyMontage} onChange={setOnlyMontage}>Только монтаж</ToggleChip>
        <ToggleChip checked={withoutOrder} onChange={setWithoutOrder}>Без заказа</ToggleChip>
        <ToggleChip checked={withoutMontage} onChange={setWithoutMontage}>Без монтажа</ToggleChip>
        <ToggleChip checked={showArchived} onChange={setShowArchived}>Показывать архивные</ToggleChip>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-10 text-center">
          <p className="text-zinc-400 text-sm">Приложений не найдено</p>
        </div>
      ) : (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-zinc-800 hover:bg-transparent">
                <TableHead className="text-zinc-400">№</TableHead>
                <TableHead className="text-zinc-400">Договор</TableHead>
                <TableHead className="text-zinc-400">Клиент</TableHead>
                <TableHead className="text-zinc-400">Дата</TableHead>
                <TableHead className="text-zinc-400">Сумма</TableHead>
                <TableHead className="text-zinc-400">Заказ</TableHead>
                <TableHead className="text-zinc-400">Монтаж</TableHead>
                <TableHead className="text-zinc-400">Описание услуги</TableHead>
                <TableHead className="text-zinc-400">Комментарий</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(a => {
                const isLong = !!a.serviceDescription && a.serviceDescription.length > 140
                const isExpanded = expanded.has(a.id)
                return (
                  <TableRow key={a.id} className="border-zinc-800 cursor-pointer hover:bg-zinc-800/40" onClick={() => router.push(`/admin/clients/${a.clientId}?tab=documents`)}>
                    <TableCell className="text-zinc-200 text-sm">{a.displayNumber}</TableCell>
                    <TableCell className="text-zinc-300 text-sm">{a.contractDisplayNumber}</TableCell>
                    <TableCell className="text-zinc-200 text-sm truncate max-w-[180px]">{a.clientName}</TableCell>
                    <TableCell className="text-zinc-300 text-sm whitespace-nowrap">{formatDate(a.issueDate)}</TableCell>
                    <TableCell className="text-zinc-300 text-sm whitespace-nowrap">{formatMoney(a.amount)}</TableCell>
                    <TableCell className="text-zinc-400 text-xs truncate max-w-[140px]">{a.orderTitle ?? '—'}</TableCell>
                    <TableCell className="text-zinc-400 text-xs truncate max-w-[140px]">{a.montageTitle ?? '—'}</TableCell>
                    <TableCell className="text-zinc-400 text-xs max-w-[260px]">
                      {a.serviceDescription ? (
                        <div>
                          <p className={`whitespace-pre-wrap break-words ${!isExpanded && isLong ? 'line-clamp-2' : ''}`}>{a.serviceDescription}</p>
                          {isLong && (
                            <button
                              type="button"
                              onClick={e => { e.stopPropagation(); toggleExpanded(a.id) }}
                              className="text-[#00c26b] hover:underline mt-0.5"
                            >
                              {isExpanded ? 'Свернуть' : 'Показать полностью'}
                            </button>
                          )}
                        </div>
                      ) : '—'}
                    </TableCell>
                    <TableCell className="text-zinc-500 text-xs truncate max-w-[160px]">{a.comment ?? '—'}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
