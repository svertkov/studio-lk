'use client'

import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import {
  getSmmContentPlanRows, getSmmContentItemDetail,
  type SmmContentPlanRowDTO, type SmmContentItemDetailDTO,
} from '@/lib/actions/smm'
import type { EditorProfileListItemDTO } from '@/lib/actions/editors'
import type { StaffUserDTO } from '@/lib/actions/users'
import { SMM_SERVICE_TYPE_LABELS, SMM_CONTENT_STATUS_LABELS } from '@/lib/smm-model'
import type { SmmPublicationPlatform } from '@prisma/client'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import SmmContentItemCard from '@/components/smm/SmmContentItemCard'

// Все 6 значений SmmPublicationPlatform — фиксированные колонки pivot'а
// (docs/business/SMM.md, «Views», «Контент-план»). Backend НЕ меняется при
// появлении новой площадки в данных — enum уже перечисляет их все, это
// просто порядок отображения.
const PLATFORM_COLUMNS: SmmPublicationPlatform[] = ['INSTAGRAM', 'TELEGRAM', 'VK', 'YOUTUBE', 'RUTUBE', 'OTHER']
const PLATFORM_SHORT_LABELS: Record<SmmPublicationPlatform, string> = {
  INSTAGRAM: 'IG', TELEGRAM: 'TG', VK: 'VK', YOUTUBE: 'YT', RUTUBE: 'RT', OTHER: '?',
}

function formatDate(v: string): string {
  return new Date(v).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}
function weekdayLabel(v: string): string {
  return new Date(v).toLocaleDateString('ru-RU', { weekday: 'short' })
}
function monthLabel(d: Date): string {
  return d.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })
}
function startOfMonth(d: Date): Date { return new Date(d.getFullYear(), d.getMonth(), 1) }
function endOfMonth(d: Date): Date { return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999) }

function PlatformCell({ cell }: { cell: SmmContentPlanRowDTO['platformCells'][SmmPublicationPlatform] }) {
  if (!cell) return <span className="text-zinc-700">—</span>
  if (cell.status === 'PUBLISHED') return <span className="text-[#00c26b]" title="Опубликовано">✓</span>
  if (cell.status === 'CANCELLED') return <span className="text-zinc-600" title="Отменена">✗</span>
  if (cell.status === 'READY') return <span className="text-blue-400" title="Готова">●</span>
  return <span className="text-amber-400" title="Запланирована">🕓</span>
}

interface Props {
  smmProjectId: string
  editors: EditorProfileListItemDTO[]
  staff: StaffUserDTO[]
}

// Контент-план клиента (следующий этап после 2B, docs/business/SMM.md,
// «Views») — pivot НАД SmmContentItem+SmmPublication (buildContentPlanPlatformCells,
// smm-model.ts), НЕ отдельная таблица БД и не физические поля instagram/vk/
// etc. (ТЗ, п.21). Период — только месяц вперёд/назад (произвольный
// диапазон сознательно не реализован — не увеличивать scope).
export default function SmmProjectContentPlanTab({ smmProjectId, editors, staff }: Props) {
  const [monthAnchor, setMonthAnchor] = useState(() => new Date())
  const [rows, setRows] = useState<SmmContentPlanRowDTO[]>([])
  const [loading, setLoading] = useState(true)
  const [openDetail, setOpenDetail] = useState<SmmContentItemDetailDTO | null>(null)

  useEffect(() => {
    const periodStart = startOfMonth(monthAnchor).toISOString()
    const periodEnd = endOfMonth(monthAnchor).toISOString()
    getSmmContentPlanRows(smmProjectId, periodStart, periodEnd).then(result => {
      setLoading(false)
      if (result.ok) setRows(result.data)
    })
  }, [smmProjectId, monthAnchor])

  async function openContentItem(id: string) {
    const result = await getSmmContentItemDetail(id)
    if (result.ok) setOpenDetail(result.data)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-white font-semibold text-sm">Контент-план</h3>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setMonthAnchor(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))} className="p-1.5 bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-400 hover:text-white transition-colors"><ChevronLeft className="w-4 h-4" /></button>
          <p className="text-zinc-300 text-sm capitalize w-36 text-center">{monthLabel(monthAnchor)}</p>
          <button type="button" onClick={() => setMonthAnchor(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))} className="p-1.5 bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-400 hover:text-white transition-colors"><ChevronRight className="w-4 h-4" /></button>
        </div>
      </div>

      {loading ? (
        <p className="text-zinc-500 text-sm">Загрузка...</p>
      ) : rows.length === 0 ? (
        <p className="text-zinc-500 text-sm bg-zinc-900 border border-zinc-800 rounded-xl px-5 py-6">На этот месяц ничего не запланировано</p>
      ) : (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-zinc-800 hover:bg-transparent">
                <TableHead className="text-zinc-400">Дата</TableHead>
                <TableHead className="text-zinc-400">День</TableHead>
                <TableHead className="text-zinc-400">Название</TableHead>
                <TableHead className="text-zinc-400">Формат</TableHead>
                {PLATFORM_COLUMNS.map(p => <TableHead key={p} className="text-zinc-400 text-center">{PLATFORM_SHORT_LABELS[p]}</TableHead>)}
                <TableHead className="text-zinc-400">Статус</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(r => (
                <TableRow key={r.id} onClick={() => openContentItem(r.id)} className="cursor-pointer transition-colors border-zinc-800">
                  <TableCell><span className="text-zinc-300 text-xs">{formatDate(r.relevantDate)}</span></TableCell>
                  <TableCell><span className="text-zinc-500 text-xs capitalize">{weekdayLabel(r.relevantDate)}</span></TableCell>
                  <TableCell><p className="text-zinc-200 text-sm truncate max-w-[200px]">{r.title || SMM_SERVICE_TYPE_LABELS[r.serviceType]}</p></TableCell>
                  <TableCell><span className="text-zinc-400 text-xs">{r.serviceType === 'OTHER' ? (r.customServiceType || 'Другое') : SMM_SERVICE_TYPE_LABELS[r.serviceType]}</span></TableCell>
                  {PLATFORM_COLUMNS.map(p => (
                    <TableCell key={p} className="text-center" onClick={e => e.stopPropagation()}>
                      <button type="button" onClick={() => openContentItem(r.id)}><PlatformCell cell={r.platformCells[p]} /></button>
                    </TableCell>
                  ))}
                  <TableCell><span className="text-zinc-400 text-xs">{SMM_CONTENT_STATUS_LABELS[r.status]}</span></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
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
