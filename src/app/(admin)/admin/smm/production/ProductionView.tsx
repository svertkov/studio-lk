'use client'

import { useMemo, useState } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { Search, Plus, LayoutGrid, Table2, AlertTriangle } from 'lucide-react'
import MetricCard, { METRIC_GRID_CLASSNAME } from '@/components/ui/metric-card'
import {
  updateSmmContentItem, getSmmContentItemDetail,
  type SmmProductionRowDTO, type SmmContentItemDetailDTO, type SmmProjectDTO,
} from '@/lib/actions/smm'
import type { EditorProfileListItemDTO } from '@/lib/actions/editors'
import type { StaffUserDTO } from '@/lib/actions/users'
import {
  CONTENT_SERVICE_TYPES, SMM_SERVICE_TYPE_LABELS, SMM_CONTENT_STATUS_LABELS, SMM_CONTENT_STATUS_ORDER,
  SMM_PUBLICATION_PLATFORM_LABELS, SMM_PRODUCTION_DATE_FILTER_LABELS, SMM_PRODUCTION_DEFAULT_FILTERS,
  filterSmmProductionRows, sortSmmProductionRowsDefault, computeSmmProductionKpis,
  type SmmProductionFilters, type SmmProductionDateFilter,
} from '@/lib/smm-model'
import type { SmmContentStatus, SmmServiceType, SmmPublicationPlatform } from '@prisma/client'
import SmmContentItemCard from '@/components/smm/SmmContentItemCard'
import SmmContentItemCreateModal from '@/components/smm/SmmContentItemCreateModal'
import ProductionTable from './ProductionTable'
import ProductionKanban from './ProductionKanban'

const SELECT = 'h-10 bg-zinc-900 border border-zinc-800 rounded-lg px-3 text-sm text-zinc-300 outline-none focus:border-[#00c26b] transition-colors'

type ViewMode = 'table' | 'kanban'

interface Props {
  initialItems: SmmProductionRowDTO[]
  projects: SmmProjectDTO[]
  editors: EditorProfileListItemDTO[]
  staff: StaffUserDTO[]
  initialDetail: SmmContentItemDetailDTO | null
}

// Читает начальные фильтры из query-параметров ОДИН раз через lazy useState
// (ТЗ 2B, п.9) — без useEffect-синхронизации: та же архитектура, что уже
// используется в MontageProjectsTable (initialFiltersFromPreset). Каждое
// последующее изменение фильтра сразу пишет URL через router.replace ВНУТРИ
// обработчика (событие, не эффект) — не повторяем класс бага
// react-hooks/set-state-in-effect, уже найденный и исправленный в
// OrdersBoard.tsx на этом этапе.
function readInitialFilters(params: URLSearchParams): SmmProductionFilters {
  return {
    search: params.get('search') ?? '',
    smmProjectId: params.get('client') ?? 'ALL',
    status: (params.get('status') as SmmContentStatus | null) ?? 'ALL',
    serviceType: (params.get('format') as SmmServiceType | null) ?? 'ALL',
    editorId: params.get('editor') ?? 'ALL',
    dateFilter: (params.get('date') as SmmProductionDateFilter | null) ?? 'ALL',
    platform: (params.get('platform') as SmmPublicationPlatform | null) ?? 'ALL',
    readyToPublishOnly: params.get('ready') === '1',
  }
}

const STATUS_FILTER_OPTIONS: SmmContentStatus[] = [...SMM_CONTENT_STATUS_ORDER, 'CANCELLED']

export default function ProductionView({ initialItems, projects, editors, staff, initialDetail }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [filters, setFilters] = useState<SmmProductionFilters>(() => readInitialFilters(searchParams))
  const [view, setView] = useState<ViewMode>(() => (searchParams.get('view') === 'kanban' ? 'kanban' : 'table'))
  const [openDetail, setOpenDetail] = useState<SmmContentItemDetailDTO | null>(initialDetail)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function syncURL(nextFilters: SmmProductionFilters, nextView: ViewMode, openId: string | null) {
    const params = new URLSearchParams()
    if (nextFilters.search) params.set('search', nextFilters.search)
    if (nextFilters.smmProjectId !== 'ALL') params.set('client', nextFilters.smmProjectId)
    if (nextFilters.status !== 'ALL') params.set('status', nextFilters.status)
    if (nextFilters.serviceType !== 'ALL') params.set('format', nextFilters.serviceType)
    if (nextFilters.editorId !== 'ALL') params.set('editor', nextFilters.editorId)
    if (nextFilters.dateFilter !== 'ALL') params.set('date', nextFilters.dateFilter)
    if (nextFilters.platform !== 'ALL') params.set('platform', nextFilters.platform)
    if (nextFilters.readyToPublishOnly) params.set('ready', '1')
    if (nextView !== 'table') params.set('view', nextView)
    if (openId) params.set('openContentId', openId)
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname)
  }

  function applyFilters(patch: Partial<SmmProductionFilters>) {
    const next = { ...filters, ...patch }
    setFilters(next)
    syncURL(next, view, openDetail?.id ?? null)
  }

  function applyPreset(patch: Partial<SmmProductionFilters>) {
    applyFilters({ status: 'ALL', dateFilter: 'ALL', readyToPublishOnly: false, ...patch })
  }

  function resetFilters() {
    setFilters(SMM_PRODUCTION_DEFAULT_FILTERS)
    syncURL(SMM_PRODUCTION_DEFAULT_FILTERS, view, openDetail?.id ?? null)
  }

  function changeView(next: ViewMode) {
    setView(next)
    syncURL(filters, next, openDetail?.id ?? null)
  }

  async function openContentItem(id: string) {
    const result = await getSmmContentItemDetail(id)
    if (!result.ok) { setError(result.error); return }
    setOpenDetail(result.data)
    syncURL(filters, view, id)
  }

  function closeCard() {
    setOpenDetail(null)
    syncURL(filters, view, null)
    router.refresh()
  }

  function handleCardChanged(updated: SmmContentItemDetailDTO) {
    setOpenDetail(updated)
    router.refresh()
  }

  async function handleQuickStatusChange(id: string, status: SmmContentStatus) {
    const result = await updateSmmContentItem(id, { status })
    if (!result.ok) { setError(result.error); return }
    router.refresh()
  }

  function handleCreated(id: string) {
    setCreating(false)
    router.refresh()
    openContentItem(id)
  }

  const filteredSorted = useMemo(
    () => sortSmmProductionRowsDefault(filterSmmProductionRows(initialItems, filters)),
    [initialItems, filters],
  )

  const kpis = useMemo(() => computeSmmProductionKpis(initialItems), [initialItems])

  const clientOptions = useMemo(() => {
    const map = new Map<string, string>()
    for (const r of initialItems) map.set(r.smmProjectId, r.clientName ?? 'Без имени')
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], 'ru'))
  }, [initialItems])

  const filtersActive = JSON.stringify(filters) !== JSON.stringify(SMM_PRODUCTION_DEFAULT_FILTERS)

  return (
    <div className="space-y-4">
      {error && <p className="text-red-400 text-sm bg-red-950/30 border border-red-800/40 rounded-lg px-3 py-2">{error}</p>}

      {/* KPI-строка (ТЗ 2B, п.32) — компактные рабочие счётчики, не dashboard */}
      <div className={METRIC_GRID_CLASSNAME}>
        <MetricCard label="В работе" value={String(kpis.inProgress)} />
        <MetricCard label="Монтаж" value={String(kpis.inEdit)} onClick={() => applyPreset({ status: 'IN_EDIT' })} />
        <MetricCard label="На проверке" value={String(kpis.inReview)} onClick={() => applyPreset({ status: 'REVIEW' })} />
        <MetricCard label="Готово к публикации" value={String(kpis.readyToPublish)} onClick={() => applyPreset({ readyToPublishOnly: true })} />
        <MetricCard
          label="Просрочено" value={String(kpis.overdue)} onClick={() => applyPreset({ dateFilter: 'OVERDUE' })}
          valueColorClassName={kpis.overdue > 0 ? 'text-red-400' : 'text-white'}
        />
      </div>

      {/* Быстрые пресеты (ТЗ 2B, п.8) */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-zinc-500 font-medium mr-1">Быстрые фильтры</span>
        <button type="button" onClick={() => applyPreset({ dateFilter: 'TODAY' })} className="text-xs bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 rounded-lg px-3 py-1.5 transition-colors">Сегодня</button>
        <button type="button" onClick={() => applyPreset({ dateFilter: 'OVERDUE' })} className="text-xs bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 rounded-lg px-3 py-1.5 transition-colors">Просрочено</button>
        <button type="button" onClick={() => applyPreset({ status: 'WAITING_FOR_SHOOT' })} className="text-xs bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 rounded-lg px-3 py-1.5 transition-colors">Нужно снять</button>
        <button type="button" onClick={() => applyPreset({ status: 'IN_EDIT' })} className="text-xs bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 rounded-lg px-3 py-1.5 transition-colors">Монтаж</button>
        <button type="button" onClick={() => applyPreset({ status: 'REVIEW' })} className="text-xs bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 rounded-lg px-3 py-1.5 transition-colors">На проверке</button>
        <button type="button" onClick={() => applyPreset({ readyToPublishOnly: true })} className="text-xs bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 rounded-lg px-3 py-1.5 transition-colors">Готово к публикации</button>
      </div>

      {/* Фильтры (ТЗ 2B, п.7) */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <input
            value={filters.search}
            onChange={e => applyFilters({ search: e.target.value })}
            placeholder="Поиск по коду, названию, клиенту..."
            className="w-full h-10 bg-zinc-900 border border-zinc-800 rounded-lg pl-9 pr-3 text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-[#00c26b] transition-colors"
          />
        </div>
        <select className={SELECT} value={filters.smmProjectId} onChange={e => applyFilters({ smmProjectId: e.target.value })}>
          <option value="ALL">Все клиенты</option>
          {clientOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <select className={SELECT} value={filters.status} onChange={e => applyFilters({ status: e.target.value as SmmContentStatus | 'ALL' })}>
          <option value="ALL">Все статусы</option>
          {STATUS_FILTER_OPTIONS.map(s => <option key={s} value={s}>{SMM_CONTENT_STATUS_LABELS[s]}</option>)}
        </select>
        <select className={SELECT} value={filters.serviceType} onChange={e => applyFilters({ serviceType: e.target.value as SmmServiceType | 'ALL' })}>
          <option value="ALL">Все форматы</option>
          {CONTENT_SERVICE_TYPES.map(t => <option key={t} value={t}>{SMM_SERVICE_TYPE_LABELS[t]}</option>)}
        </select>
        <select className={SELECT} value={filters.editorId} onChange={e => applyFilters({ editorId: e.target.value })}>
          <option value="ALL">Все монтажёры</option>
          {editors.map(ed => <option key={ed.id} value={ed.id}>{ed.displayName}</option>)}
        </select>
        <select className={SELECT} value={filters.platform} onChange={e => applyFilters({ platform: e.target.value as SmmPublicationPlatform | 'ALL' })}>
          <option value="ALL">Все площадки</option>
          {(Object.keys(SMM_PUBLICATION_PLATFORM_LABELS) as SmmPublicationPlatform[]).map(p => <option key={p} value={p}>{SMM_PUBLICATION_PLATFORM_LABELS[p]}</option>)}
        </select>
        <select className={SELECT} value={filters.dateFilter} onChange={e => applyFilters({ dateFilter: e.target.value as SmmProductionDateFilter })}>
          {(Object.keys(SMM_PRODUCTION_DATE_FILTER_LABELS) as SmmProductionDateFilter[]).map(d => <option key={d} value={d}>{SMM_PRODUCTION_DATE_FILTER_LABELS[d]}</option>)}
        </select>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 rounded-lg p-1 w-fit">
          <button type="button" onClick={() => changeView('table')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${view === 'table' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}>
            <Table2 className="w-3.5 h-3.5" /> Таблица
          </button>
          <button type="button" onClick={() => changeView('kanban')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${view === 'kanban' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}>
            <LayoutGrid className="w-3.5 h-3.5" /> Канбан
          </button>
        </div>
        <button type="button" onClick={() => setCreating(true)} className="flex items-center gap-1.5 bg-[#00c26b] hover:bg-[#00b360] text-white text-sm font-medium px-3.5 py-2 rounded-lg transition-colors">
          <Plus className="w-4 h-4" /> Контент
        </button>
      </div>

      {initialItems.length === 0 ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-10 text-center space-y-3">
          <p className="text-zinc-400 text-sm">Контент пока не создан</p>
          <button type="button" onClick={() => setCreating(true)} className="bg-[#00c26b] hover:bg-[#00b360] text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">Создать первую единицу</button>
        </div>
      ) : filteredSorted.length === 0 ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-10 text-center space-y-3">
          <p className="flex items-center justify-center gap-2 text-zinc-400 text-sm"><AlertTriangle className="w-4 h-4" /> По выбранным фильтрам ничего не найдено</p>
          {filtersActive && <button type="button" onClick={resetFilters} className="text-[#00c26b] hover:underline text-sm">Сбросить фильтры</button>}
        </div>
      ) : view === 'table' ? (
        <ProductionTable items={filteredSorted} onOpen={openContentItem} onQuickStatusChange={handleQuickStatusChange} />
      ) : (
        <ProductionKanban items={filteredSorted} onOpen={openContentItem} />
      )}

      {openDetail && (
        <SmmContentItemCard
          detail={openDetail}
          editors={editors}
          staff={staff}
          onOpenChange={open => { if (!open) closeCard() }}
          onChanged={handleCardChanged}
          onOpenContentItem={openContentItem}
        />
      )}

      {creating && (
        <SmmContentItemCreateModal
          projects={projects}
          onOpenChange={setCreating}
          onCreated={handleCreated}
        />
      )}
    </div>
  )
}
