'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Search, ArrowUp, ArrowDown, ArrowUpDown, Cloud, Server, AlertTriangle } from 'lucide-react'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import GlowPill from '@/components/ui/glow-pill'
import ToggleChip from '@/components/ui/toggle-chip'
import type { MontageProjectDTO } from '@/lib/actions/montage'
import type { EditorProfileListItemDTO } from '@/lib/actions/editors'
import {
  MONTAGE_STATUS_ORDER, MONTAGE_STATUS_LABELS, MONTAGE_CLIENT_PAYMENT_STATUS_LABELS, MONTAGE_EDITOR_PAYMENT_STATUS_LABELS,
  MONTAGE_ACTIVE_STATUSES, MONTAGE_CONTENT_TYPE_LABELS, MONTAGE_MATERIALS_STATE_ORDER, MONTAGE_MATERIALS_STATE_LABELS,
  getMontageMaterialsMissingFields, computeMontageProfit, type MontageStatus, type MontageMaterialsState,
} from '@/lib/montage-model'

// Фильтр статуса показывает и терминальный CANCELLED (вне MONTAGE_STATUS_ORDER,
// который отдаёт только 5 производственных этапов для карточки/дропдауна
// создания) — в таблице отменённые проекты по-прежнему видны, должна быть
// возможность отфильтровать именно их.
const STATUS_FILTER_OPTIONS: MontageStatus[] = [...MONTAGE_STATUS_ORDER, 'CANCELLED']

function contentTypeLabel(p: Pick<MontageProjectDTO, 'contentType' | 'customContentType'>): string {
  if (!p.contentType) return ''
  if (p.contentType === 'OTHER') return p.customContentType || MONTAGE_CONTENT_TYPE_LABELS.OTHER
  return MONTAGE_CONTENT_TYPE_LABELS[p.contentType]
}
import MontageStatusBadge from './MontageStatusBadge'

// Подсветка всей строки по состоянию материалов (ТЗ: "предупреждение должно
// подсвечивать всю строку, аккуратно, без сплошной заливки"). COMPLETE/
// NOT_TRACKED возвращают '' — строка остаётся полностью обычной, включая
// стандартную border-zinc-800/hover, поэтому в месте использования при пустой
// строке добавляется 'border-zinc-800' отдельно (см. ниже), а не встроено
// сюда, — так конфликтующий border-цвет никогда не оказывается в одной
// строке классов дважды. Тени/фон — те же amber/red оттенки, что уже
// используются во всём разделе "Монтаж" для warning/danger (карточка
// проекта, дашборд), просто применённые на уровне строки, а не бэйджа.
function materialsRowClassName(state: MontageMaterialsState): string {
  if (state === 'PARTIAL') {
    return 'border-amber-600/40 bg-amber-500/[0.04] shadow-[inset_0_0_0_1px_rgba(217,119,6,0.12),0_0_10px_-4px_rgba(245,158,11,0.35)] hover:bg-amber-500/[0.08]'
  }
  if (state === 'MISSING') {
    return 'border-red-700/50 bg-red-500/[0.05] shadow-[inset_0_0_0_1px_rgba(185,28,28,0.15),0_0_16px_-4px_rgba(239,68,68,0.45)] hover:bg-red-500/10'
  }
  return ''
}

// Колонка "Материалы" — единственное место, читающее p.materialsState (см.
// getMontageMaterialsState, montage-model.ts) для решения, какие плашки
// показать; условная логика "что считать проблемой" здесь не дублируется,
// только отображение уже готового состояния + какого именно поля не хватает
// (getMontageMaterialsMissingFields — та же причина, что видна в "Требует
// внимания", просто в виде плашки, а не текста).
function MontageMaterialsCell({ project, onOpenMaterials }: { project: MontageProjectDTO; onOpenMaterials: () => void }) {
  const { materialsState, sourceMaterialsNasUrl, mountedMaterialNasUrl } = project

  if (materialsState === 'NOT_TRACKED' && !sourceMaterialsNasUrl && !mountedMaterialNasUrl) {
    return <span className="text-zinc-600 text-xs">—</span>
  }

  if (materialsState === 'MISSING') {
    return (
      <GlowPill
        as="button" onClick={onOpenMaterials} color="red" size="sm" icon={AlertTriangle}
        ariaLabel="Материалы не прикреплены — открыть карточку и перейти к разделу материалов"
        title="Не хватает и исходников, и готового материала на NAS"
      >
        Нет материалов
      </GlowPill>
    )
  }

  const { missingSource, missingFinal } = getMontageMaterialsMissingFields(project)

  return (
    <div className="flex flex-col items-start gap-1">
      {sourceMaterialsNasUrl ? (
        <GlowPill as="a" href={sourceMaterialsNasUrl} ariaLabel="Открыть исходники на NAS" color="green" size="sm" icon={Cloud}>
          Исходники NAS
        </GlowPill>
      ) : missingSource ? (
        <GlowPill
          as="button" onClick={onOpenMaterials} color="amber" size="sm" icon={AlertTriangle}
          ariaLabel="Нет исходников на NAS — открыть карточку и перейти к разделу материалов"
          title="Не прикреплена ссылка на исходники на NAS"
        >
          Нет исходников
        </GlowPill>
      ) : null}
      {mountedMaterialNasUrl ? (
        <GlowPill as="a" href={mountedMaterialNasUrl} ariaLabel="Открыть готовый материал на NAS" color="violet" size="sm" icon={Server}>
          Готовый материал
        </GlowPill>
      ) : missingFinal ? (
        <GlowPill
          as="button" onClick={onOpenMaterials} color="amber" size="sm" icon={AlertTriangle}
          ariaLabel="Нет готового материала на NAS — открыть карточку и перейти к разделу материалов"
          title="Не прикреплена ссылка на готовый материал на NAS"
        >
          Нет готового
        </GlowPill>
      ) : null}
      {!sourceMaterialsNasUrl && !missingSource && !mountedMaterialNasUrl && !missingFinal && (
        <span className="text-zinc-600 text-xs">—</span>
      )}
    </div>
  )
}

export type MontageProjectsFilterPreset =
  | { kind: 'status'; statuses: MontageStatus[] }
  | { kind: 'attention' }
  | { kind: 'all' }

// Персистентность тумблеров-фильтров между заходами на страницу (ТЗ:
// "если состояние сохраняется — сохранить, если нет — добавить"). Тот же
// приём, что уже используется для сворачивания Telegram-панели клиента
// (см. ClientTelegramLayout: localStorage, без БД/cookie — этого достаточно,
// сброс только вместе с данными браузера). Один ключ на все 4 флага —
// не заводим 4 отдельные записи ради одной и той же логической группы.
const TOGGLE_FILTERS_STORAGE_KEY = 'montage-toggle-filters-v1'

interface PersistedToggleFilters {
  activeOnly: boolean
  overdueOnly: boolean
  attentionOnly: boolean
  hideArchived: boolean
}

function persistToggleFilters(next: PersistedToggleFilters) {
  localStorage.setItem(TOGGLE_FILTERS_STORAGE_KEY, JSON.stringify(next))
}

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
  return [p.title, p.description, p.clientName, p.companyName, p.editorName, contentTypeLabel(p), p.internalComment, p.clientComment]
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

interface OpenProjectOptions {
  // Открыть карточку и сразу прокрутить/сфокусировать раздел "Материалы" —
  // используется предупреждающими плашками колонки материалов (ТЗ п.7).
  // Обычный клик по строке передаёт options не задав, полная карточка
  // открывается как раньше, без принудительной прокрутки.
  focusMaterials?: boolean
}

interface Props {
  projects: MontageProjectDTO[]
  editors: EditorProfileListItemDTO[]
  initialFilterPreset: MontageProjectsFilterPreset | null
  onOpenProject: (project: MontageProjectDTO, options?: OpenProjectOptions) => void
}

export default function MontageProjectsTable({ projects, editors, initialFilterPreset, onOpenProject }: Props) {
  const initialFilters = useState(() => initialFiltersFromPreset(initialFilterPreset))[0]

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<MontageStatus | 'ALL'>(initialFilters.statusFilter)
  const [editorFilter, setEditorFilter] = useState<string | 'ALL'>('ALL')
  const [attentionOnly, setAttentionOnly] = useState(initialFilters.attentionOnly)
  const [overdueOnly, setOverdueOnly] = useState(false)
  const [activeOnly, setActiveOnly] = useState(initialFilters.activeOnly)
  const [materialsFilter, setMaterialsFilter] = useState<MontageMaterialsState | 'ALL'>('ALL')
  // По умолчанию скрыты — архив специально существует, чтобы убрать сданные/
  // отменённые проекты из повседневного рабочего вида (см. archiveMontageProject,
  // actions/montage.ts), иначе таблица бесконечно растёт и не разгружается.
  const [hideArchived, setHideArchived] = useState(true)
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  // Восстановление сохранённых тумблеров — только когда таблица открыта
  // "напрямую", без конкретного пресета с дашборда (клик по KPI-карточке —
  // это осознанный временный срез, он не должен затираться прошлым выбором
  // пользователя). Чтение отложено через setTimeout(…, 0): localStorage
  // недоступен при SSR, а синхронный setState в теле эффекта запрещён
  // react-hooks/set-state-in-effect (см. тот же приём в ClientTelegramLayout).
  useEffect(() => {
    if (initialFilterPreset) return
    const timer = setTimeout(() => {
      const raw = localStorage.getItem(TOGGLE_FILTERS_STORAGE_KEY)
      if (!raw) return
      try {
        const saved = JSON.parse(raw) as Partial<PersistedToggleFilters>
        if (typeof saved.activeOnly === 'boolean') setActiveOnly(saved.activeOnly)
        if (typeof saved.overdueOnly === 'boolean') setOverdueOnly(saved.overdueOnly)
        if (typeof saved.attentionOnly === 'boolean') setAttentionOnly(saved.attentionOnly)
        if (typeof saved.hideArchived === 'boolean') setHideArchived(saved.hideArchived)
      } catch {
        // повреждённое значение в localStorage — молча остаёмся на дефолтах
      }
    }, 0)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- один раз на монтаж, initialFilterPreset стабилен (см. комментарий у initialFiltersFromPreset)
  }, [])

  function handleActiveOnlyChange(next: boolean) {
    setActiveOnly(next)
    persistToggleFilters({ activeOnly: next, overdueOnly, attentionOnly, hideArchived })
  }
  function handleOverdueOnlyChange(next: boolean) {
    setOverdueOnly(next)
    persistToggleFilters({ activeOnly, overdueOnly: next, attentionOnly, hideArchived })
  }
  function handleAttentionOnlyChange(next: boolean) {
    setAttentionOnly(next)
    persistToggleFilters({ activeOnly, overdueOnly, attentionOnly: next, hideArchived })
  }
  function handleHideArchivedChange(next: boolean) {
    setHideArchived(next)
    persistToggleFilters({ activeOnly, overdueOnly, attentionOnly, hideArchived: next })
  }

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
      if (hideArchived && p.isArchived) return false
      if (materialsFilter !== 'ALL' && p.materialsState !== materialsFilter) return false
      return true
    })
  }, [projects, search, statusFilter, activeOnly, editorFilter, attentionOnly, overdueOnly, hideArchived, materialsFilter])

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
      <div className="space-y-3">
        {/* Строка 1 — фильтры-выборки (поиск + dropdown), сузили таблицу по
            конкретному значению. Строка 2 (ниже) — тумблеры отображения,
            концептуально другой тип фильтра ("показать/скрыть" вместо
            "выбрать значение"), поэтому визуально разнесены отступом, а не
            обводкой/линией (ТЗ: "разделяться только воздухом"). */}
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
            {STATUS_FILTER_OPTIONS.map(s => <option key={s} value={s}>{MONTAGE_STATUS_LABELS[s]}</option>)}
          </select>
          <select
            value={editorFilter}
            onChange={e => setEditorFilter(e.target.value)}
            className="h-10 bg-zinc-900 border border-zinc-800 rounded-lg px-3 text-sm text-zinc-300 outline-none focus:border-[#00c26b] transition-colors"
          >
            <option value="ALL">Все монтажёры</option>
            {editors.map(ed => <option key={ed.id} value={ed.id}>{ed.displayName}</option>)}
          </select>
          <select
            value={materialsFilter}
            onChange={e => setMaterialsFilter(e.target.value as MontageMaterialsState | 'ALL')}
            className="h-10 bg-zinc-900 border border-zinc-800 rounded-lg px-3 text-sm text-zinc-300 outline-none focus:border-[#00c26b] transition-colors"
          >
            <option value="ALL">Материалы: все</option>
            {MONTAGE_MATERIALS_STATE_ORDER.map(s => <option key={s} value={s}>{MONTAGE_MATERIALS_STATE_LABELS[s]}</option>)}
          </select>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-zinc-500 font-medium mr-1">Быстрые фильтры</span>
          <ToggleChip checked={activeOnly} onChange={handleActiveOnlyChange}>Только в работе</ToggleChip>
          <ToggleChip checked={overdueOnly} onChange={handleOverdueOnlyChange}>Только просроченные</ToggleChip>
          <ToggleChip checked={attentionOnly} onChange={handleAttentionOnlyChange}>Требуют внимания</ToggleChip>
          <ToggleChip checked={hideArchived} onChange={handleHideArchivedChange}>Скрыть архивные</ToggleChip>
        </div>
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
                  className={`${materialsRowClassName(p.materialsState) || 'border-zinc-800'} cursor-pointer transition-colors`}
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
                      {contentTypeLabel(p)}
                      {p.orderId && (
                        <Link href="/admin/crm" onClick={e => e.stopPropagation()} className="text-[#00c26b] hover:underline ml-1">
                          заказ
                        </Link>
                      )}
                    </p>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col items-start gap-1">
                      <MontageStatusBadge status={p.status} />
                      {p.isPaused && <span className="text-[10px] text-amber-400 bg-amber-950/30 rounded-full px-1.5 py-0.5 whitespace-nowrap">Приостановлен</span>}
                      {p.isArchived && <span className="text-[10px] text-zinc-400 bg-zinc-800 rounded-full px-1.5 py-0.5 whitespace-nowrap">В архиве</span>}
                    </div>
                  </TableCell>
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
                    <MontageMaterialsCell project={p} onOpenMaterials={() => onOpenProject(p, { focusMaterials: true })} />
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
