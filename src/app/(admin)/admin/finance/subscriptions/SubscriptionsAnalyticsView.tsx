'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { format, parseISO } from 'date-fns'
import { ru } from 'date-fns/locale'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { ArrowUp, ArrowDown, ArrowUpDown, AlertTriangle, ExternalLink } from 'lucide-react'
import type { SubscriptionRow } from '@/lib/actions/finance'
import { SUBSCRIPTION_STATUS_LABELS, SUBSCRIPTION_STATUS_COLORS } from '@/lib/subscription-model'
import MetricCard, { METRIC_GRID_CLASSNAME } from '@/components/ui/metric-card'
import SubscriptionDetailModal from './SubscriptionDetailModal'

const LOW_HOURS_THRESHOLD = 2

type SortKey = 'client' | 'purchasedAt' | 'packageHours' | 'paidAmount' | 'usedHours' | 'remainingHours' | 'status'
const TEXT_SORT_KEYS: SortKey[] = ['client', 'status']

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'client', label: 'Клиент' },
  { key: 'purchasedAt', label: 'Дата покупки' },
  { key: 'packageHours', label: 'Пакет' },
  { key: 'paidAmount', label: 'Оплачено' },
  { key: 'usedHours', label: 'Использовано' },
  { key: 'remainingHours', label: 'Осталось' },
  { key: 'status', label: 'Статус' },
]

function formatMoney(v: number | null) {
  if (v == null) return '—'
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(v)
}

function formatHours(v: number) {
  return v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)
}

interface Props {
  summary: {
    activeCount: number; usedUpCount: number; cancelledCount: number; totalCount: number
    hoursSoldTotal: number; hoursUsedTotal: number; hoursRemainingTotal: number
    paidTotal: number; avgRemainingActive: number | null
  }
  rows: SubscriptionRow[]
  initialLowOnly: boolean
}

export default function SubscriptionsAnalyticsView({ summary, rows, initialLowOnly }: Props) {
  const [lowOnly, setLowOnly] = useState(initialLowOnly)
  const [sortKey, setSortKey] = useState<SortKey>('purchasedAt')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [selected, setSelected] = useState<SubscriptionRow | null>(null)

  const lowRows = useMemo(
    () => rows.filter(r => r.status === 'ACTIVE' && r.remainingHours <= LOW_HOURS_THRESHOLD),
    [rows],
  )

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir(TEXT_SORT_KEYS.includes(key) ? 'asc' : 'desc')
    }
  }

  const visibleRows = lowOnly ? lowRows : rows

  const sorted = useMemo(() => {
    const copy = [...visibleRows]
    copy.sort((a, b) => {
      let cmp = 0
      switch (sortKey) {
        case 'client': cmp = a.clientName.localeCompare(b.clientName, 'ru'); break
        case 'purchasedAt': cmp = new Date(a.purchasedAt).getTime() - new Date(b.purchasedAt).getTime(); break
        case 'packageHours': cmp = a.packageHours - b.packageHours; break
        case 'paidAmount': cmp = (a.paidAmount ?? 0) - (b.paidAmount ?? 0); break
        case 'usedHours': cmp = a.usedHours - b.usedHours; break
        case 'remainingHours': cmp = a.remainingHours - b.remainingHours; break
        case 'status': cmp = a.status.localeCompare(b.status); break
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
    return copy
  }, [visibleRows, sortKey, sortDir])

  return (
    <div className="space-y-6">
      <div className={METRIC_GRID_CLASSNAME}>
        <MetricCard padding="p-4" valueClassName="text-xl mt-1.5" label="Активных" value={String(summary.activeCount)} subtitle={`${summary.totalCount} всего продано`} />
        <MetricCard padding="p-4" valueClassName="text-xl mt-1.5" label="Использовано абонементов" value={String(summary.usedUpCount)} />
        <MetricCard padding="p-4" valueClassName="text-xl mt-1.5" label="Часов продано" value={formatHours(summary.hoursSoldTotal)} subtitle={`использовано ${formatHours(summary.hoursUsedTotal)} ч`} />
        <MetricCard padding="p-4" valueClassName="text-xl mt-1.5" label="Часов осталось" value={formatHours(summary.hoursRemainingTotal)} subtitle="только у активных" />
        <MetricCard padding="p-4" valueClassName="text-xl mt-1.5" label="Продано на сумму" value={formatMoney(summary.paidTotal)} />
        <MetricCard
          padding="p-4" valueClassName="text-xl mt-1.5"
          label="Средний остаток"
          value={summary.avgRemainingActive != null ? `${formatHours(summary.avgRemainingActive)} ч` : '—'}
          subtitle="у активных абонементов"
        />
      </div>

      {lowRows.length > 0 && (
        <div className="border border-amber-600/50 bg-amber-950/20 rounded-xl overflow-hidden">
          <button
            onClick={() => setLowOnly(v => !v)}
            className="w-full px-5 py-3.5 flex items-center gap-2.5 text-left hover:bg-amber-950/30 transition-colors"
          >
            <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
            <span className="text-amber-200 text-sm">
              {lowRows.length} {lowRows.length === 1 ? 'абонемент заканчивается' : 'абонемента(ов) заканчиваются'} (осталось ≤ {LOW_HOURS_THRESHOLD} ч)
            </span>
            <span className="ml-auto text-amber-400/70 text-xs underline flex-shrink-0">
              {lowOnly ? 'показать все' : 'показать только их'}
            </span>
          </button>
        </div>
      )}

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-zinc-800 flex items-center justify-between">
          <h3 className="text-white font-semibold text-sm">
            {lowOnly ? 'Заканчивающиеся абонементы' : 'Все абонементы'}
          </h3>
          {lowOnly && (
            <button onClick={() => setLowOnly(false)} className="text-zinc-500 hover:text-zinc-300 text-xs underline">
              Сбросить фильтр
            </button>
          )}
        </div>

        {sorted.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-zinc-400 text-sm">Абонементов пока нет</p>
          </div>
        ) : (
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
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map(r => (
                  <TableRow key={r.id} onClick={() => setSelected(r)} className="border-zinc-800 hover:bg-zinc-800/50 cursor-pointer">
                    <TableCell className="text-zinc-100">{r.clientName}</TableCell>
                    <TableCell className="text-zinc-400 whitespace-nowrap">
                      {format(parseISO(r.purchasedAt), 'd MMM yyyy', { locale: ru })}
                    </TableCell>
                    <TableCell className="text-zinc-400">{formatHours(r.packageHours)} ч</TableCell>
                    <TableCell className="text-zinc-300">{formatMoney(r.paidAmount)}</TableCell>
                    <TableCell className="text-zinc-400">{formatHours(r.usedHours)} ч</TableCell>
                    <TableCell className="text-white font-medium">{formatHours(r.remainingHours)} ч</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-xs ${SUBSCRIPTION_STATUS_COLORS[r.status]}`}>
                        {SUBSCRIPTION_STATUS_LABELS[r.status]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/admin/clients/${r.clientId}`}
                        onClick={e => e.stopPropagation()}
                        className="flex items-center justify-center w-7 h-7 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white transition-colors"
                        title="Открыть клиента"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {selected && (
        <SubscriptionDetailModal subscription={selected} onOpenChange={open => { if (!open) setSelected(null) }} />
      )}
    </div>
  )
}
