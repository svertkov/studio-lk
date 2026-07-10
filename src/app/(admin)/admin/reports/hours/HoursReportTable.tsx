'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { format, parseISO } from 'date-fns'
import { ru } from 'date-fns/locale'
import { ArrowUp, ArrowDown, ArrowUpDown, ExternalLink } from 'lucide-react'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { colorForCategory } from '@/lib/event-category'

export interface HoursRow {
  id: string
  start: string
  category: string
  client: string
  clientId: string | null
  hall: string
  cameras: number | null
  hours: number
  amount: number | null
}

type SortKey = 'date' | 'category' | 'client' | 'hall' | 'hours'

const TEXT_SORT_KEYS: SortKey[] = ['category', 'client', 'hall']

const COLUMNS: { key: SortKey | null; label: string }[] = [
  { key: 'date', label: 'Дата' },
  { key: null, label: 'Время' },
  { key: 'category', label: 'Формат' },
  { key: 'client', label: 'Клиент' },
  { key: 'hall', label: 'Зал' },
  { key: null, label: 'Камеры' },
  { key: 'hours', label: 'Часы' },
  { key: null, label: 'Статус' },
  { key: null, label: 'Сумма' },
  { key: null, label: '' },
]

function formatMoney(v: number | null): string {
  if (v == null) return '—'
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(v)
}

export default function HoursReportTable({ rows }: { rows: HoursRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir(TEXT_SORT_KEYS.includes(key) ? 'asc' : 'desc')
    }
  }

  const sorted = useMemo(() => {
    const copy = [...rows]
    copy.sort((a, b) => {
      let cmp = 0
      switch (sortKey) {
        case 'date': cmp = new Date(a.start).getTime() - new Date(b.start).getTime(); break
        case 'hours': cmp = a.hours - b.hours; break
        case 'category': cmp = a.category.localeCompare(b.category, 'ru'); break
        case 'client': cmp = a.client.localeCompare(b.client, 'ru'); break
        case 'hall': cmp = a.hall.localeCompare(b.hall, 'ru'); break
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
    return copy
  }, [rows, sortKey, sortDir])

  if (rows.length === 0) {
    return (
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-12 text-center">
        <p className="text-zinc-400">За выбранный месяц завершённых записей нет</p>
      </div>
    )
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="border-zinc-800 hover:bg-transparent">
            {COLUMNS.map(col => (
              <TableHead key={col.label || 'action'} className="text-zinc-400 text-xs uppercase tracking-wider">
                {col.key ? (
                  <button
                    onClick={() => toggleSort(col.key as SortKey)}
                    className="flex items-center gap-1 hover:text-white transition-colors"
                  >
                    {col.label}
                    {sortKey === col.key ? (
                      sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                    ) : (
                      <ArrowUpDown className="w-3 h-3 opacity-30" />
                    )}
                  </button>
                ) : col.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map(row => (
            <TableRow key={row.id} className="border-zinc-800 hover:bg-zinc-800/50">
              <TableCell className="text-zinc-200 whitespace-nowrap">{format(parseISO(row.start), 'd MMM', { locale: ru })}</TableCell>
              <TableCell className="text-zinc-400 whitespace-nowrap">{format(parseISO(row.start), 'HH:mm')}</TableCell>
              <TableCell>
                <span className="inline-flex items-center gap-1.5 text-zinc-200 whitespace-nowrap">
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: colorForCategory(row.category) }} />
                  {row.category}
                </span>
              </TableCell>
              <TableCell className="text-zinc-200">{row.client}</TableCell>
              <TableCell className="text-zinc-400 whitespace-nowrap">{row.hall}</TableCell>
              <TableCell className="text-zinc-400 whitespace-nowrap">{row.cameras ?? '—'}</TableCell>
              <TableCell className="text-white font-medium whitespace-nowrap">{row.hours.toFixed(1)} ч</TableCell>
              <TableCell>
                <Badge variant="outline" className="text-[11px] border-green-800 text-green-400">Завершено</Badge>
              </TableCell>
              <TableCell className="text-zinc-300 whitespace-nowrap">{formatMoney(row.amount)}</TableCell>
              <TableCell>
                {row.clientId && (
                  <Link
                    href={`/admin/clients/${row.clientId}`}
                    aria-label="Открыть карточку клиента"
                    title="Открыть карточку клиента"
                    className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </Link>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
