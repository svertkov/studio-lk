'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { format, parseISO } from 'date-fns'
import { ru } from 'date-fns/locale'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { ArrowUp, ArrowDown, ArrowUpDown, AlertTriangle, ExternalLink } from 'lucide-react'
import type { SubscriptionRow } from '@/lib/actions/finance'
import {
  SUBSCRIPTION_DISPLAY_STATUS_LABELS, SUBSCRIPTION_DISPLAY_STATUS_COLORS, SUBSCRIPTION_LOW_HOURS_THRESHOLD,
  SUBSCRIPTION_ARCHIVED_BADGE_LABEL, SUBSCRIPTION_ARCHIVED_BADGE_CLASS,
  getSubscriptionDisplayStatus, type SubscriptionDisplayStatus,
} from '@/lib/subscription-model'
import MetricCard, { METRIC_GRID_CLASSNAME } from '@/components/ui/metric-card'
import SubscriptionActionsMenu from '@/components/subscriptions/SubscriptionActionsMenu'
import SubscriptionDetailModal from './SubscriptionDetailModal'

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

// 'ALL' и 'ARCHIVED' — не значения SubscriptionDisplayStatus (тот описывает
// только бейдж), а отдельные вкладочные срезы: 'ALL' — всё, кроме архивных
// (архивные скрыты по умолчанию, см. ТЗ, показываются только через вкладку
// «Архив»), 'ARCHIVED' — только isArchived, независимо от их статуса.
type Tab = 'ALL' | 'ARCHIVED' | SubscriptionDisplayStatus

const TABS: { value: Tab; label: string }[] = [
  { value: 'ALL',       label: 'Все' },
  { value: 'ACTIVE',    label: 'Активные' },
  { value: 'LOW',       label: 'Заканчиваются' },
  { value: 'USED_UP',   label: 'Использованные' },
  { value: 'CANCELLED', label: 'Аннулированные' },
  { value: 'REFUNDED',  label: 'Возвраты' },
  { value: 'ARCHIVED',  label: 'Архив' },
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
    activeCount: number; usedUpCount: number; cancelledCount: number; refundedCount: number; archivedCount: number
    totalCount: number
    hoursSoldTotal: number; hoursUsedTotal: number; hoursRemainingTotal: number
    paidTotal: number; avgRemainingActive: number | null
  }
  rows: SubscriptionRow[]
  initialLowOnly: boolean
}

export default function SubscriptionsAnalyticsView({ summary, rows, initialLowOnly }: Props) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>(initialLowOnly ? 'LOW' : 'ALL')
  const [sortKey, setSortKey] = useState<SortKey>('purchasedAt')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [selected, setSelected] = useState<SubscriptionRow | null>(null)

  const displayStatusOf = (r: SubscriptionRow) =>
    getSubscriptionDisplayStatus({ status: r.status, isArchived: r.isArchived, remainingHours: r.remainingHours })

  const lowRows = useMemo(() => rows.filter(r => displayStatusOf(r) === 'LOW'), [rows])

  // Все вкладки, кроме 'ARCHIVED' (и 'ALL', который сам исключает архивные),
  // считаются только по неархивным строкам — иначе архивный, например,
  // аннулированный абонемент утекал бы одновременно и во вкладку
  // «Аннулированные», и в «Архив», путая счётчики.
  const tabCounts = useMemo(() => {
    const nonArchived = rows.filter(r => !r.isArchived)
    return {
      ALL: nonArchived.length,
      ACTIVE: nonArchived.filter(r => displayStatusOf(r) === 'ACTIVE').length,
      LOW: lowRows.length,
      USED_UP: nonArchived.filter(r => r.status === 'USED_UP').length,
      CANCELLED: nonArchived.filter(r => r.status === 'CANCELLED').length,
      REFUNDED: nonArchived.filter(r => r.status === 'REFUNDED').length,
      ARCHIVED: rows.filter(r => r.isArchived).length,
    }
  }, [rows, lowRows])

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir(TEXT_SORT_KEYS.includes(key) ? 'asc' : 'desc')
    }
  }

  const visibleRows = useMemo(() => {
    if (tab === 'ARCHIVED') return rows.filter(r => r.isArchived)
    const nonArchived = rows.filter(r => !r.isArchived)
    if (tab === 'ALL') return nonArchived
    return nonArchived.filter(r => displayStatusOf(r) === tab)
  }, [rows, tab])

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

      {lowRows.length > 0 && tab !== 'LOW' && (
        <div className="border border-amber-600/50 bg-amber-950/20 rounded-xl overflow-hidden">
          <button
            onClick={() => setTab('LOW')}
            className="w-full px-5 py-3.5 flex items-center gap-2.5 text-left hover:bg-amber-950/30 transition-colors"
          >
            <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
            <span className="text-amber-200 text-sm">
              {lowRows.length} {lowRows.length === 1 ? 'абонемент заканчивается' : 'абонемента(ов) заканчиваются'} (осталось ≤ {SUBSCRIPTION_LOW_HOURS_THRESHOLD} ч)
            </span>
            <span className="ml-auto text-amber-400/70 text-xs underline flex-shrink-0">показать</span>
          </button>
        </div>
      )}

      <div className="flex items-center gap-1.5 bg-zinc-900 border border-zinc-800 rounded-lg p-1 overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t.value}
            type="button"
            onClick={() => setTab(t.value)}
            className={`px-3.5 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
              tab === t.value ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {t.label} <span className="text-zinc-500">· {tabCounts[t.value]}</span>
          </button>
        ))}
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        {sorted.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-zinc-400 text-sm">Абонементов по этому фильтру нет</p>
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
                {sorted.map(r => {
                  const displayStatus = displayStatusOf(r)
                  return (
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
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <Badge variant="outline" className={`text-xs whitespace-nowrap ${SUBSCRIPTION_DISPLAY_STATUS_COLORS[displayStatus]}`}>
                            {SUBSCRIPTION_DISPLAY_STATUS_LABELS[displayStatus]}
                          </Badge>
                          {r.isArchived && (
                            <Badge variant="outline" className={`text-xs whitespace-nowrap ${SUBSCRIPTION_ARCHIVED_BADGE_CLASS}`}>
                              {SUBSCRIPTION_ARCHIVED_BADGE_LABEL}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5 justify-end">
                          <SubscriptionActionsMenu subscription={r} onChanged={() => router.refresh()} variant="compact" />
                          <Link
                            href={`/admin/clients/${r.clientId}`}
                            onClick={e => e.stopPropagation()}
                            className="flex items-center justify-center w-7 h-7 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white transition-colors flex-shrink-0"
                            title="Открыть клиента"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </Link>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {selected && (
        <SubscriptionDetailModal
          subscription={selected}
          onOpenChange={open => { if (!open) setSelected(null) }}
          onChanged={() => router.refresh()}
        />
      )}
    </div>
  )
}
