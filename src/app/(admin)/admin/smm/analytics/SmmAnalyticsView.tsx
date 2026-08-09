'use client'

import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import {
  getSmmAnalyticsRows, getSmmContentItemDetail,
  type SmmProjectDTO, type SmmAnalyticsRowDTO, type SmmContentItemDetailDTO,
} from '@/lib/actions/smm'
import type { EditorProfileListItemDTO } from '@/lib/actions/editors'
import type { StaffUserDTO } from '@/lib/actions/users'
import { CONTENT_SERVICE_TYPES, SMM_SERVICE_TYPE_LABELS, SMM_PUBLICATION_PLATFORM_LABELS, computeSmmAnalyticsAggregates, type SmmAnalyticsAggregates } from '@/lib/smm-model'
import type { SmmPublicationPlatform, SmmServiceType } from '@prisma/client'
import SmmAnalyticsTable from '@/components/smm/SmmAnalyticsTable'
import SmmContentItemCard from '@/components/smm/SmmContentItemCard'

function monthLabel(d: Date): string {
  return d.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })
}
function startOfMonth(d: Date): Date { return new Date(d.getFullYear(), d.getMonth(), 1) }
function endOfMonth(d: Date): Date { return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999) }

interface Props {
  projects: SmmProjectDTO[]
  initialClientFilter: string | null
  editors: EditorProfileListItemDTO[]
  staff: StaffUserDTO[]
}

export default function SmmAnalyticsView({ projects, initialClientFilter, editors, staff }: Props) {
  const [clientFilter, setClientFilter] = useState(initialClientFilter ?? 'ALL')
  const [platformFilter, setPlatformFilter] = useState<SmmPublicationPlatform | 'ALL'>('ALL')
  const [serviceTypeFilter, setServiceTypeFilter] = useState<SmmServiceType | 'ALL'>('ALL')
  const [allTime, setAllTime] = useState(false)
  const [monthAnchor, setMonthAnchor] = useState(() => new Date())
  const [rows, setRows] = useState<SmmAnalyticsRowDTO[]>([])
  const [aggregates, setAggregates] = useState<SmmAnalyticsAggregates>(computeSmmAnalyticsAggregates([]))
  const [loading, setLoading] = useState(true)
  const [openDetail, setOpenDetail] = useState<SmmContentItemDetailDTO | null>(null)

  useEffect(() => {
    getSmmAnalyticsRows({
      smmProjectId: clientFilter !== 'ALL' ? clientFilter : undefined,
      platform: platformFilter !== 'ALL' ? platformFilter : undefined,
      serviceType: serviceTypeFilter !== 'ALL' ? serviceTypeFilter : undefined,
      periodStart: allTime ? undefined : startOfMonth(monthAnchor).toISOString(),
      periodEnd: allTime ? undefined : endOfMonth(monthAnchor).toISOString(),
    }).then(result => {
      setLoading(false)
      if (result.ok) { setRows(result.data.rows); setAggregates(result.data.aggregates) }
    })
  }, [clientFilter, platformFilter, serviceTypeFilter, allTime, monthAnchor])

  async function openContentItem(id: string) {
    const result = await getSmmContentItemDetail(id)
    if (result.ok) setOpenDetail(result.data)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <select className="h-10 bg-zinc-900 border border-zinc-800 rounded-lg px-3 text-sm text-zinc-300 outline-none focus:border-[#00c26b]" value={clientFilter} onChange={e => setClientFilter(e.target.value)}>
          <option value="ALL">Все клиенты</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.clientName ?? 'Без имени'}</option>)}
        </select>
        <select className="h-10 bg-zinc-900 border border-zinc-800 rounded-lg px-3 text-sm text-zinc-300 outline-none focus:border-[#00c26b]" value={platformFilter} onChange={e => setPlatformFilter(e.target.value as SmmPublicationPlatform | 'ALL')}>
          <option value="ALL">Все площадки</option>
          {(Object.keys(SMM_PUBLICATION_PLATFORM_LABELS) as SmmPublicationPlatform[]).map(p => <option key={p} value={p}>{SMM_PUBLICATION_PLATFORM_LABELS[p]}</option>)}
        </select>
        <select className="h-10 bg-zinc-900 border border-zinc-800 rounded-lg px-3 text-sm text-zinc-300 outline-none focus:border-[#00c26b]" value={serviceTypeFilter} onChange={e => setServiceTypeFilter(e.target.value as SmmServiceType | 'ALL')}>
          <option value="ALL">Все форматы</option>
          {CONTENT_SERVICE_TYPES.map(t => <option key={t} value={t}>{SMM_SERVICE_TYPE_LABELS[t]}</option>)}
        </select>

        <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 rounded-lg p-1 w-fit">
          <button type="button" onClick={() => setAllTime(false)} className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${!allTime ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}>По месяцам</button>
          <button type="button" onClick={() => setAllTime(true)} className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${allTime ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}>Всё время</button>
        </div>
        {!allTime && (
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setMonthAnchor(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))} className="p-1.5 bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-400 hover:text-white transition-colors"><ChevronLeft className="w-4 h-4" /></button>
            <p className="text-zinc-300 text-sm capitalize w-36 text-center">{monthLabel(monthAnchor)}</p>
            <button type="button" onClick={() => setMonthAnchor(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))} className="p-1.5 bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-400 hover:text-white transition-colors"><ChevronRight className="w-4 h-4" /></button>
          </div>
        )}
      </div>

      {loading ? (
        <p className="text-zinc-500 text-sm">Загрузка...</p>
      ) : (
        <SmmAnalyticsTable rows={rows} aggregates={aggregates} onOpenContent={openContentItem} />
      )}

      {openDetail && (
        <SmmContentItemCard
          detail={openDetail}
          editors={editors}
          staff={staff}
          onOpenChange={open => { if (!open) setOpenDetail(null) }}
          onChanged={setOpenDetail}
          onOpenContentItem={openContentItem}
        />
      )}
    </div>
  )
}
