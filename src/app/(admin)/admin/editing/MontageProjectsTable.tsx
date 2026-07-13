'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Search, ArrowUp, ArrowDown, ArrowUpDown, Cloud, Server } from 'lucide-react'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import GlowPill from '@/components/ui/glow-pill'
import type { MontageProjectDTO } from '@/lib/actions/montage'
import type { EditorProfileListItemDTO } from '@/lib/actions/editors'
import {
  MONTAGE_STATUS_ORDER, MONTAGE_STATUS_LABELS, MONTAGE_CLIENT_PAYMENT_STATUS_LABELS, MONTAGE_EDITOR_PAYMENT_STATUS_LABELS,
  MONTAGE_ACTIVE_STATUSES, computeMontageProfit, type MontageStatus,
} from '@/lib/montage-model'
import MontageStatusBadge from './MontageStatusBadge'

export type MontageProjectsFilterPreset =
  | { kind: 'status'; statuses: MontageStatus[] }
  | { kind: 'attention' }
  | { kind: 'all' }

function formatMoney(v: number | null) {
  if (v == null) return '—'
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(v)
}

function formatDate(v: string | null) {
  if (!v) return '—'
  return new Date(v).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
}

type SortKey = 'date' | 'client' | 'deadline' | 'profit'

function haystack(p: MontageProjectDTO): string {
  return [p.title, p.description, p.clientName, p.companyName, p.editorName, p.contentType, p.internalComment, p.clientComment]
    .filter(Boolean).join(' ').toLowerCase()
}

// Вынесено на уровень модуля (не создаётся заново при каждом рендере таблицы) —
// принимает текущий столбец сортировки как пропсы, а не читает замыкание.
function SortIcon({ active, dir }: { active: boolean; dir: 'asc' | 'desc' }) {
  if (!active) return <ArrowUpDown className="w-3 h-3 text-zinc-600" />
  return dir === 'asc' ? <ArrowUp className="w-3 h-3 text-zinc-300" /> : <ArrowDown className="w-3 h-3 text-zinc-300" />
}

// Начальные значения фильтров из пресета KPI-карточки (ТЗ п.12) — вычисляются
// один раз при монтаже через lazy useState ниже, БЕЗ useEffect: EditingView
// пересоздаёт таблицу (меняет key) при каждом переходе с дашборда, поэтому
// достаточно посчитать стартовое состояние при инициализации, а не
// синхронизировать его отдельным эффектом.
function initialFiltersFromPreset(preset: MontageProjectsFilterPreset | null) {
  if (preset?.kind === 'status' && preset.statuses.length === 1) {
    return { statusFilter: preset.statuses[0] as MontageStatus | 'ALL', activeOnly: false, attentionOnly: false }
  }
  if (preset?.kind === 'status') {
    return { statusFilter: 'ALL' as const, activeOnly: true, attentionOnly: false }
  }
  if (preset?.kind === 'attention') {
    return { statusFilter: 'ALL' as const, activeOnly: false, attentionOnly: true }
  }
  return { statusFilter: 'ALL' as const, activeOnly: false, attentionOnly: false }
}

interface Props {
  projects: MontageProjectDTO[]
  editors: EditorProfileListItemDTO[]
  initialFilterPreset: MontageProjectsFilterPreset | null
  onOpenProject: (project: MontageProjectDTO) => void
}

export default function MontageProjectsTable({ projects, editors, initialFilterPreset, onOpenProject }: Props) {
  const initialFilters = useState(() => initialFiltersFromPreset(initialFilterPreset))[0]

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<MontageStatus | 'ALL'>(initialFilters.statusFilter)
  const [editorFilter, setEditorFilter] = useState<string | 'ALL'>('ALL')
  const [attentionOnly, setAttentionOnly] = useState(initialFilters.attentionOnly)
  const [overdueOnly, setOverdueOnly] = useState(false)
  const [activeOnly, setActiveOnly] = useState(initialFilters.activeOnly)
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  function toggleSort(key: SortKey) {
    if (key === sortKey) { setSortDir(d => (d === 'asc' ? 'desc' : 'asc')); return }
    setSortKey(key)
    setSortDir(key === 'client' ? 'asc' : 'desc')
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return projects.filter(p => {
      if (q && !haystack(p).includes(q)) return false
      if (statusFilter !== 'ALL' && p.status !== statusFilter) return false
      if (activeOnly && !MONTAGE_ACTIVE_STATUSES.includes(p.status)) return false
      if (editorFilter !== 'ALL' && p.editorId !== editorFilter) return false
      if (attentionOnly && p.attentionReasons.length === 0) return false
      if (overdueOnly && !p.isOverdue) return false
      return true
    })
  }, [projects, search, statusFilter, activeOnly, editorFilter, attentionOnly, overdueOnly])

  const sorted = useMemo(() => {
    const arr = [...filtered]
    arr.sort((a, b) => {
      let cmp = 0
      if (sortKey === 'date') cmp = new Date(a.sourceReceivedAt ?? a.createdAt).getTime() - new Date(b.sourceReceivedAt ?? b.createdAt).getTime()
      else if (sortKey === 'client') cmp = (a.clientName ?? '').localeCompare(b.clientName ?? '', 'ru')
      else if (sortKey === 'deadline') cmp = (a.deadlineDate ? new Date(a.deadlineDate).getTime() : Infinity) - (b.deadlineDate ? new Date(b.deadlineDate).getTime() : Infinity)
      else if (sortKey === 'profit') cmp = (computeMontageProfit(a.clientAmount, a.editorAmount) ?? -Infinity) - (computeMontageProfit(b.clientAmount, b.editorAmount) ?? -Infinity)
      return sortDir === 'asc' ? cmp : -cmp
    })
    return arr
  }, [filtered, sortKey, sortDir])

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Поиск по клиенту, проекту, монтажёру, комментарию..."
            className="w-full h-10 bg-zinc-900 border border-zinc-800 rounded-lg pl-9 pr-3 text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-[#00c26b] transition-colors"
          />
        </div>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as MontageStatus | 'ALL')}
          className="h-10 bg-zinc-900 border border-zinc-800 rounded-lg px-3 text-sm text-zinc-300 outline-none focus:border-[#00c26b] transition-colors"
        >
          <option value="ALL">Все статусы</option>
          {MONTAGE_STATUS_ORDER.map(s => <option key={s} value={s}>{MONTAGE_STATUS_LABELS[s]}</option>)}
        </select>
        <select
          value={editorFilter}
          onChange={e => setEditorFilter(e.target.value)}
          className="h-10 bg-zinc-900 border border-zinc-800 rounded-lg px-3 text-sm text-zinc-300 outline-none focus:border-[#00c26b] transition-colors"
        >
          <option value="ALL">Все монтажёры</option>
          {editors.map(ed => <option key={ed.id} value={ed.id}>{ed.displayName}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-xs text-zinc-400 cursor-pointer select-none">
          <input type="checkbox" checked={activeOnly} onChange={e => setActiveOnly(e.target.checked)} className="accent-[#00c26b]" />
          Только в работе
        </label>
        <label className="flex items-center gap-1.5 text-xs text-zinc-400 cursor-pointer select-none">
          <input type="checkbox" checked={overdueOnly} onChange={e => setOverdueOnly(e.target.checked)} className="accent-[#00c26b]" />
          Только просроченные
        </label>
        <label className="flex items-center gap-1.5 text-xs text-zinc-400 cursor-pointer select-none">
          <input type="checkbox" checked={attentionOnly} onChange={e => setAttentionOnly(e.target.checked)} className="accent-[#00c26b]" />
          Требуют внимания
        </label>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-zinc-800 hover:bg-transparent">
              <TableHead className="text-zinc-400">
                <button type="button" onClick={() => toggleSort('date')} className="flex items-center gap-1 hover:text-zinc-200">
                  Дата поступления <SortIcon active={sortKey === 'date'} dir={sortDir} />
                </button>
              </TableHead>
              <TableHead className="text-zinc-400">
                <button type="button" onClick={() => toggleSort('client')} className="flex items-center gap-1 hover:text-zinc-200">
                  Клиент <SortIcon active={sortKey === 'client'} dir={sortDir} />
                </button>
              </TableHead>
              <TableHead className="text-zinc-400">Проект</TableHead>
              <TableHead className="text-zinc-400">Статус</TableHead>
              <TableHead className="text-zinc-400">Монтажёр</TableHead>
              <TableHead className="text-zinc-400">
                <button type="button" onClick={() => toggleSort('deadline')} className="flex items-center gap-1 hover:text-zinc-200">
                  Дедлайн <SortIcon active={sortKey === 'deadline'} dir={sortDir} />
                </button>
              </TableHead>
              <TableHead className="text-zinc-400">
                <button type="button" onClick={() => toggleSort('profit')} className="flex items-center gap-1 hover:text-zinc-200">
                  Финансы <SortIcon active={sortKey === 'profit'} dir={sortDir} />
                </button>
              </TableHead>
              <TableHead className="text-zinc-400">Оплаты</TableHead>
              <TableHead className="text-zinc-400">Материалы</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.length === 0 && (
              <TableRow className="border-zinc-800 hover:bg-transparent">
                <TableCell colSpan={9} className="text-center text-zinc-500 py-10">Проектов не найдено</TableCell>
              </TableRow>
            )}
            {sorted.map(p => {
              const profit = computeMontageProfit(p.clientAmount, p.editorAmount)
              return (
                <TableRow
                  key={p.id}
                  onClick={() => onOpenProject(p)}
                  className="border-zinc-800 cursor-pointer"
                >
                  <TableCell>
                    <p className="text-zinc-200 text-sm">{formatDate(p.sourceReceivedAt)}</p>
                  </TableCell>
                  <TableCell>
                    <p className="flex items-center gap-1.5 text-zinc-200 text-sm truncate max-w-[160px]">
                      <span className="truncate">{p.clientName ?? '—'}</span>
                      {p.hasNoClientLink && (
                        <span title="Клиент не привязан — данные из импорта, довяжите клиента вручную" className="flex-shrink-0 flex items-center justify-center w-3.5 h-3.5 rounded-full bg-amber-500/20 text-amber-400 text-[10px] font-bold">
                          !
                        </span>
                      )}
                    </p>
                    {p.companyName && <p className="text-zinc-500 text-xs truncate max-w-[160px]">{p.companyName}</p>}
                  </TableCell>
                  <TableCell>
                    <p className="text-zinc-200 text-sm truncate max-w-[200px]">{p.title ?? 'Без названия'}</p>
                    <p className="text-zinc-500 text-xs truncate max-w-[200px]">
                      {p.contentType ?? ''}
                      {p.orderId && (
                        <Link href="/admin/crm" onClick={e => e.stopPropagation()} className="text-[#00c26b] hover:underline ml-1">
                          заказ
                        </Link>
                      )}
                    </p>
                  </TableCell>
                  <TableCell><MontageStatusBadge status={p.status} /></TableCell>
                  <TableCell>
                    <p className="text-zinc-300 text-sm">{p.editorName ?? '—'}</p>
                  </TableCell>
                  <TableCell>
                    <p className="text-zinc-300 text-sm">{formatDate(p.deadlineDate)}</p>
                    {p.deadlineLabel && (
                      <p className={`text-xs ${p.isOverdue ? 'text-red-400' : 'text-zinc-500'}`}>{p.deadlineLabel}</p>
                    )}
                  </TableCell>
                  <TableCell>
                    <p className="text-zinc-200 text-sm">Клиент: {formatMoney(p.clientAmount)}</p>
                    <p className="text-zinc-500 text-xs">Монтажёр: {formatMoney(p.editorAmount)} · Прибыль: {formatMoney(profit)}</p>
                  </TableCell>
                  <TableCell>
                    <p className="text-xs text-zinc-300">Клиент: {MONTAGE_CLIENT_PAYMENT_STATUS_LABELS[p.clientPaymentStatus]}</p>
                    <p className="text-xs text-zinc-500">Монтажёр: {MONTAGE_EDITOR_PAYMENT_STATUS_LABELS[p.editorPaymentStatus]}</p>
                  </TableCell>
                  <TableCell onClick={e => e.stopPropagation()}>
                    <div className="flex flex-col items-start gap-1">
                      {p.mountedMaterialNasUrl && (
                        <GlowPill as="a" href={p.mountedMaterialNasUrl} ariaLabel="Открыть NAS" color="violet" size="sm" icon={Server}>
                          NAS
                        </GlowPill>
                      )}
                      {!p.mountedMaterialNasUrl && p.attentionReasons.includes('NO_NAS_AFTER_DELIVERY') && (
                        <span className="text-[11px] text-amber-400 bg-amber-950/30 rounded-full px-2 py-0.5">Нет NAS</span>
                      )}
                      {p.effectiveSourceMaterialsUrl && (
                        <GlowPill as="a" href={p.effectiveSourceMaterialsUrl} ariaLabel="Открыть исходники" color="green" size="sm" icon={Cloud}>
                          Исходники
                        </GlowPill>
                      )}
                      {!p.mountedMaterialNasUrl && !p.effectiveSourceMaterialsUrl && <span className="text-zinc-600 text-xs">—</span>}
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
