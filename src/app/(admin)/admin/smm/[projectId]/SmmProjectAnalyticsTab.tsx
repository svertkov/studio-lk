'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import {
  getSmmAnalyticsRows, getSmmContentItemDetail,
  type SmmAnalyticsRowDTO, type SmmContentItemDetailDTO,
} from '@/lib/actions/smm'
import type { EditorProfileListItemDTO } from '@/lib/actions/editors'
import type { StaffUserDTO } from '@/lib/actions/users'
import { computeSmmAnalyticsAggregates, type SmmAnalyticsAggregates } from '@/lib/smm-model'
import SmmAnalyticsTable from '@/components/smm/SmmAnalyticsTable'
import SmmContentItemCard from '@/components/smm/SmmContentItemCard'

function monthLabel(d: Date): string {
  return d.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })
}
function startOfMonth(d: Date): Date { return new Date(d.getFullYear(), d.getMonth(), 1) }
function endOfMonth(d: Date): Date { return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999) }

interface Props {
  smmProjectId: string
  editors: EditorProfileListItemDTO[]
  staff: StaffUserDTO[]
}

// Аналитика клиента (следующий этап после 2B, docs/business/SMM.md,
// «Views») — та же выборка/агрегаты, что и глобальная SMM → Аналитика
// (getSmmAnalyticsRows/computeSmmAnalyticsAggregates/SmmAnalyticsTable), с
// зафиксированным client-фильтром. Второй analytics-backend не заводится
// (ТЗ, п.35). Данные периода фетчатся по смене месяца через
// useEffect+.then (тот же приём, что уже применяется в SmmPayoutsTab.tsx —
// не синхронный setState внутри эффекта, поэтому не задевает
// react-hooks/set-state-in-effect).
export default function SmmProjectAnalyticsTab({ smmProjectId, editors, staff }: Props) {
  const [monthAnchor, setMonthAnchor] = useState(() => new Date())
  const [rows, setRows] = useState<SmmAnalyticsRowDTO[]>([])
  const [aggregates, setAggregates] = useState<SmmAnalyticsAggregates>(computeSmmAnalyticsAggregates([]))
  const [loading, setLoading] = useState(true)
  const [openDetail, setOpenDetail] = useState<SmmContentItemDetailDTO | null>(null)

  useEffect(() => {
    const periodStart = startOfMonth(monthAnchor).toISOString()
    const periodEnd = endOfMonth(monthAnchor).toISOString()
    getSmmAnalyticsRows({ smmProjectId, periodStart, periodEnd }).then(result => {
      setLoading(false)
      if (result.ok) { setRows(result.data.rows); setAggregates(result.data.aggregates) }
    })
  }, [smmProjectId, monthAnchor])

  async function openContentItem(id: string) {
    const result = await getSmmContentItemDetail(id)
    if (result.ok) setOpenDetail(result.data)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-white font-semibold text-sm">Аналитика</h3>
        <Link href={`/admin/smm/analytics?client=${smmProjectId}`} className="text-xs text-zinc-400 hover:text-white underline">Открыть общую аналитику</Link>
      </div>
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setMonthAnchor(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))} className="p-1.5 bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-400 hover:text-white transition-colors"><ChevronLeft className="w-4 h-4" /></button>
        <p className="text-zinc-300 text-sm capitalize w-40 text-center">{monthLabel(monthAnchor)}</p>
        <button type="button" onClick={() => setMonthAnchor(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))} className="p-1.5 bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-400 hover:text-white transition-colors"><ChevronRight className="w-4 h-4" /></button>
      </div>

      {loading ? (
        <p className="text-zinc-500 text-sm">Загрузка...</p>
      ) : (
        <SmmAnalyticsTable rows={rows} aggregates={aggregates} showClientColumn={false} onOpenContent={openContentItem} />
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
